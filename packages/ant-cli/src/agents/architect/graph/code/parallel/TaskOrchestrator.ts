/**
 * TaskOrchestrator
 *
 * Central coordinator for parallel task execution within a single job.
 * Manages a dynamic pool of TaskWorkers, assigns tasks based on
 * exclusive/parallelGroup rules, handles completion/failure, and
 * synchronizes global state.
 *
 * Key design decisions:
 * - Generic over T extends BaseTask (works for CodeTask, DesignTask)
 * - Does NOT reference task.type — uses exclusive + parallelGroup only
 * - Single-process async/await parallelism (no Worker Threads)
 * - AsyncMutex for shared state access
 */

import type { BaseTask, TaskTokenUsage } from '@ant/shared';
import { TaskQueue } from '../../../types/task';
import { AsyncMutex } from './AsyncMutex';
import { TaskWorker } from './TaskWorker';
import type {
  OrchestratorResult,
  OrchestratorConfig,
  OrchestratorCallbacks,
  FailedTask,
  ParallelCheckpoint,
  WorkerGraphBuilder,
  WorkerSnapshot,
} from './types';
import { getTaskConcurrency } from './types';

/**
 * Classify whether an error is deterministic (will always fail on retry)
 * vs transient (may succeed on retry).
 *
 * Deterministic errors should NOT be retried — doing so wastes tokens and time.
 */
function isDeterministicError(error: Error): boolean {
  const msg = error.message || '';
  return (
    // Anthropic prompt too long
    /prompt is too long/i.test(msg) ||
    // Anthropic invalid request (malformed, etc.)
    /invalid_request_error/i.test(msg) ||
    // Authentication / permission errors
    /authentication/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /unauthorized/i.test(msg) ||
    // Model not found / not available
    /model.*not found/i.test(msg) ||
    // Explicitly non-retriable HTTP status codes
    /\b(400|401|403|404)\b.*\{/.test(msg)
  );
}

/**
 * Check if an error is a LangGraph recursion limit error.
 * These need special handling: pause (not fail), no retry, resume-ready.
 */
function isRecursionLimitError(error: Error): boolean {
  const msg = error.message || '';
  return /recursion limit/i.test(msg);
}

export class TaskOrchestrator<T extends BaseTask> {
  // Shared state (protected by lock)
  private taskQueue: TaskQueue<T>;
  private runningTasks = new Map<number, T>();
  private completedTasks: T[] = [];
  private failedTasks: FailedTask<T>[] = [];
  private accumulatedTokenUsage: TaskTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  // Worker management
  private workers = new Map<number, TaskWorker<T>>();
  private nextWorkerId = 0;
  private readonly maxWorkers: number;

  // Synchronization
  private readonly lock = new AsyncMutex();
  private draining = false;
  private allDoneResolve: (() => void) | null = null;
  private isRunning = false;
  
  // ✅ Tracks whether any task was paused due to recursion limit.
  // Unlike failedTasks (permanent), interrupted tasks remain in the queue for resume.
  private hasInterruptedTasks = false;

  // Configuration
  private readonly config: OrchestratorConfig;
  private readonly callbacks: OrchestratorCallbacks<T>;
  private readonly graphBuilder: WorkerGraphBuilder;
  private readonly sharedContext: any; // Opaque shared context passed to workers

  // Periodic checkpoint
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    taskQueue: TaskQueue<T>,
    graphBuilder: WorkerGraphBuilder,
    sharedContext: any,
    callbacks: OrchestratorCallbacks<T> = {},
    config?: Partial<OrchestratorConfig>,
  ) {
    this.taskQueue = taskQueue;
    this.graphBuilder = graphBuilder;
    this.sharedContext = sharedContext;
    this.callbacks = callbacks;
    this.maxWorkers = config?.maxWorkers ?? getTaskConcurrency();
    this.config = {
      maxWorkers: this.maxWorkers,
      checkpointInterval: config?.checkpointInterval ?? 60_000,
    };

    console.log(`[Orchestrator] Initialized with maxWorkers=${this.maxWorkers}, queueSize=${taskQueue.size()}`);
  }

  // ============================================
  // Main execution
  // ============================================

  /**
   * Run all tasks in the queue to completion.
   * Returns when all tasks are done, failed, or drained.
   */
  async run(): Promise<OrchestratorResult<T>> {
    this.isRunning = true;

    // Start periodic checkpoint
    this.startPeriodicCheckpoint();

    // Create initial batch of workers
    await this.lock.runExclusive(() => {
      this.spawnAvailableWorkers();
    });

    // Wait for all tasks to complete
    if (this.runningTasks.size > 0 || !this.taskQueue.isEmpty()) {
      await new Promise<void>((resolve) => {
        this.allDoneResolve = resolve;
      });
    }

    // Cleanup
    this.isRunning = false;
    this.stopPeriodicCheckpoint();

    const result: OrchestratorResult<T> = {
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      remainingQueue: this.taskQueue.getAll(),
      tokenUsage: this.accumulatedTokenUsage,
      hasFailures: this.failedTasks.length > 0,
      hasInterruptedTasks: this.hasInterruptedTasks,
      ...(this.draining ? { drainReason: this.failedTasks[0]?.error.message || 'unknown' } : {}),
    };

    console.log(`[Orchestrator] Finished. completed=${result.completedTasks.length}, failed=${result.failedTasks.length}, remaining=${result.remainingQueue.length}, interrupted=${this.hasInterruptedTasks}`);
    return result;
  }

  // ============================================
  // Task assignment (called by workers)
  // ============================================

  /**
   * Request the next available task for a worker.
   * Returns null if no compatible task is available or draining.
   */
  async requestTask(workerId: number): Promise<T | null> {
    return this.lock.runExclusive(() => {
      if (this.draining) return null;
      if (this.taskQueue.isEmpty()) return null;

      const next = this.taskQueue.peek();
      if (!next) return null;

      // Exclusive task: must wait until all running tasks complete
      if (next.exclusive) {
        if (this.runningTasks.size > 0) return null;
        const task = this.taskQueue.pop()!;
        return this.assignTask(workerId, task);
      }

      // Non-exclusive: find a compatible task
      return this.findAndAssignNonConflictingTask(workerId);
    });
  }

  /**
   * Report successful task completion.
   */
  async reportCompletion(workerId: number, task: T, tokenUsage?: TaskTokenUsage): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.runningTasks.delete(workerId);
      task.completed = true;
      this.completedTasks.push(task);

      if (tokenUsage) {
        this.addTokenUsage(tokenUsage);
      }

      this.callbacks.onTaskComplete?.(task, workerId);
      this.broadcastKanban();

      console.log(`[Orchestrator] Task "${task.name}" completed by worker ${workerId}. running=${this.runningTasks.size}, queue=${this.taskQueue.size()}`);

      // ✅ Save checkpoint after each task completion
      // Critical: If the process is killed (e.g., user stop), the session file
      // must contain the latest completedTasks. Without this, the 60s periodic
      // checkpoint may not have saved yet, causing state loss on cancellation.
      try {
        await this.saveCheckpoint();
      } catch (err) {
        console.warn(`[Orchestrator] Post-completion checkpoint failed:`, err);
      }

      // Try to spawn more workers for newly available tasks
      this.spawnAvailableWorkers();

      this.checkAllDone();
    });
  }

  /**
   * Report task failure.
   *
   * Strategy:
   * 1. Classify error as deterministic vs transient.
   * 2. Deterministic errors (prompt too long, 400, auth) → fail immediately, no retry.
   * 3. Transient errors (timeout, rate limit, 5xx) → re-queue up to MAX_TASK_RETRIES.
   * 4. Failed tasks stay tracked; orchestrator does NOT drain on failure.
   *    All in-progress tasks are allowed to complete.
   * 5. After orchestration finishes, caller checks failedTasks to decide
   *    whether the job is "completed" or "interrupted".
   */
  async reportFailure(workerId: number, task: T, error: Error): Promise<void> {
    const MAX_TASK_RETRIES = 2;

    await this.lock.runExclusive(async () => {
      this.runningTasks.delete(workerId);

      this.callbacks.onTaskFailure?.(task, error, workerId);

      // ✅ Recursion limit: special handling — pause (not fail), no retry.
      // The task is placed back at the front of the queue as interrupted.
      // Other workers continue their current tasks; the job will be marked
      // as interrupted after all workers finish (via hasInterruptedTasks).
      if (isRecursionLimitError(error)) {
        task.interrupted = true;
        this.taskQueue.unshift(task);
        this.hasInterruptedTasks = true;
        console.warn(
          `[Orchestrator] Task "${task.name}" PAUSED (recursion limit reached, worker ${workerId}) — queued for resume`,
        );

        try {
          await this.saveCheckpoint({ reason: 'recursion_limit', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-pause checkpoint failed:`, err);
        }

        this.broadcastKanban();
        this.spawnAvailableWorkers();
        this.checkAllDone();
        return;
      }

      const attempts = ((task as any)._failedAttempts || 0) + 1;
      (task as any)._failedAttempts = attempts;

      const deterministic = isDeterministicError(error);

      if (deterministic || attempts >= MAX_TASK_RETRIES) {
        // Permanently failed — add to failedTasks list
        this.failedTasks.push({
          task,
          error,
          timestamp: new Date().toISOString(),
        });

        if (deterministic) {
          console.error(
            `[Orchestrator] Task "${task.name}" FAILED with deterministic error (worker ${workerId}), no retry: ${error.message}`,
          );
        } else {
          console.error(
            `[Orchestrator] Task "${task.name}" PERMANENTLY FAILED after ${attempts} attempts (worker ${workerId}): ${error.message}`,
          );
        }
      } else {
        // Transient error — re-queue for retry
        task.interrupted = true;
        (task as any).resumeState = undefined; // Fresh start on retry
        this.taskQueue.push(task);
        console.warn(
          `[Orchestrator] Task "${task.name}" FAILED (attempt ${attempts}/${MAX_TASK_RETRIES}, worker ${workerId}): ${error.message} — re-queued for retry`,
        );
      }

      // Save checkpoint after failure (ensure state persistence)
      try {
        await this.saveCheckpoint();
      } catch (err) {
        console.warn(`[Orchestrator] Post-failure checkpoint failed:`, err);
      }

      // Spawn workers for newly available slots
      this.spawnAvailableWorkers();

      this.checkAllDone();
    });
  }

  // ============================================
  // Internal helpers
  // ============================================

  private findAndAssignNonConflictingTask(workerId: number): T | null {
    const runningGroups = new Set<string>();
    for (const task of this.runningTasks.values()) {
      if (task.parallelGroup) {
        runningGroups.add(task.parallelGroup);
      }
    }

    for (const task of this.taskQueue.getAll()) {
      // Exclusive task acts as a barrier
      if (task.exclusive) break;

      // No parallelGroup = conservative solo execution
      if (!task.parallelGroup) {
        if (this.runningTasks.size > 0) continue;
        this.taskQueue.removeById(task.id);
        return this.assignTask(workerId, task);
      }

      // Same group running = conflict
      if (runningGroups.has(task.parallelGroup)) continue;

      // No conflict — assign
      this.taskQueue.removeById(task.id);
      return this.assignTask(workerId, task);
    }

    return null;
  }

  private assignTask(workerId: number, task: T): T {
    // ✅ Initialize timing.startedAt so in-progress tasks show elapsed time in Kanban
    // TaskTimingHelper.startTask() in plan node will see existing timing and skip (no-op)
    if (!task.timing) {
      task.timing = {
        startedAt: new Date().toISOString(),
        totalPausedDuration: 0,
      };
    } else if (!task.timing.startedAt) {
      task.timing.startedAt = new Date().toISOString();
    }

    this.runningTasks.set(workerId, task);
    // Broadcast kanban immediately when task starts (not just on completion)
    this.broadcastKanban();
    return task;
  }

  private spawnAvailableWorkers(): void {
    if (this.draining) return;

    // Count how many more workers we can spawn
    const currentWorkerCount = this.workers.size;
    const slotsAvailable = this.maxWorkers - currentWorkerCount;
    if (slotsAvailable <= 0) return;

    // Peek ahead to see how many parallelizable tasks exist
    const runningGroups = new Set<string>();
    for (const task of this.runningTasks.values()) {
      if (task.parallelGroup) runningGroups.add(task.parallelGroup);
    }

    let potentialTasks = 0;
    for (const task of this.taskQueue.getAll()) {
      if (task.exclusive) break;
      if (!task.parallelGroup) {
        if (this.runningTasks.size === 0 && potentialTasks === 0) potentialTasks++;
        continue;
      }
      if (!runningGroups.has(task.parallelGroup)) {
        runningGroups.add(task.parallelGroup);
        potentialTasks++;
      }
    }

    // Also need a worker if queue has an exclusive task and nothing is running
    if (potentialTasks === 0 && this.runningTasks.size === 0 && !this.taskQueue.isEmpty()) {
      potentialTasks = 1;
    }

    // Subtract workers that already exist but are idle (between tasks)
    const idleWorkers = currentWorkerCount - this.runningTasks.size;
    const workersNeeded = Math.max(0, potentialTasks - idleWorkers);
    const workersToCreate = Math.min(workersNeeded, slotsAvailable);

    for (let i = 0; i < workersToCreate; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const workerId = this.nextWorkerId++;
    const worker = new TaskWorker<T>(
      workerId,
      this,
      this.graphBuilder,
      this.sharedContext,
    );

    this.workers.set(workerId, worker);
    console.log(`[Orchestrator] Spawned worker ${workerId}. total=${this.workers.size}`);

    // Start the worker loop (fire-and-forget)
    worker.run().then(() => {
      this.workers.delete(workerId);
      console.log(`[Orchestrator] Worker ${workerId} terminated. remaining=${this.workers.size}`);

      // After a worker dies, check if everything is done
      this.lock.runExclusive(() => {
        this.checkAllDone();
      });
    });
  }

  private checkAllDone(): void {
    if (this.runningTasks.size === 0 && (this.taskQueue.isEmpty() || this.draining)) {
      this.allDoneResolve?.();
      this.allDoneResolve = null;
    }
  }

  private broadcastKanban(): void {
    const currentTasks = Array.from(this.runningTasks.values());
    this.callbacks.onKanbanUpdate?.(
      currentTasks,
      this.taskQueue.getAll(),
      this.completedTasks,
      this.accumulatedTokenUsage,
    );
  }

  private addTokenUsage(usage: TaskTokenUsage): void {
    this.accumulatedTokenUsage.inputTokens += usage.inputTokens;
    this.accumulatedTokenUsage.outputTokens += usage.outputTokens;
    this.accumulatedTokenUsage.totalTokens += usage.totalTokens;
    this.accumulatedTokenUsage.cacheReadTokens = 
      (this.accumulatedTokenUsage.cacheReadTokens || 0) + (usage.cacheReadTokens || 0);
    this.accumulatedTokenUsage.cacheCreationTokens = 
      (this.accumulatedTokenUsage.cacheCreationTokens || 0) + (usage.cacheCreationTokens || 0);
  }

  // ============================================
  // Checkpoint
  // ============================================

  private startPeriodicCheckpoint(): void {
    if (this.config.checkpointInterval <= 0) return;

    this.checkpointTimer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.saveCheckpoint();
      } catch (err) {
        console.warn(`[Orchestrator] Periodic checkpoint failed:`, err);
      }
    }, this.config.checkpointInterval);
  }

  private stopPeriodicCheckpoint(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  private async saveCheckpoint(interruption?: { reason: string; canResume: boolean }): Promise<void> {
    // ✅ Include running tasks in the checkpoint queue (marked as interrupted)
    // so they are NOT lost if the process is killed before workers complete.
    // Running tasks are placed at the FRONT of the queue for priority on resume.
    const runningAsTasks: T[] = [];
    for (const task of this.runningTasks.values()) {
      runningAsTasks.push({
        ...task,
        interrupted: true,
      } as T);
    }
    const fullQueue = [...runningAsTasks, ...this.taskQueue.getAll()];

    const checkpoint: ParallelCheckpoint<T> = {
      taskQueue: fullQueue,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      tokenUsage: this.accumulatedTokenUsage,
      parallelMode: true,
      ...(interruption ? { interruption } : {}),
    };

    await this.callbacks.onCheckpoint?.(checkpoint);
  }

  // ============================================
  // Getters for external inspection
  // ============================================

  getRunningTasks(): T[] {
    return Array.from(this.runningTasks.values());
  }

  getCompletedTasks(): T[] {
    return [...this.completedTasks];
  }

  isDraining(): boolean {
    return this.draining;
  }

  // ============================================
  // Interruption handling
  // ============================================

  /**
   * Stop accepting new tasks and halt periodic checkpointing.
   */
  private drain(): void {
    this.draining = true;
    this.stopPeriodicCheckpoint();
  }

  /**
   * Signal all active workers to stop after their current iteration.
   */
  private signalWorkersToStop(): void {
    for (const worker of this.workers.values()) {
      worker.requestStop();
    }
  }

  /**
   * Handle external interruption (e.g. SIGTERM via graceful shutdown).
   * 
   * Flow:
   *   1. drain()                — stop new task dispatch + periodic checkpoint
   *   2. signalWorkersToStop()  — workers exit after current iteration
   *   3. saveCheckpoint()       — running tasks pushed back to queue as interrupted
   *   4. checkAllDone()         — resolve run() if no running tasks remain
   * 
   * Called by gracefulShutdown.ts when the process receives SIGTERM.
   */
  async handleInterruption(reason: string): Promise<void> {
    console.log(`[TaskOrchestrator] handleInterruption called: ${reason}`);

    await this.lock.runExclusive(async () => {
      this.drain();
      this.signalWorkersToStop();
      await this.saveCheckpoint({ reason, canResume: true });
      this.checkAllDone();
    });
  }
}
