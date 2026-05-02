/**
 * TaskWorker
 *
 * An independent task executor that runs a subgraph for a single task.
 * Workers are created and managed by the TaskOrchestrator.
 *
 * Lifecycle:
 *   1. Orchestrator spawns worker
 *   2. Worker loops: requestTask → executeTask → reportCompletion
 *   3. When requestTask returns null → worker terminates
 *
 * Supports graceful stop: requestStop() → worker finishes current task
 * and exits the loop without requesting more tasks.
 */

import type { BaseTask, TaskTokenUsage } from '@ant/shared';
import type { TaskOrchestrator } from './TaskOrchestrator';
import type { WorkerGraphBuilder, WorkerSnapshot } from './types';
import type { SharedFileBuffer } from './SharedFileBuffer';
import { WorkerFileSystem } from './WorkerFileSystem';
import { runInTaskScope, runInWorkerScope } from '../../../../../core/parallel/workerScope';
import { VerificationTerminalError } from '../tasks/_shared/verify/terminal/errors';
import { getLLMResponseServiceOrNull } from '../../../../../core/adapters/ChatAPIClient';

/**
 * Produce a `WorkerSnapshot` from any code-graph state object.
 *
 * Single snapshot API for the three carry-over boundaries
 * (`handleInterruption` / `reportFailure` transient re-queue /
 * `plan.processDiagnosticBatchSplit`). Verification cycle carry-over is
 * driven entirely by `task.batchSplitCount` (assigned explicitly at the
 * batch-split re-queue site) — not by a snapshot field.
 */
export function snapshotFromState(state: any): WorkerSnapshot | null {
  if (!state) return null;
  return {
    planText: state.planText,
    conversations: state.conversations,
    retries: state.retries,
    violations: state.violations,
    enforcementHistory: state.enforcementHistory,
    tokenUsage: state._currentTaskTokenUsage,
  };
}

export class TaskWorker<T extends BaseTask> {
  readonly workerId: number;
  private readonly orchestrator: TaskOrchestrator<T>;
  private readonly graphBuilder: WorkerGraphBuilder;
  private readonly sharedContext: any;

  private stopRequested = false;
  private currentTask: T | null = null;
  private currentState: any = null;

  constructor(
    workerId: number,
    orchestrator: TaskOrchestrator<T>,
    graphBuilder: WorkerGraphBuilder,
    sharedContext: any,
  ) {
    this.workerId = workerId;
    this.orchestrator = orchestrator;
    this.graphBuilder = graphBuilder;
    this.sharedContext = sharedContext;
  }

  /**
   * Main worker loop. Runs until no more tasks are available or stop is requested.
   */
  async run(): Promise<void> {
    console.log(`[Worker ${this.workerId}] Started`);

    while (true) {
      // Check for graceful stop
      if (this.stopRequested) {
        console.log(`[Worker ${this.workerId}] Stop requested, exiting loop`);
        break;
      }

      // Request next task from orchestrator
      const task = await this.orchestrator.requestTask(this.workerId);
      if (!task) {
        console.log(`[Worker ${this.workerId}] No task available, terminating`);
        break;
      }

      this.currentTask = task;
      console.log(`[Worker ${this.workerId}] Executing task: "${task.name}" (id=${task.id}, exclusive=${task.exclusive}, group=${task.parallelGroup})`);

      try {
        const result = await this.executeTask(task);
        const tokenUsage = result?._currentTaskTokenUsage || result?.tokenUsage;
        // ✅ Use the enriched task from graph result (has timing + tokenUsage from workerCheckTaskStatus)
        // The original `task` reference lacks timing.completedAt/elapsedTime and tokenUsage
        const completedTask = result?.currentTask || task;

        // Worker subgraph exits normally even when task failed (retries exhausted,
        // violations exist but graph reaches learn → __end__ without throwing).
        // Check _taskCompleted to distinguish actual success from exhaustion.
        const batchSplit = result?._batchSplitCompleted === true;
        const hasUnresolvedViolations = result?._taskCompleted !== true
          && !batchSplit
          && result?.violations?.length > 0;

        if (batchSplit) {
          // Task was re-enqueued via batch split — release worker slot, don't mark as completed
          await this.orchestrator.reportBatchSplit(this.workerId, task);
        } else if (result?._taskCompleted === false && !hasUnresolvedViolations) {
          // Task was stopped (e.g. user stop) — return to queue, don't mark as completed.
          // handleInterruption's checkpoint will include it as interrupted.
          console.log(`[Worker ${this.workerId}] Task "${task.name}" stopped (not completed) — reporting as stopped`);
          await this.orchestrator.reportStopped(this.workerId);
        } else if (hasUnresolvedViolations) {
          const violationTypes = result.violations.map((v: any) => v.type || 'unknown').join(', ');
          // Typed terminal error so orchestrator can decide re-queue vs escalate
          // without string matching. For verification tasks this kind indicates
          // that in-plan retries AND reverify all failed to clear violations.
          const err = new VerificationTerminalError(
            'unresolved_violations',
            `Task "${task.name}" exhausted call budget with ${result.violations.length} unresolved violation(s): ${violationTypes}`,
          );
          console.warn(`[Worker ${this.workerId}] Task "${task.name}" ended with unresolved violations → reporting as failure`);
          await this.orchestrator.reportFailure(this.workerId, completedTask, err);
        } else {
          await this.orchestrator.reportCompletion(this.workerId, completedTask, tokenUsage);
        }
      } catch (error: any) {
        console.error(`[Worker ${this.workerId}] Task "${task.name}" failed:`, error.message);
        await this.orchestrator.reportFailure(this.workerId, task, error);
        // After failure, orchestrator enters drain mode → requestTask will return null
      } finally {
        this.currentTask = null;
        this.currentState = null;
      }
    }

    console.log(`[Worker ${this.workerId}] Terminated`);
  }

  /**
   * Execute a single task using the worker subgraph.
   */
  private async executeTask(task: T): Promise<any> {
    // Build the appropriate subgraph
    const includeInstallValidate = !!task.exclusive;
    const graph = this.graphBuilder(includeInstallValidate);

    // Build initial worker state from shared context + task
    // ✅ Create per-worker WorkerFileSystem for cross-worker file conflict detection
    const sharedFileBuffer: SharedFileBuffer | undefined = this.sharedContext._sharedFileBuffer;
    const originalFileSystem = this.sharedContext.deps?.fileSystem;
    const workerFileSystem = sharedFileBuffer && originalFileSystem
      ? new WorkerFileSystem(originalFileSystem, sharedFileBuffer, this.workerId, task.name)
      : originalFileSystem;

    const workerState: Record<string, any> = {
      ...this.sharedContext,
      workerId: this.workerId,
      currentTask: task,
      // ✅ Override fileSystem with per-worker WorkerFileSystem
      deps: {
        ...this.sharedContext.deps,
        fileSystem: workerFileSystem,
      },
      // Per-worker independent state
      planText: '',
      conversations: {},
      _executeCallIndex: 0,
      _lastToolBatchMutatedFiles: false,
      toolResults: [],
      violations: [],
      retries: 0,
      enforcementHistory: [],
      _currentTaskTokenUsage: undefined,
      // Restore tool result cache from previous failed attempt (design job: avoids re-reading source docs)
      _toolResultCache: (task as any)._cachedToolResults || undefined,
      // Restore cross-task fields from resumeState if task was interrupted or re-queued.
      // `resumeState` is attached by `TaskOrchestrator.handleInterruption` /
      // `reportFailure` (transient retry) / `plan.processDiagnosticBatchSplit`
      // via `snapshotFromState()` below, so a single restore path handles
      // all three boundaries uniformly. Task-type-specific fields
      // (verification session, diagnostic tracker, etc.) are restored via
      // the orchestrator hook below so the phase layer never references
      // `_verificationTracker` or friends by name.
      ...(task.interrupted && (task as any).resumeState ? {
        planText: (task as any).resumeState.planText || '',
        conversations: (task as any).resumeState.conversations || {},
        retries: (task as any).resumeState.retries || 0,
        violations: (task as any).resumeState.violations || [],
        enforcementHistory: (task as any).resumeState.enforcementHistory || [],
      } : {}),
      // Worker stop signal checker
      _isStopRequested: () => this.stopRequested,
    };

    // Clear resumeState after restoring. Task-type-specific snapshot
    // rehydration (`orchestrator.restoreIntoWorkerState`) was retired by
    // plan §5.6.1; verification cycle carry-over now flows through
    // `task.batchSplitCount` (assigned at the batch-split re-queue site).
    if (task.interrupted && (task as any).resumeState) {
      (task as any).resumeState = undefined;
      task.interrupted = false;
    }

    if (!workerState.resolvedAction) {
      console.warn(`⚠️  [Worker ${this.workerId}] resolvedAction missing from workerState (task: ${task.name})`);
    }

    // Execute the subgraph
    // ✅ CRITICAL: Pass recursionLimit in the invoke config.
    // Without this, LangGraph uses its default of 25 which is far too low
    // for complex tasks (plan → execute ↔ tool loop easily exceeds 25 node transitions).
    // Use sharedContext.recursionLimit (from env RECURSION_LIMIT via runner.ts).
    const envLimit = parseInt(process.env.RECURSION_LIMIT || '200', 10);
    // Wrap with `runInTaskScope` (inside `runInWorkerScope`) so every
    // chat event emitted during this task carries `worker-N#task-K`
    // identity. The FE projector splits sections per task and sorts by
    // first-event timestamp, restoring chronology when a long-lived
    // worker handles tasks across barrier cohorts.
    //
    // `cycleSeq` (peek of the turnId-level pauseSeq) carries the
    // pause/resume cycle index so a task that survives a Stop/Resume
    // cycle mints `worker-N#task-K#p{cycleSeq}` instead of piggy-backing
    // on the original `worker-N#task-K` section. Without the suffix the
    // FE projector anchors the worker section's firstTs to the first
    // attempt forever — cancelled cards (`_cancelled_:{cardId}`,
    // synthetic scope) sort BELOW the worker section and the user sees
    // the cancelled card "stuck" at the chat input even after resume
    // (`even-getting-knave` regression). See
    // docs/architecture/31-chat-system.md §섹션-정렬 rule 4.
    const taskKey = task.id || task.name;
    let cycleSeq = 0;
    try {
      const llmService = await getLLMResponseServiceOrNull();
      if (llmService) {
        cycleSeq = await llmService.getCurrentPauseSeq();
      }
    } catch (err) {
      // Best-effort. If the peek fails the worker still runs — it just
      // emits with the legacy two-axis scope. Better to lose the cycle
      // suffix than to abort the task on a Redis blip.
      console.warn(
        `[Worker ${this.workerId}] getCurrentPauseSeq failed; falling back to cycleSeq=0`,
        err,
      );
      cycleSeq = 0;
    }
    const result = await runInWorkerScope(this.workerId, () =>
      runInTaskScope(taskKey, cycleSeq, () =>
        graph.invoke(workerState, {
          recursionLimit: workerState.recursionLimit || envLimit,
        }),
      ),
    );
    this.currentState = result;
    return result;
  }

  /**
   * Request graceful stop. Current task will finish, but no new tasks will be requested.
   */
  requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Capture the current worker state for checkpoint/interruption.
   * Returns null if no task is currently executing.
   *
   * Thin wrapper over the static {@link snapshotFromState} so that sites
   * without a live worker instance (e.g. `plan.processDiagnosticBatchSplit`)
   * can produce the same snapshot shape.
   */
  async captureState(): Promise<WorkerSnapshot | null> {
    if (!this.currentState) return null;
    return snapshotFromState(this.currentState);
  }

  /**
   * Get the currently executing task (for diagnostics).
   */
  getCurrentTask(): T | null {
    return this.currentTask;
  }

  /**
   * Check if this worker has been asked to stop.
   */
  isStopRequested(): boolean {
    return this.stopRequested;
  }
}
