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
 * - Uses exclusive + parallelGroup + barrier predicates (type + priority)
 * - Single-process async/await parallelism (no Worker Threads)
 * - AsyncMutex for shared state access
 */

import type { BaseTask, TaskTokenUsage, TokenUsageByModel } from '@ant/shared';
import { TaskQueue } from '../../../types/task';
import { TaskTimingHelper } from '../state';
import { AsyncMutex } from '../../../../../core/utils/AsyncMutex';
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
import { isFigmaRateLimitError, isFigmaMCPConnectionError } from '../../../../../periphery/adapters/figma/errors';
import { classifyTerminalError } from '../tasks/_shared/verify/terminal/errors';
import { VerificationBudget, BUDGET_THRESHOLDS } from '../tasks/_shared/verify/terminal/budget';
import { hooksForTaskType } from '../tasks/_shared/registry';
import { buildResumableFailedTask } from './resumeBudgetReset';
import type { CodeTask } from '../../../types/task';
import type { TaskType } from '@ant/shared';

/**
 * Classify whether an error is deterministic (will always fail on retry)
 * vs transient (may succeed on retry).
 *
 * Deterministic errors should NOT be retried — doing so wastes tokens and time.
 *
 * Historical note: this regex used to carry an `exhausted call budget` clause
 * that pattern-matched TaskWorker's string throw. The plan node later threw
 * a DIFFERENT message ("failed after N attempts") which fell through every
 * regex → orchestrator classified it as transient → infinite re-queue
 * (the `re-queue retry-budget reset` incident). Both throw sites now emit typed
 * `VerificationTerminalError` which is classified via `classifyTerminalError`
 * BEFORE this regex runs. Kept as a safety net for upstream Anthropic errors.
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
//
// The parallel layer is blind to BOTH `task.type` AND raw `task.priority`
// bands (R1 + D31 — NODE_GRAPH_LAYOUT.md / classify model). Every predicate
// below dispatches through a task's scheduling hook:
//
//   - Static boolean flags (blocksUi / blocksTestgen / blocksDoc /
//     blocksIntegration / preIntegrationBarrier / preTestgenBarrier /
//     preDocBarrier / preUiBarrier) — uniform across a bundle's tasks.
//     Looked up via `schedBlocks(t, flag)`.
//   - Per-task classifier flags (isFoundation / isTokens / isFinal /
//     producesIntegrationGate / consumesIntegrationGate / expandedRagQuota)
//     — priority-band-driven. Looked up via `schedClassify(t, flag)`.
//
// The bundles are the SSOT for "my priority band X means scheduling role Y";
// the orchestrator never reads `task.priority` as a number comparator.

/** Ask a task's scheduling hook whether it activates the named barrier. */
function schedBlocks<T extends BaseTask>(
  t: T,
  flag: 'blocksUi' | 'blocksTestgen' | 'blocksDoc' | 'blocksIntegration',
): boolean {
  return !!hooksForTaskType(t.type as TaskType)?.scheduling?.[flag];
}

/**
 * Dispatch a per-task classifier flag through the bundle's `classify`
 * function. Returns `false` when either (a) the bundle publishes no
 * classify hook, or (b) the classify result's flag is unset/false.
 */
function schedClassify<T extends BaseTask>(
  t: T,
  flag:
    | 'isFoundation'
    | 'isPlatform'
    | 'isTokens'
    | 'isFinal'
    | 'producesIntegrationGate'
    | 'consumesIntegrationGate'
    | 'producesSeamGate'
    | 'consumesSeamGate'
    | 'expandedRagQuota',
): boolean {
  const classify = hooksForTaskType(t.type as TaskType)?.scheduling?.classify;
  if (!classify) return false;
  return !!classify(t as BaseTask)[flag];
}

function isFoundationTask<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'isFoundation');
}
function isPlatformTask<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'isPlatform');
}
function isTokensTask<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'isTokens');
}
function isTokensOrAssetsTask<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'isTokens') || schedClassify(t, 'isFoundation');
}

/**
 * Integration barrier producer — a task counts as "pre-integration work"
 * when its bundle's classify reports `producesIntegrationGate: true`.
 * The ordinary-feature priority window (300–599) is owned by the feature
 * bundle's classify implementation; the orchestrator only asks.
 */
function isPreIntegrationWork<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'producesIntegrationGate');
}

/**
 * Seam barrier producer — a task counts as "pre-seam work" when its bundle's
 * classify reports `producesSeamGate: true` (every AUTHORING bundle: setup /
 * design-system / feature / ui). The seam pass (reference + affordance closure,
 * a `type:'seam'` task run AFTER ui) waits until the whole materialized graph,
 * including ui-introduced affordances, exists. Seam tasks themselves do NOT
 * produce the gate → seam sub-slices never block each other.
 */
function isPreSeamWork<T extends BaseTask>(t: T): boolean {
  return schedClassify(t, 'producesSeamGate');
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
  /** Per-model job-level accumulation, merged from each worker's per-task
   *  breakdown. Billing settle SSOT (priced per model). */
  private accumulatedTokenUsageByModel: TokenUsageByModel = {};

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
      const assigned = this.findAndAssignNonConflictingTask(workerId);
      if (assigned == null && this.runningTasks.size === 0) {
        // No running tasks AND head was rejected — barrier likely
        // blocking. Surface the head's discriminators so deadlocks
        // become observable instead of looping silently on the 60s
        // checkpoint timer.
        const band = (next as { band?: string }).band ?? '<none>';
        console.warn(
          `[Orchestrator] requestTask(${workerId}) returned null with non-empty queue ` +
          `(size=${this.taskQueue.size()}); head: id=${next.id}, priority=${next.priority}, ` +
          `type=${next.type}, band=${band}, exclusive=${next.exclusive ?? false} — ` +
          `barrier likely blocking`,
        );
      }
      return assigned;
    });
  }

  /**
   * Report successful task completion.
   */
  async reportCompletion(workerId: number, task: T, tokenUsage?: TaskTokenUsage, tokenUsageByModel?: TokenUsageByModel): Promise<void> {
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
      // Defensive clear of re-entry marker. TaskWorker L298 typically clears
      // it after `resumeState` restore, but paths that bypass resumeState
      // (batchSplit Path A without snapshot, transient retry without capture)
      // leave the marker on the live `runningTasks` entry until completion.
      // Idempotent when already false.
      task.interrupted = false;
      this.completedTasks.push(task);
      this.consecutiveTimeouts = 0;

      if (tokenUsage) {
        this.addTokenUsage(tokenUsage);
      }
      if (tokenUsageByModel) {
        this.addTokenUsageByModel(tokenUsageByModel);
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

      // ✅ Credit exhaustion: live metering (KanbanBroadcaster) floored the
      // balance to 0. This task boundary is a safe place to pause — drain so no
      // new task is assigned, mark the remaining queue interrupted, and save a
      // resumable checkpoint. After a top-up the job resumes from here. Only
      // interrupt when work remains; an empty queue is already finishing.
      if (
        this.callbacks.isCreditExhausted?.() &&
        !this.hasInterruptedTasks &&
        !this.taskQueue.isEmpty()
      ) {
        // Mirror the proven figma/timeout inline-interrupt pattern: flag the
        // interruption, save a resumable checkpoint, drain, and stop workers
        // (each in-flight worker re-queues its task as interrupted via
        // reportStopped). Pending queue tasks stay queued and resume fresh.
        this.hasInterruptedTasks = true;
        this.interruptReason = 'insufficient_credits';
        const runningIds = Array.from(this.runningTasks.values()).map(t => t.id);
        console.error(`[Orchestrator] Credit balance exhausted — pausing job (resumable)`);
        this.callbacks.onInterruption?.('insufficient_credits', runningIds);
        try {
          await this.saveCheckpoint({ reason: 'insufficient_credits', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-exhaustion checkpoint failed:`, err);
        }
        this.drain();
        this.signalWorkersToStop();
        this.checkAllDone();
        return;
      }

      // Try to spawn more workers for newly available tasks
      this.spawnAvailableWorkers();

      this.checkAllDone();
    });
  }

  /**
   * Task was batch-split and re-enqueued — release worker slot WITHOUT marking task as completed.
   * The task will run again from the queue after its generated sub-tasks complete.
   *
   * `supersededDetails` carries Path B (drop-and-replace) parents that the
   * worker subgraph captured via `_supersededDetails`. They are appended to
   * `completedTasks` here (NOT marked `completed:true` — `supersededBy` is
   * the lineage marker) so kanban tooltip rows + per-task accounting
   * (`task.timing.elapsedTime`, `task.tokenUsage`) survive the worker
   * boundary. Without this merge, Path B parents disappear silently in
   * parallel mode (worker-local `state.completedTasksDetails` is read-only).
   */
  async reportBatchSplit(
    workerId: number,
    task: T,
    supersededDetails?: BaseTask[],
  ): Promise<void> {
    await this.lock.runExclusive(async () => {
      this.runningTasks.delete(workerId);
      // Do NOT add the requeued task itself to completedTasks — it is back in
      // todo (Path A) or replaced by sub-tasks + FV (Path B). However, Path B
      // parent snapshots (carried in `supersededDetails`) DO go in so they
      // surface as their own kanban-done rows with timing/token attribution.
      if (supersededDetails && supersededDetails.length > 0) {
        for (const superseded of supersededDetails) {
          // Defence-in-depth: skip duplicates (e.g. retries that re-emit the
          // same parent id — shouldn't happen because the channel is drained
          // per cycle, but guards against any future writer that double-emits).
          if (this.completedTasks.some(t => t.id === superseded.id)) continue;
          this.completedTasks.push(superseded as T);
          console.log(`[Orchestrator] Task "${superseded.name}" superseded by batch-split (lineage=${(superseded as any).supersededBy?.join(',') ?? 'unknown'})`);
        }
      }
      this.broadcastKanban();
      console.log(`[Orchestrator] Task "${task.name}" batch-split by worker ${workerId}. running=${this.runningTasks.size}, queue=${this.taskQueue.size()}, superseded=${supersededDetails?.length ?? 0}`);

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
  async reportStopped(
    workerId: number,
    tokenUsage?: TaskTokenUsage,
    tokenUsageByModel?: TokenUsageByModel,
  ): Promise<void> {
    await this.lock.runExclusive(async () => {
      const task = this.runningTasks.get(workerId);
      this.runningTasks.delete(workerId);

      // Tokens spent before the stop are a real cost — bill them. The re-run
      // (fresh worker state) accumulates its own usage separately, so this is
      // additive, not double-counting.
      if (tokenUsage) this.addTokenUsage(tokenUsage);
      if (tokenUsageByModel) this.addTokenUsageByModel(tokenUsageByModel);

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
  async reportFailure(
    workerId: number,
    task: T,
    error: Error,
    tokenUsage?: TaskTokenUsage,
    tokenUsageByModel?: TokenUsageByModel,
  ): Promise<void> {
    const MAX_TASK_RETRIES = BUDGET_THRESHOLDS.MAX_TASK_RETRIES;

    await this.lock.runExclusive(async () => {
      this.runningTasks.delete(workerId);

      // Tokens consumed by the failed attempt are a real cost — bill them even
      // when the task is re-queued (the retry accumulates its own usage with a
      // fresh worker state, so this is additive). The bare-catch failure path
      // has no result and passes undefined.
      if (tokenUsage) this.addTokenUsage(tokenUsage);
      if (tokenUsageByModel) this.addTokenUsageByModel(tokenUsageByModel);

      this.callbacks.onTaskFailure?.(task, error, workerId);

      // ✅ Figma rate limit: immediate global interrupt — all tasks are blocked.
      // Inlined (not via handleInterruption) because AsyncMutex is non-reentrant.
      if (isFigmaRateLimitError(error)) {
        task.interrupted = true;
        this.hasInterruptedTasks = true;
        this.interruptReason = 'figma_rate_limited';
        this.failedTasks.push({ task, error, timestamp: new Date().toISOString() });
        console.error(`[Orchestrator] Figma rate limit — interrupting all tasks`);
        const runningTaskIds = Array.from(this.runningTasks.values()).map(t => t.id);
        this.callbacks.onInterruption?.('figma_rate_limited', runningTaskIds);
        try {
          await this.saveCheckpoint({ reason: 'figma_rate_limited', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-rate-limit checkpoint failed:`, err);
        }
        this.drain();
        this.signalWorkersToStop();
        this.broadcastKanban();
        this.checkAllDone();
        return;
      }

      // ✅ Figma connection lost: same global interrupt as rate limit
      if (isFigmaMCPConnectionError(error)) {
        task.interrupted = true;
        this.hasInterruptedTasks = true;
        this.interruptReason = 'figma_connection_lost';
        this.failedTasks.push({ task, error, timestamp: new Date().toISOString() });
        console.error(`[Orchestrator] Figma MCP connection lost — interrupting all tasks`);
        const runningTaskIds = Array.from(this.runningTasks.values()).map(t => t.id);
        this.callbacks.onInterruption?.('figma_connection_lost', runningTaskIds);
        try {
          await this.saveCheckpoint({ reason: 'figma_connection_lost', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-connection-lost checkpoint failed:`, err);
        }
        this.drain();
        this.signalWorkersToStop();
        this.broadcastKanban();
        this.checkAllDone();
        return;
      }

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

      // ✅ Recursion limit: immediate interrupt — do NOT re-queue + drain.
      // Re-queuing causes infinite loop (15508af5 RCA: same task with same
      // recursion budget re-hits). Instead:
      //  - task → failedTasks (permanent-failure semantics)
      //  - drain() → no new worker spawn, running workers finish normally
      //  - checkpoint with canResume:true → graph.ts persists session.interruption
      //    so FE shows the Resume prompt
      // Single-task scope (other workers' tasks are unrelated to the loop); we do
      // NOT signalWorkersToStop() — matches the permanent-failure handler below.
      if (isRecursionLimitError(error)) {
        task.interrupted = true;
        this.hasInterruptedTasks = true;
        this.interruptReason = 'recursion_limit';
        this.failedTasks.push({
          task,
          error,
          timestamp: new Date().toISOString(),
        });
        console.error(
          `[Orchestrator] Task "${task.name}" INTERRUPTED — recursion limit reached (worker ${workerId})`,
        );

        // Per-task SSE identifier for the FE chat surface (not a policy statement:
        // orchestrator is draining — other workers finish their current task and stop,
        // no new dispatch).
        this.callbacks.onInterruption?.('recursion_limit', [task.id]);

        try {
          await this.saveCheckpoint({ reason: 'recursion_limit', canResume: true });
        } catch (err) {
          console.warn(`[Orchestrator] Post-interrupt checkpoint failed:`, err);
        }

        this.drain();
        this.broadcastKanban();
        this.checkAllDone();
        return;
      }

      // Attempt counter: tasks that own their own counter (verification
      // via the Session, plus Tier 2 self-verify tasks once they enter
      // verify-mode) read through the hook so the Session-tracked
      // attempts carry across retries. All other tasks fall back to the
      // Every task — verification responsibility holders included — uses
      // the orchestrator's shared `_failedAttempts` counter. The legacy
      // `hasOwnAttemptCounter` orchestrator slot was retired by plan §5.6.1.
      const attempts = VerificationBudget.bumpOrchestratorFail(task as { _failedAttempts?: number });

      // Typed classification FIRST — catches `VerificationTerminalError` so
      // verification tasks never fall through to the generic regex branch.
      const terminal = classifyTerminalError(error);
      const deterministic = terminal.terminal || isDeterministicError(error);

      if (deterministic || attempts >= MAX_TASK_RETRIES) {
        // Permanently failed — add to failedTasks list
        this.failedTasks.push({
          task,
          error,
          timestamp: new Date().toISOString(),
        });

        if (terminal.terminal) {
          console.error(
            `[Orchestrator] Task "${task.name}" TERMINAL (kind=${terminal.kind}, worker ${workerId}): ${error.message}`,
          );
        } else if (deterministic) {
          console.error(
            `[Orchestrator] Task "${task.name}" FAILED with deterministic error (worker ${workerId}), no retry: ${error.message}`,
          );
        } else {
          console.error(
            `[Orchestrator] Task "${task.name}" PERMANENTLY FAILED after ${attempts} attempts (worker ${workerId}): ${error.message}`,
          );
        }

        // Skip remaining verification/final tasks — running them after failure is pointless.
        // A "final" task is identified by the verification bundle's
        // `classify(...).isFinal` flag (SSOT for "queue-terminal, drain-skip
        // on predecessor failure").
        const remaining = this.taskQueue.getAll();
        const isFinalTask = (t: T): boolean => schedClassify(t, 'isFinal');
        const allRemainingAreFinal = remaining.length > 0 && remaining.every(isFinalTask);
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
        // Transient error — re-queue for retry. Capture the worker's live
        // snapshot before returning the task to the queue so the next worker
        // invocation rehydrates verification attempt counter / tracker /
        // applied plan history. Fresh-start wipe was the source of "LLM
        // solution quality collapses on inline retries" — see the
        // `re-queue retry-budget reset` post-mortem: the historical claim of
        // "resumeState preserved" was aspirational; no site actually set it.
        const worker = this.workers.get(workerId);
        if (worker) {
          try {
            const snapshot = await worker.captureState();
            if (snapshot) (task as any).resumeState = snapshot;
          } catch (err) {
            console.warn(`[Orchestrator] captureState(worker ${workerId}) failed on transient re-queue:`, (err as Error).message);
          }
        }
        task.interrupted = true;
        this.taskQueue.push(task);
        console.warn(
          `[Orchestrator] Task "${task.name}" FAILED (attempt ${attempts}/${MAX_TASK_RETRIES}, worker ${workerId}): ${error.message} — re-queued for retry (resumeState preserved=${!!(task as any).resumeState})`,
        );
        // Match every other reportFailure exit (permanent failure, figma
        // rate-limit, recursion limit, consecutive timeouts): broadcast the
        // post-mutation kanban so the UI moves the task out of inProgress
        // immediately.
        this.broadcastKanban();
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
    // Queue order = dependency order. Each barrier reads ONLY `running` —
    // a queued blocker that sits BEHIND the candidate task is not a
    // pre-requirement; the queue's own head-first scan already enforces
    // ordering when decompose places prerequisites earlier. Including
    // `queued.some(blocker)` was an over-defensive heuristic that created
    // a circular wait whenever decompose intentionally ordered a producer
    // task (e.g. a post-UI cleanup feature) after its consumers — see the
    // `such-pinning-milky` RCA. Lock structure (`requestTask` runs inside
    // `lock.runExclusive`) closes the race window that the `queued` check
    // appeared to defend: by the time worker N+1 reads `running.some()`,
    // worker N's `assignTask` has already populated `runningTasks`.
    const b = this.config.barriers;
    const running = Array.from(this.runningTasks.values());
    return {
      hasPreFeatureWork: !!b?.feature && running.some(isFoundationTask),
      hasPrePlatformWork: !!b?.platform && running.some(isPlatformTask),
      hasPreIntegrationWork: !!b?.integration && running.some(isPreIntegrationWork),
      hasPreSeamWork: !!b?.seam && running.some(isPreSeamWork),
      hasPreUiWork: !!b?.ui && running.some((t) => schedBlocks(t, 'blocksUi')),
      hasPreTestgenWork: !!b?.['test-code'] && running.some((t) => schedBlocks(t, 'blocksTestgen')),
      hasPreDocWork: !!b?.doc && running.some((t) => schedBlocks(t, 'blocksDoc')),
      hasPreAssetsWork: !!b?.assets && running.some(isTokensTask),
      hasPreSpecWork: !!b?.spec && running.some(isTokensOrAssetsTask),
    };
  }

  private findAndAssignNonConflictingTask(workerId: number): T | null {
    const runningGroups = new Set<string>();
    for (const task of this.runningTasks.values()) {
      if (task.parallelGroup) {
        runningGroups.add(task.parallelGroup);
      }
    }

    const { hasPreFeatureWork, hasPrePlatformWork, hasPreIntegrationWork, hasPreSeamWork, hasPreTestgenWork, hasPreDocWork, hasPreUiWork, hasPreAssetsWork, hasPreSpecWork } =
      this.computeBarriers();

    for (const task of this.taskQueue.getAll()) {
      // Exclusive task acts as a barrier
      if (task.exclusive) break;

      // Type-specific barrier opt-in lives on tasks/{type}/hooks/scheduling.ts.
      // R1 — the orchestrator does not compare `task.type`; it asks each task
      // bundle whether it wants to be gated behind the named barrier.
      const sched = hooksForTaskType(task.type as TaskType)?.scheduling;

      // Feature barrier: don't assign feature/integration tasks while foundation work exists.
      // Foundation identity is now owned by each bundle's `classify` — the
      // orchestrator asks via `isFoundationTask(task) / isTokensTask(task)`,
      // not by a hard-coded priority window. test-code / doc tasks have their
      // own barrier (`preTestgenBarrier` / `preDocBarrier`) so they slip
      // through this foundation gate.
      if (hasPreFeatureWork && !isFoundationTask(task) && !isTokensTask(task)
          && !sched?.preTestgenBarrier && !sched?.preDocBarrier) {
        break;
      }

      // Platform barrier: don't assign ordinary feature / integration / ui /
      // etc. while platform (shared runtime services) work exists. Platform and
      // foundation tasks pass (foundation already ran; platform is the work in
      // flight); test-code / doc keep their own barriers. This is what lets a
      // feature consumer bind to a real platform-provided access contract
      // instead of hand-constructing it.
      if (hasPrePlatformWork && !isFoundationTask(task) && !isPlatformTask(task) && !isTokensTask(task)
          && !sched?.preTestgenBarrier && !sched?.preDocBarrier) {
        break;
      }

      // Integration barrier: don't assign integration tasks while feature work exists
      if (hasPreIntegrationWork && sched?.preIntegrationBarrier
          && schedClassify(task, 'consumesIntegrationGate')) {
        break;
      }

      // Seam barrier: don't assign seam-type tasks while any authoring work
      // (setup/foundation/platform/feature/integration/ui) is still running —
      // the whole materialized graph (incl. ui-introduced affordances) must
      // exist before reference + affordance closure.
      if (hasPreSeamWork && sched?.preSeamBarrier
          && schedClassify(task, 'consumesSeamGate')) {
        break;
      }

      // Testgen barrier: don't assign testgen tasks while feature/setup work exists
      if (hasPreTestgenWork && sched?.preTestgenBarrier) {
        break;
      }

      // Doc barrier: don't assign doc tasks while feature/setup/testgen work exists
      if (hasPreDocWork && sched?.preDocBarrier) {
        break;
      }

      // UI barrier: don't assign ui tasks while feature/setup work exists
      if (hasPreUiWork && sched?.preUiBarrier) break;

      // Assets barrier (design job): block non-tokens while tokens work exists.
      if (hasPreAssetsWork && !isTokensTask(task)) break;

      // Spec barrier (design job): block non-(tokens|assets) while tokens+assets work exists.
      if (hasPreSpecWork && !isTokensOrAssetsTask(task)) break;

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
    // Clear stale failure markers from previous attempts (e.g., resume after tasks_failed)
    delete (task as any)._failed;
    delete (task as any)._failureReason;

    // Timing dispatch — two distinct sources of "stale timing" need
    // opposite treatment:
    //
    //   1. batch-split Path A re-queue carries a fresh `pausedAt` set by
    //      `TaskTimingHelper.pauseTask` so the gap between split and
    //      re-pick counts as paused (not active). `startTask` accumulates
    //      that gap into `totalPausedDuration` and clears `pausedAt`,
    //      preserving the parent's pre-split runtime in
    //      `task.timing.elapsedTime` at the eventual `completeTask`.
    //
    //   2. failed-task / checkpoint-restored tasks carry a stale
    //      `startedAt` from a prior assignment (no `pausedAt`). Without
    //      a hard reset, sequential reassignments of the same task
    //      instance would accumulate elapsed time across attempts.
    //      `restartTask` is the SSOT for that reset.
    //
    // The `pausedAt` discriminator is reliable: only `pauseTask` writes
    // it on a queued (non-completed) task, and `startTask` clears it
    // immediately on resume. A task with `pausedAt` set is by definition
    // a paused-and-requeued task whose timing carry MUST be preserved.
    if ((task as any).timing?.pausedAt) {
      task = TaskTimingHelper.startTask(task) as T;
    } else {
      task = TaskTimingHelper.restartTask(task) as T;
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

    const { hasPreFeatureWork, hasPrePlatformWork, hasPreIntegrationWork, hasPreSeamWork, hasPreTestgenWork, hasPreDocWork, hasPreUiWork, hasPreAssetsWork, hasPreSpecWork } =
      this.computeBarriers();

    let potentialTasks = 0;
    for (const task of this.taskQueue.getAll()) {
      if (task.exclusive) break;
      const sched = hooksForTaskType(task.type as TaskType)?.scheduling;
      if (hasPreFeatureWork && !isFoundationTask(task) && !isTokensTask(task)
          && !sched?.preTestgenBarrier && !sched?.preDocBarrier) break;
      if (hasPrePlatformWork && !isFoundationTask(task) && !isPlatformTask(task) && !isTokensTask(task)
          && !sched?.preTestgenBarrier && !sched?.preDocBarrier) break;
      if (hasPreIntegrationWork && sched?.preIntegrationBarrier
          && schedClassify(task, 'consumesIntegrationGate')) break;
      if (hasPreSeamWork && sched?.preSeamBarrier
          && schedClassify(task, 'consumesSeamGate')) break;
      if (hasPreTestgenWork && sched?.preTestgenBarrier) break;
      if (hasPreDocWork && sched?.preDocBarrier) break;
      if (hasPreUiWork && sched?.preUiBarrier) break;
      if (hasPreAssetsWork && !isTokensTask(task)) break;
      if (hasPreSpecWork && !isTokensOrAssetsTask(task)) break;
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

      this.lock.runExclusive(() => {
        this.checkAllDone();
        // Defense-in-depth respawn guard: if every worker has died but
        // the queue is non-empty and the orchestrator is not draining,
        // a barrier-blocked head task left the worker pool empty with
        // no respawn trigger (the deadlock signature traced in
        // orchestrator foundation-gate deadlock). The primary deadlock root cause is
        // fixed by the band-based classify, but this guard recovers
        // any future regression by re-spawning workers — the next
        // `requestTask` will return null cleanly and the `requestTask`
        // diagnostic below surfaces the remaining barrier reason.
        if (
          !this.draining &&
          this.workers.size === 0 &&
          this.runningTasks.size === 0 &&
          !this.taskQueue.isEmpty()
        ) {
          console.warn(
            `[Orchestrator] All workers terminated with non-empty queue (${this.taskQueue.size()}); attempting respawn`,
          );
          this.spawnAvailableWorkers();
        }
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
    // Once interrupted, the API-server's session-mode final broadcast is the
    // authoritative terminal state — every in-flight task is projected to
    // `todo` with `interrupted:true`. Any further LIVE broadcast here (the
    // handleInterruption emit + worker wind-down emits) would re-show those
    // tasks in `inProgress` and clobber the board back to "in-progress".
    // Suppress for ALL interruption reasons (user_stopped / stalled / drain).
    if (this.hasInterruptedTasks) return;

    const currentTasks = Array.from(this.runningTasks.values());
    const queue = this.taskQueue.getAll();

    // Failed tasks broadcast through the LIVE Kanban Redis snapshot
    // (TASK_QUEUE_KEY_PREFIX). `JobCleanupManager` reads this snapshot
    // as a fallback when the checkpoint snapshot is missing — therefore
    // the failed-task projection MUST go through the same SSOT helper
    // that the checkpoint / session writers use, otherwise stale
    // VerificationBudget axes (batchSplitCount / _failedAttempts) leak
    // into the disk on JCM's fallback path (vast-curling-perch RCA).
    const failedAsQueue = this.failedTasks.map(f =>
      buildResumableFailedTask(f.task as unknown as CodeTask, f.error.message),
    );

    this.callbacks.onKanbanUpdate?.(
      currentTasks,
      [...queue, ...failedAsQueue] as T[],
      this.completedTasks,
      this.accumulatedTokenUsage,
      this.accumulatedTokenUsageByModel,
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

  /** Merge one worker's per-task per-model breakdown into the job-level map. */
  private addTokenUsageByModel(byModel: TokenUsageByModel): void {
    for (const [modelId, u] of Object.entries(byModel)) {
      const e = (this.accumulatedTokenUsageByModel[modelId] ??= {
        inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, callCount: 0,
      });
      e.inputTokens += u.inputTokens;
      e.outputTokens += u.outputTokens;
      e.totalTokens += u.totalTokens;
      e.cacheReadTokens = (e.cacheReadTokens || 0) + (u.cacheReadTokens || 0);
      e.cacheCreationTokens = (e.cacheCreationTokens || 0) + (u.cacheCreationTokens || 0);
      e.callCount = (e.callCount || 0) + (u.callCount || 0);
    }
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
    // SSOT split: in-flight tasks go to `runningTasks`; the queue field
    // carries queued + actually-interrupted tasks only. The orchestrator
    // does NOT defensively pre-mark running tasks here — that conflates
    // "still in flight" with "was interrupted" and pollutes the durable
    // FE display. Crash-recovery boundaries (JobCleanupManager for cloud,
    // runner.ts orphan-recovery for local CLI) are the single projection
    // site that applies `interrupted:true` if the worker process died
    // between save and resume.
    //
    // Graceful interruption (`handleInterruption` → `captureWorkerSnapshots`)
    // already stamps `interrupted:true` + `resumeState` directly on each
    // running task BEFORE this saver runs. Those marks are preserved
    // through the spread below — the field accepts them idempotently.
    const runningTasks: T[] = Array.from(this.runningTasks.values()).map(
      t => ({ ...t }) as T,
    );
    const queueTasks = this.taskQueue.getAll();

    // Use explicit param if provided; otherwise fall back to instance state.
    // This prevents post-interruption checkpoint saves (e.g. from reportCompletion)
    // from overwriting the interruption metadata that handleInterruption saved.
    const effectiveInterruption = interruption ??
      (this.hasInterruptedTasks && this.interruptReason
        ? { reason: this.interruptReason, canResume: true }
        : undefined);

    const checkpoint: ParallelCheckpoint<T> = {
      taskQueue: queueTasks,
      runningTasks,
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

  /**
   * IDs of *real* completions only — Path B superseded parents (carrying
   * `supersededBy: string[]`) are filtered out so the canonical
   * `state.completedTasks` (string[]) array used by resume / routing /
   * progress logs stays semantically aligned with the main graph
   * (`checkTaskStatus` only pushes a parent's id on the success path,
   * never on batchSplit Path B). Full task objects — including
   * superseded — remain available via `getCompletedTasks()` for
   * `completedTasksDetails` / kanban tooltip rendering.
   */
  getRealCompletedTaskIds(): string[] {
    return this.completedTasks
      .filter(t => !(t as any).supersededBy)
      .map(t => t.id);
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
   *   1. drain()                   — stop new task dispatch + periodic checkpoint
   *   2. captureWorkerSnapshots()  — pull per-worker state onto `task.resumeState`
   *                                  so the next invocation sees prior attempts
   *   3. signalWorkersToStop()     — workers exit after current iteration
   *   4. saveCheckpoint()          — running tasks pushed back to queue as interrupted
   *   5. checkAllDone()            — resolve run() if no running tasks remain
   *
   * Step 2 restores a block of logic that lived here before the 2026-02-11
   * refactor (`0be5a6b0`) and was accidentally dropped during helper
   * extraction. Without it, a task interrupted mid-diagnostic loses its
   * verification budget, plan hash history, and tracker state on resume —
   * i.e. the LLM re-starts from scratch on every re-entry, defeating Axis
   * D/E/F-4/G accumulation.
   *
   * Called by gracefulShutdown.ts when the process receives SIGTERM, and by
   * the orchestrator itself on drain-triggering failures.
   */
  async handleInterruption(reason: string): Promise<void> {
    console.log(`[TaskOrchestrator] handleInterruption called: ${reason}`);

    await this.lock.runExclusive(async () => {
      this.hasInterruptedTasks = true;
      this.interruptReason = reason;
      this.drain();
      await this.captureWorkerSnapshots();
      this.signalWorkersToStop();
      const runningTaskIds = Array.from(this.runningTasks.values()).map(t => t.id);
      this.callbacks.onInterruption?.(reason, runningTaskIds);
      await this.saveCheckpoint({ reason, canResume: true });
      this.broadcastKanban();
      this.checkAllDone();
    });
  }

  /**
   * For every running worker, pull its current state via `worker.captureState()`
   * and attach the resulting `WorkerSnapshot` to the task's `resumeState`. On
   * the next worker invocation, `TaskWorker.executeTask` reads this snapshot
   * and rehydrates planText / conversations / verification attempt counter /
   * tracker / applied plan history.
   *
   * Called from `handleInterruption` (external SIGTERM) and `reportFailure`'s
   * transient-retry branch so both boundaries produce the same resume shape.
   */
  private async captureWorkerSnapshots(): Promise<void> {
    for (const [workerId, worker] of this.workers) {
      const task = this.runningTasks.get(workerId);
      if (!task) continue;
      try {
        const snapshot = await worker.captureState();
        if (snapshot) {
          task.interrupted = true;
          (task as any).resumeState = snapshot;
        }
      } catch (err) {
        console.warn(`[TaskOrchestrator] captureWorkerSnapshots(worker ${workerId}) failed:`, (err as Error).message);
      }
    }
  }
}
