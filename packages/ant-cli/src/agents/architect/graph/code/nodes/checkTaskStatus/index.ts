/**
 * nodes/checkTaskStatus/index.ts — main graph checkTaskStatus node
 *
 * Ported verbatim from `graph.ts` L35~L427 (T6b-γ). Only behavioural
 * change: the two task-type branches (verification completion guard,
 * test-code disk guard) and the error→Final Verification auto-add branch
 * are delegated to hook bundles (`check.evaluate` /
 * `orchestrator.onTaskComplete`). Everything else — SSE, retention,
 * Kanban updates, saveCheckpoint, completedTasksDetails bookkeeping — is
 * unchanged from the main graph's inline implementation so sequential
 * runs stay byte-for-byte equivalent.
 *
 * R1 — zero `task.type === '...'` comparisons in this file.
 */

import type { ArchitectGraphState, EnforcementFeedback } from '../../state';
import type { CodeTask } from '../../../../types/task';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { TASK_PRIORITIES, TaskTimingHelper } from '../../state';
import { hooksIfActive } from '../../tasks/_shared/registry';
import { isFeatureTask } from '../../tasks/feature/model/is';
import { evaluateTaskStatus } from './evaluate';

export async function checkTaskStatus(
  state: ArchitectGraphState,
): Promise<Partial<ArchitectGraphState>> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;

  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('checkTaskStatus', state.currentTask ?? undefined);

  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'checkTaskStatus',
      0,
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  // ✅ Build violations from CURRENT state only.
  // CRITICAL: Do NOT inherit state.violations — they contain stale violations from
  // the previous enforce→plan cycle. checkTaskStatus must evaluate independently.
  const { violations, stopRequested, batchSplitRequeued } = await evaluateTaskStatus(state, {
    logPrefix: 'checkTaskStatus',
  });

  const hasViolations = violations.length > 0;

  // Verification scenario harness — no-op in production. Surface raised
  // violations into the trace so `ScenarioExpectedOutcome.violations` can
  // assert against types that get cleared from state before it's persisted.
  if (hasViolations) {
    const { appendTrace } = await import('../../../../../../utils/verificationTrace');
    appendTrace({
      node: 'checkTaskStatus',
      taskId: state.currentTask?.id,
      taskType: state.currentTask?.type,
      extra: {
        violations: violations.map(v => ({ type: v.type, severity: v.severity })),
      },
    });
  }

  // ✅ CRITICAL: Check if user has requested a stop before marking task as completed.
  // Without this, a cancelled job can still mark the current task as "completed"
  // if checkTaskStatus runs after the cancellation signal but before process termination.
  if (stopRequested) {
    console.log(`🛑 [checkTaskStatus] User stop requested — NOT marking task as completed`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }
    return {
      violations: [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // Batch split: original task was re-enqueued — skip completion marking entirely
  if (batchSplitRequeued) {
    // Re-enqueued tasks carry their batch-split cycle counter in the
    // VerificationSession snapshot attached to `resumeState.verification`.
    // Surface the cycle number for parity with the pre-T4b log line.
    const requeuedTasks = state.taskQueue?.getAll().filter(t => {
      const cycle = (t as any).resumeState?.verification?.batchSplitCount;
      return typeof cycle === 'number' && cycle > 0;
    });
    if (requeuedTasks?.length) {
      for (const t of requeuedTasks) {
        const cycle = (t as any).resumeState?.verification?.batchSplitCount ?? 1;
        console.log(`🔄 [BatchSplit] Re-enqueued task "${t.name}" (cycle ${cycle})`);
      }
    }
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }
    return {
      currentTask: undefined,
      retries: 0,
      violations: [],
      _batchSplitRequeued: false,
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
      planText: '',
      // Task boundary clears per-task verification state. Session is the
      // authoritative SSOT; clearing it transfers ownership to the next
      // task's `initSession` call (plan/parts/entry.ts). Resumed workers
      // bypass this path and rehydrate via
      // `orchestrator.restoreIntoWorkerState`.
      verification: undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  if (!hasViolations && state.currentTask) {
    // Task succeeded — use _currentTaskTokenUsage as single source of truth.
    // _currentTaskTokenUsage already accumulated ALL plan + execute calls via
    // accumulateTokenUsage({ taskLevel: true, jobLevel: true }) in each node.
    // No additional merge or job-level re-accumulation needed here.
    const { getTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    const { getExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
    const taskTokenUsage = getTaskTokenUsage(state);

    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);

    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
      if (completedTask.tokenUsage) {
        console.log(`   Tokens: ${completedTask.tokenUsage.totalTokens} total (${completedTask.tokenUsage.inputTokens} in, ${completedTask.tokenUsage.outputTokens} out)`);
      }
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }

    // ✅ Log task_complete event to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      });
      execLogger.logTaskComplete(completedTask.id, {
        taskName: completedTask.name,
        elapsedMs: completedTask.timing?.elapsedTime || 0,
        inputTokens: completedTask.tokenUsage?.inputTokens || 0,
        outputTokens: completedTask.tokenUsage?.outputTokens || 0,
        cacheReadTokens: completedTask.tokenUsage?.cacheReadTokens || 0,
        cacheCreationTokens: completedTask.tokenUsage?.cacheCreationTokens || 0,
        llmCallCount: completedTask.tokenUsage?.callCount ?? 0,
      }).catch(() => {});
    }

    // Apply centralized conversation retention policy (code job always discards)
    const { applyRetention } = await import('../../../../../../core/utils/conversationRetention');
    const retainedExecute = applyRetention({
      jobType: 'code',
      currentTask: { id: state.currentTask.id },
      nextTask: state.taskQueue?.peek() ? { id: state.taskQueue.peek()!.id } : undefined,
      nodeHistory: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE) as any,
    });
    // Phase 3c: `state._executeCallIndex = 0` / `state._finalTaskLoopCount = 0`
    // / `state.violations = []` mutations removed — the success-path return
    // object below (and `updatedState` consumed by `saveCheckpoint`) declare
    // these fields explicitly so the LangGraph reducer commits them. Direct
    // mutation did not propagate beyond this function.
    console.log(`🧹 [checkTaskStatus] Cleared violations for next task`);

    // Update completedTasks (IDs only)
    const completedTasks = state.completedTasks || [];
    completedTasks.push(completedTask.id);

    // ✅ NEW: Store full task details in completedTasksDetails
    const completedTasksDetails = state.completedTasksDetails || [];
    completedTasksDetails.push(completedTask);

    console.log(`[checkTaskStatus] 💾 Saving completed task to completedTasksDetails:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      hasTiming: !!completedTask.timing,
      hasDescription: !!completedTask.description,
      totalCompletedTasksDetails: completedTasksDetails.length,
      completedTasksDetailsIds: completedTasksDetails.map(t => t.id),
    });

    // If feature task, mark in featureTasks map
    if (isFeatureTask(completedTask) && state.featureTasks) {
      const feature = state.featureTasks.get(completedTask.id);
      if (feature) {
        feature.completed = true;
      }
    }

    // Task-type-specific completion side effects (formerly the inline
    // `if (state.currentTask.type === 'error')` Final Verification
    // auto-add block at graph.ts L309). Hooks mutate the shared task
    // queue; the appendTrace flag mirrors the legacy log so scenario
    // harnesses continue to observe `finalVerificationAutoAdded`.
    const orchestratorHook = hooksIfActive(state)?.orchestrator;
    if (orchestratorHook?.onTaskComplete && state.taskQueue) {
      const queueSnapshot = state.taskQueue.getAll();
      const beforeQueueSize = queueSnapshot.length;
      orchestratorHook.onTaskComplete({
        task: completedTask,
        taskQueue: state.taskQueue,
        queueSnapshot,
        // Sequential execution has no "other running" or completed-task
        // history to check against; pass empty snapshots so the hook
        // stays task-type-blind about the caller.
        runningSnapshot: [],
        completedSnapshot: [],
        resolvedAction: state.resolvedAction,
      });
      const afterQueueSize = state.taskQueue.getAll().length;
      if (afterQueueSize > beforeQueueSize) {
        const { appendTrace } = await import('../../../../../../utils/verificationTrace');
        appendTrace({
          node: 'checkTaskStatus',
          taskId: state.currentTask?.id,
          taskType: state.currentTask?.type,
          extra: { flagSet: ['finalVerificationAutoAdded'] },
        });
      }
    }

    // ✅ CRITICAL: Update state with completedTasksDetails
    // Explicit zeroed counters / cleared violations mirror the return object
    // below so the saved checkpoint matches the reducer-committed state.
    const updatedState = {
      ...state,
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      retries: 0,
      violations: [],
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
    };

    // ✅ CRITICAL: Save checkpoint with updated completedTasksDetails
    const { saveCheckpoint } = await import('../../session/checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`[checkTaskStatus] ✅ Checkpoint saved with completedTasksDetails (${completedTasksDetails.length} tasks)`);

    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state.deps?.kanbanUpdate && state._httpJobId && updatedState.taskQueue) {
      const allTasks = updatedState.taskQueue.getAll();
      const nextTask = updatedState.taskQueue.peek();

      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter((t: CodeTask) => t.id !== nextTask.id) : allTasks;

      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);

      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,
        remainingQueue,
        completedTasksDetails,
        state.recursionCount,
        state.recursionLimit,
        state.tokenUsage,
      );
    }

    // ✅ Workflow instrumentation: Exit node (task completed path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }

    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      retries: 0,
      violations: [],
      conversations: { [CONV_KEYS.NODE_EXECUTE]: retainedExecute },
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
      planText: '',
      // Task boundary clears. Next verification responsibility holder
      // (verification task or self-verify task) pops with a clean Session
      // via `initSession`; a resumed task bypasses this path (TaskWorker
      // restores via resumeState.verification).
      verification: undefined,
      // Phase mode reset — next task starts in apply-mode regardless of
      // whether the previous task entered verify. Self-verify and
      // verification tasks re-flip via `markVerifyEntered` in their
      // respective entry paths.
      _verifyEntered: false,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // ✅ Log violation event to debug/logs/
  if (state.context?.featurePath && state._httpJobId && state.currentTask) {
    const { getExecutionLogger: getExecLogger } = await import('../../../../../../core/utils/executionLogger');
    const execLogger = getExecLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    execLogger.logTaskError(state.currentTask.id, {
      taskName: state.currentTask.name,
      violationType: violations[0]?.type || 'unknown',
      violationCount: violations.length,
      retryCount: state.retries || 0,
      message: violations.map((v: any) => v.message).join('; ').substring(0, 500),
    }).catch(() => {});
  }

  // ✅ Workflow instrumentation: Exit node (task failed/has violations path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
  }

  // SSOT: each task hook declares whether a violation can be resolved via
  // regeneration (`isRetryable`). Filter here so downstream routing /
  // plan sees only retryable ones — warnings flow through as "no violations".
  const retryableViolations = violations.filter(v => v.isRetryable === true);

  // All non-retryable (warnings only) → clear violations. If the same task
  // is still alive, signal `_nextPlanEntry: 'retry'` to keep plan from
  // falling into `handleFreshTaskEntry` (which would emit a duplicate
  // `task_start` event and reset token counters — defence-in-depth).
  if (retryableViolations.length === 0) {
    console.log(`✅ [checkTaskStatus] All violations non-retryable (warnings only)`);
    return {
      violations: [],
      _nextPlanEntry: state.currentTask ? ('retry' as const) : undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // Append enforcement feedback — consumed by the learn node's lesson
  // extraction and persisted to the session checkpoint.
  const feedback: EnforcementFeedback = {
    taskId: state.currentTask?.id || 'unknown',
    taskName: state.currentTask?.name || 'Unknown Task',
    attemptNumber: (state.retries || 0) + 1,
    violations: retryableViolations,
    fixStrategy: 'retry',
    timestamp: Date.now(),
  };
  const enforcementHistory = [...(state.enforcementHistory || []), feedback];

  // Task failed or has retryable violations — propagate to plan for retry.
  // `state.retries += 1` happens inside `plan/handleRetryEntry` (single
  // writer). `_nextPlanEntry: 'retry'` tells `resolvePlanEntry` which
  // branch to take.
  return {
    violations: retryableViolations,
    enforcementHistory,
    _nextPlanEntry: 'retry' as const,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  };
}

// Re-export the TASK_PRIORITIES helper is intentionally omitted — phase
// nodes import it directly from state.ts.
void TASK_PRIORITIES;
