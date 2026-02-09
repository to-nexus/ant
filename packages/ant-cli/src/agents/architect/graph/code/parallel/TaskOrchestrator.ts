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
      ...(this.draining ? { drainReason: this.failedTasks[0]?.error.message || 'unknown' } : {}),
    };

    console.log(`[Orchestrator] Finished. completed=${result.completedTasks.length}, failed=${result.failedTasks.length}, remaining=${result.remainingQueue.length}`);
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
   * Report task failure. Triggers graceful drain.
   */
  async reportFailure(workerId: number, task: T, error: Error): Promise<void> {
    await this.lock.runExclusive(() => {
      this.runningTasks.delete(workerId);
      this.failedTasks.push({
        task,
        error,
        timestamp: new Date().toISOString(),
      });

      this.callbacks.onTaskFailure?.(task, error, workerId);

      // Enter drain mode: stop assigning new tasks
      this.draining = true;
      console.error(`[Orchestrator] Task "${task.name}" FAILED (worker ${workerId}). Draining... running=${this.runningTasks.size}`);

      // If no more running tasks, we're done
      this.checkAllDone();
    });
  }

  // ============================================
  // Interruption handling
  // ============================================

  /**
   * Gracefully interrupt all running workers.
   * Captures each worker's state and pushes interrupted tasks back to queue.
   */
  async handleInterruption(reason: string): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.draining = true;

      // Signal all workers to stop
      for (const worker of this.workers.values()) {
        worker.requestStop();
      }

      // Wait for workers to finish current operations and capture state
      for (const [wId, worker] of this.workers) {
        const task = this.runningTasks.get(wId);
        if (!task) continue;

        const snapshot = await worker.captureState();
        task.interrupted = true;

        // Store resume state in the task itself
        if (snapshot && 'resumeState' in task) {
          (task as any).resumeState = {
            planText: snapshot.planText || '',
            conversationHistory: snapshot.conversationHistory || [],
            projectCodeContext: snapshot.projectCodeContext,
            retries: snapshot.retries || 0,
            violations: snapshot.violations,
            enforcementHistory: snapshot.enforcementHistory,
            tokenUsage: snapshot.tokenUsage,
          };
        }

        this.taskQueue.push(task);
        this.runningTasks.delete(wId);
      }

      // Save checkpoint
      await this.saveCheckpoint({
        reason,
        canResume: true,
      });

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
}
