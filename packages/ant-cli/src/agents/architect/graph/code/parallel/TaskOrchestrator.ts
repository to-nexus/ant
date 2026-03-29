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
    /\b(400|401|403|404)\b.*\{/.test(msg) ||
    // Call budget exhausted — retrying would repeat the same non-productive loop
    /exhausted call budget/i.test(msg)
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

/**
 * Check if an error is a network/timeout error (e.g. computer sleep, network down).
 * Consecutive timeouts across tasks indicate infrastructure-level issues.
 */
function isTimeoutError(error: Error): boolean {
  const msg = error.message || '';
  return (
    /timed? ?out/i.test(msg) ||
    /ETIMEDOUT/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /ENOTFOUND/i.test(msg) ||
    /network/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /fetch failed/i.test(msg)
  );
}

const CONSECUTIVE_TIMEOUT_LIMIT = 3;

// ============================================
// Barrier predicates — shared by findAndAssignNonConflictingTask + spawnAvailableWorkers
// ============================================
function isFoundationTask<T extends BaseTask>(t: T): boolean {
  return t.priority >= 200 && t.priority <= 299;
}
function isFeatureOrSetupTask<T extends BaseTask>(t: T): boolean {
  return t.type === 'feature' || t.type === 'setup';
}
function isPreDocTask<T extends BaseTask>(t: T): boolean {
  return t.type === 'feature' || t.type === 'setup' || t.type === 'test-code';
}
function isTokensTask<T extends BaseTask>(t: T): boolean {
  return t.priority >= 100 && t.priority <= 199;
}
function isTokensOrAssetsTask<T extends BaseTask>(t: T): boolean {
  return t.priority >= 100 && t.priority <= 299;
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
  
  // Tracks whether any task was paused due to recursion limit, user stop, etc.
  // Unlike failedTasks (permanent), interrupted tasks remain in the queue for resume.
  private hasInterruptedTasks = false;
  private interruptReason: string | null = null;

  // Consecutive timeout counter across all tasks.
  // Reset on any non-timeout error or success. When it reaches CONSECUTIVE_TIMEOUT_LIMIT,
  // the orchestrator pauses (interrupt) — indicates infrastructure-level issues (sleep, network).
  private consecutiveTimeouts = 0;

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
    initialCompletedTasks?: T[],
  ) {
    this.taskQueue = taskQueue;
    this.graphBuilder = graphBuilder;
    this.sharedContext = sharedContext;
    this.callbacks = callbacks;
    this.completedTasks = initialCompletedTasks ?? [];
    this.maxWorkers = config?.maxWorkers ?? getTaskConcurrency();
    this.config = {
      maxWorkers: this.maxWorkers,
      checkpointInterval: config?.checkpointInterval ?? 60_000,
      barriers: config?.barriers,
    };

    console.log(`[Orchestrator] Initialized with maxWorkers=${this.maxWorkers}, queueSize=${taskQueue.size()}, previouslyCompleted=${this.completedTasks.length}`);
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
      interruptReason: this.interruptReason,
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

      // Guard: Prevent duplicate completion (defense against overlapping child processes)
      const alreadyCompleted = this.completedTasks.some(t => t.id === task.id);
      const reEnqueued = this.taskQueue.getAll().some(t => t.id === task.id);
      if (alreadyCompleted || reEnqueued) {
        console.warn(`[Orchestrator] Task "${task.name}" skipped completion (worker ${workerId}): alreadyCompleted=${alreadyCompleted}, reEnqueued=${reEnqueued}`);
        this.broadcastKanban();
        this.spawnAvailableWorkers();
        this.checkAllDone();
        return;
      }

      task.completed = true;
      task.interrupted = false;  // Clear safety-checkpoint marker from periodic saveCheckpoint()
      this.completedTasks.push(task);
      this.consecutiveTimeouts = 0;

      if (tokenUsage) {
        this.addTokenUsage(tokenUsage);
      }

      this.callbacks.onTaskComplete?.(task, workerId);
      this.broadcastKanban();

      // ✅ If this task was previously interrupted (e.g. recursion limit retry),
      // check whether ALL interrupted tasks have now been resolved.
      // Without this, hasInterruptedTasks stays true even after retried tasks succeed,
      // causing a spurious "Task cancelled" card despite all tasks completing.
      if (task.interrupted && this.hasInterruptedTasks) {
        const hasRemainingInterrupted =
          this.taskQueue.getAll().some(t => t.interrupted) ||
          Array.from(this.runningTasks.values()).some(t => t.interrupted);
        if (!hasRemainingInterrupted) {
          this.hasInterruptedTasks = false;
          console.log(`[Orchestrator] All previously-interrupted tasks resolved → hasInterruptedTasks = false`);
        }
      }

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
   * Task was batch-split and re-enqueued — release worker slot WITHOUT marking task as completed.
   * The task will run again from the queue after its generated sub-tasks complete.
   */
  async reportBatchSplit(workerId: number, task: T): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.runningTasks.delete(workerId);
      // Do NOT add to completedTasks — task is back in todo (re-enqueued by processDiagnosticBatchSplit)
      this.broadcastKanban();
      console.log(`[Orchestrator] Task "${task.name}" batch-split by worker ${workerId}. running=${this.runningTasks.size}, queue=${this.taskQueue.size()}`);

      // Save checkpoint after batch split (ensures re-enqueued state persists)
      try {
        await this.saveCheckpoint();
      } catch (err) {
        console.warn(`[Orchestrator] Post-batch-split checkpoint failed:`, err);
      }

      this.spawnAvailableWorkers();
      this.checkAllDone();
    });
  }

  /**
   * Report that a task was stopped (not completed, not failed).
   * Called when the worker subgraph returns _taskCompleted: false (e.g. user stop).
   *
   * The task is returned to the queue as interrupted so it is NOT lost — this is
   * critical because reportStopped may acquire the lock BEFORE handleInterruption,
   * and without re-queuing, the task would vanish from all lists.
   *
   * No checkpoint is saved here; handleInterruption is responsible for the
   * definitive interruption checkpoint.
   */
  async reportStopped(workerId: number): Promise<void> {
    await this.lock.runExclusive(async () => {
      const task = this.runningTasks.get(workerId);
      this.runningTasks.delete(workerId);

      if (task) {
        task.interrupted = true;
        this.taskQueue.push(task);
        console.log(`[Orchestrator] Task "${task.name}" stopped by worker ${workerId} — returned to queue. running=${this.runningTasks.size}, queue=${this.taskQueue.size()}`);
      } else {
        console.warn(`[Orchestrator] reportStopped: no task found for worker ${workerId}`);
      }

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

      // ✅ Consecutive timeout detection: if infrastructure is down (sleep, network),
      // all LLM calls will timeout. Pause orchestrator instead of burning retries.
      if (isTimeoutError(error)) {
        this.consecutiveTimeouts++;
        if (this.consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_LIMIT) {
          console.error(
            `[Orchestrator] ${this.consecutiveTimeouts} consecutive timeout errors detected — infrastructure may be down. Pausing orchestrator.`,
          );
          task.interrupted = true;
          this.hasInterruptedTasks = true;
          this.failedTasks.push({
            task,
            error: new Error(`Task interrupted: ${this.consecutiveTimeouts} consecutive timeouts (${error.message})`),
            timestamp: new Date().toISOString(),
          });
          const runningTaskIdsOnTimeout = Array.from(this.runningTasks.values()).map(t => t.id);
          this.callbacks.onInterruption?.('consecutive_timeouts', runningTaskIdsOnTimeout);
          try {
            await this.saveCheckpoint({ reason: 'consecutive_timeouts', canResume: true });
          } catch (err) {
            console.warn(`[Orchestrator] Post-timeout-interrupt checkpoint failed:`, err);
          }
          this.drain();
          this.signalWorkersToStop();
          this.broadcastKanban();
          this.checkAllDone();
          return;
        }
      } else {
        this.consecutiveTimeouts = 0;
      }

      // ✅ Recursion limit: immediate interrupt — do NOT re-queue.
      // Re-queuing the same task with the same recursion budget causes an
      // infinite loop (task runs → hits limit → re-queued → runs again → …).
      // Instead, treat as a permanent failure and let the orchestrator finish.
      // The task is added to failedTasks so it is tracked in the result and
      // the upstream parallelOrchestrator can save it for resume.
      if (isRecursionLimitError(error)) {
        task.interrupted = true;
        this.hasInterruptedTasks = true;
        this.failedTasks.push({
          task,
          error,
          timestamp: new Date().toISOString(),
        });
        console.error(
          `[Orchestrator] Task "${task.name}" INTERRUPTED — recursion limit reached (worker ${workerId})`,
        );

        // Notify only for this specific task (other workers may still be running)
        this.callbacks.onInterruption?.('recursion_limit', [task.id]);

        try {
          await this.saveCheckpoint({ reason: 'recursion_limit', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-interrupt checkpoint failed:`, err);
        }

        this.broadcastKanban();
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

        // Skip remaining verification/final tasks — running them after failure is pointless.
        const remaining = this.taskQueue.getAll();
        const allRemainingAreFinal = remaining.length > 0 && remaining.every(
          t => t.type === 'verification' || t.priority >= 1000
        );
        if (allRemainingAreFinal && this.runningTasks.size === 0) {
          for (const t of remaining) {
            this.taskQueue.pop();
            this.failedTasks.push({
              task: t,
              error: new Error(`Skipped: predecessor task "${task.name}" failed`),
              timestamp: new Date().toISOString(),
            });
          }
          console.warn(
            `[Orchestrator] Draining: ${remaining.length} verification/final task(s) skipped due to predecessor failure`,
          );
        }

        // Always drain on permanent failure — let running tasks finish, but don't start new ones.
        this.drain();
        this.broadcastKanban();
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

      // Only spawn new workers if not draining (transient error re-queue case)
      if (!this.draining) {
        this.spawnAvailableWorkers();
      }

      this.checkAllDone();
    });
  }

  // ============================================
  // Internal helpers
  // ============================================

  private computeBarriers() {
    const b = this.config.barriers;
    const running = Array.from(this.runningTasks.values());
    const queued = this.taskQueue.getAll();
    return {
      hasPreFeatureWork: !!b?.feature && (
        running.some(isFoundationTask) || queued.some(isFoundationTask)
      ),
      hasPreUiWork: !!b?.ui && (
        running.some(isFeatureOrSetupTask) || queued.some(isFeatureOrSetupTask)
      ),
      hasPreTestgenWork: !!b?.['test-code'] && (
        running.some(isFeatureOrSetupTask) || queued.some(isFeatureOrSetupTask)
      ),
      hasPreDocWork: !!b?.doc && (
        running.some(isPreDocTask) || queued.some(isPreDocTask)
      ),
      hasPreAssetsWork: !!b?.assets && (
        running.some(isTokensTask) || queued.some(isTokensTask)
      ),
      hasPreSpecWork: !!b?.spec && (
        running.some(isTokensOrAssetsTask) || queued.some(isTokensOrAssetsTask)
      ),
    };
  }

  private findAndAssignNonConflictingTask(workerId: number): T | null {
    const runningGroups = new Set<string>();
    for (const task of this.runningTasks.values()) {
      if (task.parallelGroup) {
        runningGroups.add(task.parallelGroup);
      }
    }

    const { hasPreFeatureWork, hasPreTestgenWork, hasPreDocWork, hasPreUiWork, hasPreAssetsWork, hasPreSpecWork } =
      this.computeBarriers();

    for (const task of this.taskQueue.getAll()) {
      // Exclusive task acts as a barrier
      if (task.exclusive) break;

      // Feature barrier: don't assign feature/integration tasks while foundation work exists
      if (hasPreFeatureWork && task.priority >= 300 && task.type !== 'test-code' && task.type !== 'doc') {
        break;
      }

      // Testgen barrier: don't assign testgen tasks while feature/setup work exists
      if (hasPreTestgenWork && task.type === 'test-code') {
        break;
      }

      // Doc barrier: don't assign doc tasks while feature/setup/testgen work exists
      if (hasPreDocWork && task.type === 'doc') {
        break;
      }

      // UI barrier: don't assign ui tasks while feature/setup work exists
      if (hasPreUiWork && task.type === 'ui') break;

      // Assets barrier: don't assign assets (200+) while tokens (100-199) work exists
      if (hasPreAssetsWork && task.priority >= 200) break;

      // Spec barrier: don't assign spec (300+) while tokens+assets (100-299) work exists
      if (hasPreSpecWork && task.priority >= 300) break;

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
    // Always reset timing — stale startedAt from failed/checkpoint-restored tasks
    // would cause cumulative elapsed time across sequential tasks.
    task.timing = {
      startedAt: new Date().toISOString(),
      totalPausedDuration: 0,
    };

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

    const { hasPreFeatureWork, hasPreTestgenWork, hasPreDocWork, hasPreUiWork, hasPreAssetsWork, hasPreSpecWork } =
      this.computeBarriers();

    let potentialTasks = 0;
    for (const task of this.taskQueue.getAll()) {
      if (task.exclusive) break;
      if (hasPreFeatureWork && task.priority >= 300 && task.type !== 'test-code' && task.type !== 'doc') break;
      if (hasPreTestgenWork && task.type === 'test-code') break;
      if (hasPreDocWork && task.type === 'doc') break;
      if (hasPreUiWork && task.type === 'ui') break;
      if (hasPreAssetsWork && task.priority >= 200) break;
      if (hasPreSpecWork && task.priority >= 300) break;
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

      // ✅ Immediately notify caller so it can clear this worker's stale
      // workflow entry (badge). Without this, the worker's last-active-node
      // stays visible in the UI until ALL workers finish.
      this.callbacks.onWorkerTerminate?.(workerId);

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
    const queue = this.taskQueue.getAll();

    // Include failed tasks in queue with _failed marker so UI can display them
    const failedAsQueue = this.failedTasks.map(f => ({
      ...f.task,
      _failed: true,
    }));

    this.callbacks.onKanbanUpdate?.(
      currentTasks,
      [...queue, ...failedAsQueue],
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
    // Deduplicate: if batch-split re-enqueued a task that is still in runningTasks,
    // the running version (with latest timing/tokenUsage) takes precedence.
    const runningIds = new Set(runningAsTasks.map(t => t.id));
    const queueTasks = this.taskQueue.getAll().filter(t => !runningIds.has(t.id));
    const fullQueue = [...runningAsTasks, ...queueTasks];

    // Use explicit param if provided; otherwise fall back to instance state.
    // This prevents post-interruption checkpoint saves (e.g. from reportCompletion)
    // from overwriting the interruption metadata that handleInterruption saved.
    const effectiveInterruption = interruption ??
      (this.hasInterruptedTasks && this.interruptReason
        ? { reason: this.interruptReason, canResume: true }
        : undefined);

    const checkpoint: ParallelCheckpoint<T> = {
      taskQueue: fullQueue,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      tokenUsage: this.accumulatedTokenUsage,
      parallelMode: true,
      ...(effectiveInterruption ? { interruption: effectiveInterruption } : {}),
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
      this.hasInterruptedTasks = true;
      this.interruptReason = reason;
      this.drain();
      this.signalWorkersToStop();
      const runningTaskIds = Array.from(this.runningTasks.values()).map(t => t.id);
      this.callbacks.onInterruption?.(reason, runningTaskIds);
      await this.saveCheckpoint({ reason, canResume: true });
      this.broadcastKanban();
      this.checkAllDone();
    });
  }
}
