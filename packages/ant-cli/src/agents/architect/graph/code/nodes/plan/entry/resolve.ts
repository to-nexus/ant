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
  // Channel snapshot — every input to the Tier-2 reverify gate plus adjacent
  // signals, so a regression like cool-mossing-jewel (2026-05-16) can be
  // diagnosed from a single log line without re-instrumenting.
  console.log('[PlanEntry] Channel snapshot:', {
    hasTask: !!state.currentTask,
    taskId: state.currentTask?.id,
    taskType: state.currentTask?.type,
    selfVerifyOnDone: (state.currentTask as { selfVerifyOnDone?: boolean } | undefined)?.selfVerifyOnDone,
    requiresVerification: !!state.currentTask && requiresVerification(state.currentTask),
    isVerificationTask: !!state.currentTask && isVerificationTask(state.currentTask),
    _activePhase: state._activePhase,
    llmResponseDone: state.llmResponse?.done,
    planTextLen: state.planText?.length ?? 0,
    _verifyEntered: state._verifyEntered,
    _nextPlanEntry: state._nextPlanEntry,
    nodePlanMsgs: state.conversations?.[CONV_KEYS.NODE_PLAN]?.length ?? 0,
  });

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

  // Tier-2 self-verify apply→verify boundary (and every subsequent reverify
  // cycle). Detected from committed channel state alone — every input is
  // already a stable channel value, so no transient flag is needed (the
  // previous `_nextPlanEntry='reverify'` flag was a router-side mutation
  // that LangGraph silently discarded; see markVerifyEntered.ts anti-pattern
  // note). Tier-3/4 verification tasks intentionally fall through to
  // handleFreshTaskEntry — they reset NODE_PLAN every cycle by design and
  // own their own _verifyEntered delta from that path.
  //
  // ★ Phase guard uses `_activePhase !== 'plan'` (not `=== 'execute'`) so
  // that an accidental `undefined` commit on the channel cannot suppress
  // reverify dispatch. The tool-loop reentry (`_activePhase === 'plan' &&
  // currentTask`) is already absorbed at line 50, so anything reaching this
  // point came from outside the plan tool-loop — i.e. the executeRouter
  // `done:true` arm. Regression: cool-mossing-jewel (2026-05-16) fell into
  // handleFreshTaskEntry from here, clearing NODE_PLAN and re-prompting
  // with the apply-mode error template — symptoms matched a phase-channel
  // leak the strict equality could not survive.
  const condHasTask = !!state.currentTask;
  const condRequiresVerify = condHasTask && requiresVerification(state.currentTask!);
  const condNotVerifyTask = condHasTask && !isVerificationTask(state.currentTask!);
  const condPhaseNotPlan = state._activePhase !== 'plan';
  const condDone = state.llmResponse?.done === true;
  const condPlanText = !!state.planText?.trim();
  const isTier2ReverifyEntry =
    condHasTask &&
    condRequiresVerify &&
    condNotVerifyTask &&
    condPhaseNotPlan &&
    condDone &&
    condPlanText;
  console.log('[PlanEntry] Tier2Reverify gate breakdown:', {
    condHasTask,
    condRequiresVerify,
    condNotVerifyTask,
    condPhaseNotPlan,
    condDone,
    condPlanText,
    decision: isTier2ReverifyEntry ? 'reverify' : 'fresh',
  });
  if (isTier2ReverifyEntry) {
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

  // Tier 2 self-verify (apply→verify transition + subsequent reverify cycles).
  // NODE_PLAN, NODE_EXECUTE, and `violations` are all preserved here so the
  // plan-LLM call in `plan/index.ts` can spread them (via `compactRun`) into
  // its `messages` array — the apply-phase exploration + execution + any
  // verify-gate findings become conversation history for the verify-mode
  // plan turn. `plan-finalize` later clears NODE_EXECUTE on its return to
  // execute, so the next execute cycle still starts with a fresh slate.
  // `violations` is over-write semantics (last-write-wins; `checkTaskStatus`
  // is the sole non-empty writer), so preserving it here does not
  // accumulate stale entries across cycles.
  //
  // ★ Phase mode signal — sole SSOT writer for Tier-2 `_verifyEntered`. The
  // helper is idempotent (reducer is last-write-wins), so cycle 2+ entries
  // re-write `true → true` as a no-op. Mutation + delta mirrors the pattern
  // in handleFreshTaskEntry (mutation for same-turn body reads,
  // `delta._verifyEntered` for the LangGraph reducer commit).
  state._verifyEntered = true;
  state._executeCallIndex = 0;
  const delta: Partial<ArchitectGraphState> = {
    _executeCallIndex: 0,
    _verifyEntered: true,
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
