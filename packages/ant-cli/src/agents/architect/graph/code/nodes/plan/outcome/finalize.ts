/**
 * STEP 3.5 ~ STEP 4 — finalize the plan-LLM raw output into the
 * graph state shape executed downstream by the execute node.
 *
 * Single SSOT for the post-LLM pipeline:
 *
 *   1. `processDiagnosticBatchSplit` — fan out a remediation plan into
 *      sub-tasks. When fan-out fires, the original task is consumed by
 *      the queue mutation and returned planText is `''`.
 *   2. Verification fan-out invariant assert (dev-assist; never throws
 *      in apply-mode, throws when a verification task's planText
 *      survived with implementation entries that should have been
 *      converted).
 *   3. Compute the four shortcut flags (batchSplitOccurred /
 *      diagnosticPass / emptyImplShortCircuit / isDone) that decide
 *      whether the plan node short-circuits to checkTaskStatus or
 *      hands off to execute.
 *   4. Single-writer plan-history push via
 *      `_shared/verify/sessionLifecycle.onPlanApplied` — skipped when
 *      batch-split or empty-impl shortcut consumed the plan.
 *   5. `tracePlanFinalize` — single observation point for the three
 *      former call sites (plan/index, plan/llm/toolLoop overlimit,
 *      plan/llm/toolLoop continuation).
 *   6. Return the finalised `ArchitectGraphState` projection. Callers
 *      hand it back to LangGraph (after `mergeDelta` with the entry
 *      delta when applicable).
 *
 * R1 — the function does inspect `isVerificationTask` / `isErrorTask`
 * for the empty-impl shortcut gate. That predicate pair stays inside
 * this single helper instead of being scattered across both former
 * call sites.
 */

import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { processDiagnosticBatchSplit } from '../../../tasks/_shared/batchSplit';
import {
  assertVerificationPlanIsFanoutOnly,
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
} from '../../../tasks/_shared/verify/emptyImpl';
import { onPlanApplied } from '../../../tasks/_shared/verify/sessionLifecycle';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';
import { computeBudgetFromPlanText } from './budget';
import { tracePlanFinalize } from './trace';

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
}

export function finalizePlanOutcome(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  input: FinalizePlanOutcomeInput,
): ArchitectGraphState {
  const { preSplitPlanText, callSite, lessons } = input;

  const planText = processDiagnosticBatchSplit(state, preSplitPlanText, nextTask);
  assertVerificationPlanIsFanoutOnly(planText, nextTask);

  const batchSplitOccurred = preSplitPlanText.length > 50 && planText === '';
  const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
  const isRemediationTask = isVerificationTask(nextTask) || isErrorTask(nextTask);
  const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(planText);
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
    isRemediationTask,
    decision: isDone ? 'done' : 'execute',
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
