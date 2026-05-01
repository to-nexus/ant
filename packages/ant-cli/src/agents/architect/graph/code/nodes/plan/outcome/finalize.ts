/**
 * STEP 3.5 ~ STEP 4 — finalize the plan-LLM raw output into the graph
 * state shape executed downstream by the execute node.
 *
 * Single SSOT for the post-LLM pipeline:
 *   1. `dispatchBatchSplit` — fan out a remediation plan into sub-tasks
 *      via `outcome/queueDispatch.ts`. Queue mutation (sub-task push,
 *      parent re-queue / drop, `_batchSplitRequeued`, `Session.onBatchSplit`)
 *      lives there. Returned `planText === ''` means fan-out fired.
 *   2. Verification fan-out invariant assert (dev-assist).
 *   3. Compute shortcut flags (batchSplitOccurred / diagnosticPass /
 *      emptyImplShortCircuit / isDone) — decides short-circuit to
 *      checkTaskStatus vs hand-off to execute.
 *   4. Single-writer plan-history push via
 *      `_shared/verify/sessionLifecycle.onPlanApplied` — skipped when
 *      batch-split or empty-impl shortcut consumed the plan.
 *   5. `tracePlanFinalize` — single observation point for all three
 *      call sites (plan/index, plan/llm/toolLoop overlimit + continuation).
 *   6. Return the finalised `ArchitectGraphState` projection.
 */

import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import {
  assertVerificationPlanIsFanoutOnly,
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
} from '../../../tasks/_shared/verify/emptyImpl';
import { onPlanApplied } from '../../../tasks/_shared/verify/sessionLifecycle';
import { hooksForTaskType } from '../../../tasks/_shared/registry';
import { computeBudgetFromPlanText } from './budget';
import { dispatchBatchSplit } from './queueDispatch';
import { tracePlanFinalize, type PlanEmptyOrigin } from './trace';

export type FinalizeCallSite = 'plan-index' | 'plan-llm-overlimit' | 'plan-llm-toolloop';

export interface FinalizePlanOutcomeInput {
  /** Plan text produced by the plan-LLM call (or finalize-from-exploration). */
  preSplitPlanText: string;
  /** Trace label so the three former call sites stay distinguishable. */
  callSite: FinalizeCallSite;
  /**
   * RAG lessons collected during this plan entry. The two callers
   * differ in provenance — STEP 4 (`plan-index`) carries `rag.lessons`
   * from the freshly-run RAG pipeline, the tool-loop callers carry
   * `state.lessons` from prior entry. Pass through unchanged.
   */
  lessons?: ArchitectGraphState['lessons'];
  /** Caller-classified empty-`planText` origin; see `outcome/trace.ts`. */
  planEmptyOrigin?: PlanEmptyOrigin;
}

export function finalizePlanOutcome(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  input: FinalizePlanOutcomeInput,
): ArchitectGraphState {
  const { preSplitPlanText, callSite, lessons, planEmptyOrigin } = input;

  const planText = dispatchBatchSplit(state, preSplitPlanText, nextTask);
  assertVerificationPlanIsFanoutOnly(planText, nextTask);

  const batchSplitOccurred = preSplitPlanText.length > 50 && planText === '';
  const diagnosticPass = isVerificationPassWithoutCodeGen(state, nextTask, planText, batchSplitOccurred);
  const allowsEmptyImpl = hooksForTaskType(nextTask.type)?.plan?.allowsEmptyImplShortcut === true;
  const emptyImplShortCircuit = allowsEmptyImpl && hasEmptyImplementation(planText);
  const isDone = batchSplitOccurred || diagnosticPass || emptyImplShortCircuit;

  if (!batchSplitOccurred && !emptyImplShortCircuit) {
    onPlanApplied(state, planText, callSite);
  }

  tracePlanFinalize(state, nextTask, {
    callSite,
    preSplitPlanText,
    planText,
    batchSplitOccurred,
    diagnosticPass,
    emptyImplShortCircuit,
    // Trace key preserves the `isRemediationTask` name (consumers may grep
    // for it); the underlying axis is now the `allowsEmptyImplShortcut`
    // hook flag, semantically identical for the verification + error pair.
    isRemediationTask: allowsEmptyImpl,
    decision: isDone ? 'done' : 'execute',
    planEmptyOrigin,
  });

  if (callSite === 'plan-index') {
    if (emptyImplShortCircuit) {
      console.log(`[Plan] Empty implementation plan detected for ${nextTask.type} task → short-circuit to checkTaskStatus`);
    }
    console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
    if (planText) {
      console.log(`   ✅ planText stored in state.planText`);
      console.log(`   Preview: "${planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } else {
      console.log(`   ⚠️  planText is empty!`);
    }
  }

  return {
    ...state,
    currentTask: nextTask,
    lessons: lessons ?? state.lessons ?? [],
    planText,
    _executeBudget: planText ? computeBudgetFromPlanText(planText) : undefined,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    _activePhase: 'execute' as const,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
    llmResponse: isDone
      ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
      : { done: false, textResponse: '', thinking: '', toolCalls: [] },
  };
}
