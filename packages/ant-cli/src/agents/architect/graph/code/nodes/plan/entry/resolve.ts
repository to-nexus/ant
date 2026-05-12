/**
 * STEP 0 entry dispatcher.
 *
 * Conversation retention:
 *   - NODE_PLAN preserved across retry within the same task and at
 *     plan↔tool loop re-entries.
 *   - NODE_PLAN reset at fresh task entry and at the FIRST verify-mode
 *     entry of a self-verify Tier 2 task.
 *   - NODE_EXECUTE cleared at every plan entry.
 *   - Verification never enters retry — every cycle ends in `done:true`
 *     (via explicit `batches[]` fan-out or an empty plan).
 *
 * R1: task-type discrimination via `isVerificationTask` / `hooksForTaskType`.
 */

import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { VerificationTerminalError } from '../../../tasks/_shared/verify/terminal/errors';
import { VerificationBudget } from '../../../tasks/_shared/verify/terminal/budget';
import { requiresVerification } from '../../../tasks/_shared/verify/predicate';
import { markVerifyEntered } from '../../../tasks/_shared/verify/markVerifyEntered';
import { isVerificationTask } from '../../../tasks/verification';
import { recomputeInstallNeeded } from './installNeeded';
import { getExecutionLogger } from '../../../../../../../core/utils/executionLogger';

export interface PlanEntryContext {
  nextTask: CodeTask;
  isRetry: boolean;
  skipKeywordAndRAG: boolean;
  inToolLoop: boolean;
}

/**
 * `delta` MUST flow through `mergeDelta(base, delta)` at every plan() return
 * — the LangGraph reducer otherwise drops conversation/counter writes that
 * the entry handler made via state mutation alone.
 */
export interface PlanEntryResult {
  context: PlanEntryContext;
  delta: Partial<ArchitectGraphState>;
}

interface PlanEntryFlags {
  inToolLoop: boolean;
  isRetry: boolean;
}

export async function resolvePlanEntry(state: ArchitectGraphState): Promise<PlanEntryResult> {
  const inToolLoop = state._activePhase === 'plan' && !!state.currentTask;
  const entryReason = inToolLoop ? undefined : state._nextPlanEntry;
  if (!inToolLoop) state._nextPlanEntry = undefined;
  const isRetry = entryReason === 'retry';
  // Retry counter is OWNED by handleRetryEntry (single writer, bc1e45b9).
  // Fresh-task entry relies on TaskWorker seeding (`retries: 0`) and
  // checkTaskStatus success-path reset.
  const flags: PlanEntryFlags = { inToolLoop, isRetry };

  if (inToolLoop) {
    return handleToolLoopReentry(state, flags);
  }
  if (entryReason === 'retry' && state.currentTask) {
    return await handleRetryEntry(state, flags);
  }
  // Verification task type: every entry (fresh / cycle-N reverify) routes
  // through the fresh-task entry handler. Only Tier 2 self-verify tasks
  // (apply→verify transition) take the reverify path.
  if (entryReason === 'reverify' && state.currentTask) {
    if (isVerificationTask(state.currentTask)) {
      return await handleFreshTaskEntry(state, flags);
    }
    return await handleReverifyEntry(state, flags);
  }
  return await handleFreshTaskEntry(state, flags);
}

function handleToolLoopReentry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): PlanEntryResult {
  const nextTask = state.currentTask!;
  console.log(`\n🔄 [Plan] Re-entry from tool loop for task: ${nextTask.name}\n`);
  return {
    context: {
      nextTask,
      isRetry: flags.isRetry,
      skipKeywordAndRAG: false,
      inToolLoop: flags.inToolLoop,
    },
    delta: {},
  };
}

async function handleRetryEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryResult> {
  const nextTask = state.currentTask!;

  const planRetries = VerificationBudget.bumpPlanRetry(state);
  if (planRetries >= state.maxRetries) {
    throw new VerificationTerminalError(
      'max_retries_exceeded',
      `Task "${nextTask.name}" failed after ${planRetries} attempts (max: ${state.maxRetries}). Cannot proceed with automatic fixes.`,
    );
  }

  // Mutation + delta — mutation for same-turn body reads, delta for the
  // LangGraph reducer commit (conversationsReducer otherwise drops the
  // NODE_EXECUTE clear when plan returns through the tool_use branch).
  const preservedMsgCount = state.conversations?.[CONV_KEYS.NODE_PLAN]?.length ?? 0;
  state._executeCallIndex = 0;
  state.violations = [];
  state.conversations = {
    ...state.conversations,
    [CONV_KEYS.NODE_EXECUTE]: [],
  };
  const delta: Partial<ArchitectGraphState> = {
    _executeCallIndex: 0,
    violations: [],
    conversations: {
      [CONV_KEYS.NODE_EXECUTE]: [],
    },
  };
  console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})`);
  console.log(`   ♻️  node:execute cleared, node:plan preserved (${preservedMsgCount} messages)\n`);

  return {
    context: {
      nextTask,
      isRetry: flags.isRetry,
      skipKeywordAndRAG: false,
      inToolLoop: flags.inToolLoop,
    },
    delta,
  };
}

async function handleReverifyEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryResult> {
  const nextTask = state.currentTask!;
  console.log(`\n🔄 [Plan] Post-execute verification entry: ${nextTask.name}\n`);

  // Tier 2 self-verify (apply→verify transition). NODE_PLAN is preserved —
  // the apply phase's plan dialogue stays visible to the LLM as part of the
  // conversation history; the verify-mode template instructs it to plan
  // afresh against gate output.
  state._executeCallIndex = 0;
  state.violations = [];
  state.conversations = {
    ...state.conversations,
    [CONV_KEYS.NODE_EXECUTE]: [],
  };
  const delta: Partial<ArchitectGraphState> = {
    _executeCallIndex: 0,
    violations: [],
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
  };

  await recomputeInstallNeeded(state, { detectPmIfMissing: true });

  return {
    context: {
      nextTask,
      isRetry: flags.isRetry,
      skipKeywordAndRAG: true,
      inToolLoop: flags.inToolLoop,
    },
    delta,
  };
}

async function handleFreshTaskEntry(
  state: ArchitectGraphState,
  flags: PlanEntryFlags,
): Promise<PlanEntryResult> {
  const _wid = state.workerId;
  const isWorkerCtx = _wid !== undefined && _wid !== null;

  let nextTask: CodeTask;
  if (isWorkerCtx && state.currentTask) {
    nextTask = state.currentTask;
    console.log(`\n📋 [Plan] Task pre-assigned by orchestrator (worker ${_wid}): ${nextTask.name}\n`);
  } else {
    const popped = state.taskQueue?.pop();
    if (!popped) {
      throw new Error('[Plan] No tasks in queue');
    }
    nextTask = popped;
    console.log(`\n📋 [Plan] Next task: ${nextTask.name}\n`);
  }

  const { TaskTimingHelper } = await import('../../../state');
  console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
  nextTask = TaskTimingHelper.startTask(nextTask);

  const { resetTaskTokenUsage } = await import('../../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state);

  // Token carry seed for batch-split Path A re-queue. The requeued task
  // arrives with `tokenUsage` populated by `processDiagnosticBatchSplit`
  // (snapshot of `_currentTaskTokenUsage` at split time). Seeding the
  // task-level counter from it lets the task own its full lifetime usage
  // (pre-split + post-split LLM calls) by the time `completeTask` snapshots.
  // Job-level `state.tokenUsage` is unaffected — it has been accumulating
  // since the job started, so re-applying the carry would double-count.
  if (nextTask.tokenUsage) {
    state._currentTaskTokenUsage = { ...nextTask.tokenUsage };
  }

  state._executeCallIndex = 0;
  state._planSearchWebCount = 0;
  state.conversations = {
    ...state.conversations,
    [CONV_KEYS.NODE_PLAN]: [],
    [CONV_KEYS.NODE_EXECUTE]: [],
  };
  const delta: Partial<ArchitectGraphState> = {
    _executeCallIndex: 0,
    _planSearchWebCount: 0,
    conversations: {
      [CONV_KEYS.NODE_PLAN]: [],
      [CONV_KEYS.NODE_EXECUTE]: [],
    },
  };

  // Verification responsibility tasks (verification task type + Tier 2
  // self-verify) need an install-observation probe at fresh entry so the
  // verify-mode plan prompt sees `state._installNeededTransient`. Direct
  // call (the legacy `plan.handleFreshEntry` hook surface was retired by
  // plan §16 — the only thing it ever did was flag this side effect).
  if (requiresVerification(nextTask)) {
    await recomputeInstallNeeded(state, { detectPmIfMissing: true });
    // ★ Phase mode signal — Tier 3/4 dedicated verification tasks need
    // `_verifyEntered=true` from their first plan entry onward (apply
    // phase doesn't exist for them). The retired `_shared/verify/initSession`
    // module used to do this; vast-curling-perch cleanup deleted it without
    // replacing the call site, leaving `state._verifyEntered=false` for the
    // entire verification lifetime. Tier 2 self-verify tasks remain unaffected
    // — `requiresVerification(task)` is true for them too, but on apply-mode
    // entry they should NOT have `_verifyEntered=true` yet; the `executeRouter`
    // `<done>` arm flips it later. We therefore gate on
    // `isVerificationTask(task)` (Tier 3/4 only), not the broader predicate.
    // The helper is idempotent so repeated fresh entries (cycle 2+ via Path
    // A re-queue) are no-ops.
    if (isVerificationTask(nextTask)) {
      markVerifyEntered(state);
      delta._verifyEntered = true;
    }
  }

  if (state.context?.featurePath && state._httpJobId) {
    // Static import + synchronous writeQueue update — see executionLogger
    // contract (vast-curling-perch C-3 RCA).
    void getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    }).logTaskStart(nextTask.id, {
      taskName: nextTask.name,
      taskType: nextTask.type,
      priority: nextTask.priority,
      isParallel: !!(nextTask as any).parallelGroup,
      parallelGroup: (nextTask as any).parallelGroup,
    }).catch(() => { /* non-blocking */ });
  }

  // TaskOrchestrator handles kanban for parallel mode.
  if (!isWorkerCtx && state._httpJobId && state.deps?.kanbanUpdate) {
    console.log(`🔥 [Plan] Updating Kanban → task started`);
    console.log(`   Current: ${nextTask.name}`);
    console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);

    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      nextTask,
      state.taskQueue?.getAll() || [],
      state.completedTasksDetails || [],
      state.recursionCount,
      state.recursionLimit,
    );
  } else if (!isWorkerCtx) {
    if (!state._httpJobId) console.warn(`⚠️ [Plan] Kanban skipped: _httpJobId is missing`);
    if (!state.deps?.kanbanUpdate) console.warn(`⚠️ [Plan] Kanban skipped: deps.kanbanUpdate is null (broadcaster not injected)`);
  } else {
    console.log(`📋 [Plan] Kanban skipped: isWorkerCtx=true (orchestrator handles)`);
  }

  if (!isWorkerCtx && state.deps?.session && state.context.featureFolder) {
    try {
      const { saveCheckpoint } = await import('../../../session/checkpoint');
      await saveCheckpoint({
        ...state,
        currentTask: nextTask,
      });
    } catch (err) {
      console.warn(`⚠️  [Plan] Failed to save task-start checkpoint: ${err}`);
    }
  }

  return {
    context: {
      nextTask,
      isRetry: flags.isRetry,
      skipKeywordAndRAG: false,
      inToolLoop: flags.inToolLoop,
    },
    delta,
  };
}
