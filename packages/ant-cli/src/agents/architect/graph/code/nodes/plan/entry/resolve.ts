/**
 * STEP 0 entry dispatcher.
 *
 * Conversation retention:
 *   - NODE_PLAN preserved across retry within the same task and at
 *     plan↔tool loop re-entries.
 *   - NODE_PLAN reset at fresh task entry and at the FIRST verify-mode
 *     entry of a self-verify Tier 2 task.
 *   - NODE_EXECUTE cleared at every plan entry.
 *   - Verification never enters retry under always-fan-out (every cycle
 *     ends in `done:true`).
 *
 * R1: task-type discrimination via `isVerificationTask` / `hooksForTaskType`.
 */

import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { detectTestFilesFromDisk, isTypeScriptProject } from '../../../tasks/_shared/verify/env';
import { VerificationTerminalError } from '../../../tasks/_shared/verify/errors';
import { VerificationBudget } from '../../../tasks/_shared/verify/budget';
import { hooksForTaskType } from '../../../tasks/_shared/registry';
import { isVerificationTask } from '../../../tasks/verification';
import { recomputeInstallNeeded } from './installNeeded';

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

  // Termination dispatch (R1). Verification's hook is currently a no-op
  // here because verification never reaches retry under always-fan-out;
  // the lookup stays for future task-type plug-ins.
  const planHook = hooksForTaskType(nextTask.type)?.plan;
  const hookTerminal = planHook?.checkRetryTermination?.(state);
  if (hookTerminal) {
    console.error(`\n❌ [Plan] ${nextTask.name} terminated (${hookTerminal.kind}): ${hookTerminal.message}\n`);
    throw hookTerminal;
  }

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

  // Fresh-entry side-effects (currently: install-observation request) are
  // bundled into `plan.handleFreshEntry`. Verification publishes the hook;
  // other task types get `undefined` and the call is a no-op.
  const tsProject = isTypeScriptProject(state);
  const hasTests = detectTestFilesFromDisk(state.context?.featurePath);
  const freshResult = hooksForTaskType(nextTask.type)?.plan?.handleFreshEntry?.(
    state,
    { isTs: tsProject, hasTests },
  );
  if (freshResult?.needsInstallObservation) {
    await recomputeInstallNeeded(state, { detectPmIfMissing: true });
  }

  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger } = await import('../../../../../../../core/utils/executionLogger');
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    execLogger.logTaskStart(nextTask.id, {
      taskName: nextTask.name,
      taskType: nextTask.type,
      priority: nextTask.priority,
      isParallel: !!(nextTask as any).parallelGroup,
      parallelGroup: (nextTask as any).parallelGroup,
    }).catch(() => {});
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
