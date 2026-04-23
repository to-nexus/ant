/**
 * plan/parts/planLLM.ts — plan↔tool loop orchestration.
 *
 * Responsibilities:
 *   - `runPlanToolLoopPhase`: drives the plan↔tool loop and either produces
 *     a finalized plan state (`kind: 'return'`) or asks the caller to fall
 *     through into normal plan generation (`kind: 'fallthrough'`).
 *
 * Plan-tool-loop read_file results live in NODE_PLAN conversation only.
 * They are NOT merged back into any state channel — plan renders its own
 * prompt and execute reads files on-demand via its own tool calls, so
 * cross-phase pre-loading of file contents is unnecessary.
 *
 * The diagnostic batch-split hook is imported from `./batchSplit.ts` rather
 * than re-inlined so the two helpers stay co-located with their tests.
 */

import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import {
  finalizePlanFromExploration,
  PLAN_TOOL_LOOP_MAX,
  runPlanLLMWithTools,
} from '../planGeneration';
import { computeBudgetFromPlanText } from '../utils';
import {
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
  processDiagnosticBatchSplit,
} from './batchSplit';
import { maybeApplyPlanHistory } from './planHistory';
import { isVerificationTask } from '../../../tasks/verification';
import { isErrorTask } from '../../../tasks/error';

export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough'; forceNoTools?: boolean };

/**
 * STEP 0.9 helper — runs the plan↔tool loop and either produces a
 * finalized plan state (to short-circuit plan()) or asks the caller to
 * fall through into normal plan generation.
 */
export async function runPlanToolLoopPhase(
  state: ArchitectGraphState,
  nextTask: CodeTask,
): Promise<PlanToolLoopOutcome> {
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  if (!(state._activePhase === 'plan' && nodePlan.length > 0)) {
    return { kind: 'fallthrough' };
  }

  const overLimit = nodePlan.length >= PLAN_TOOL_LOOP_MAX * 2; // ~2 messages per round

  if (overLimit) {
    console.log(`\n⚠️ [Plan] Plan↔tool loop limit (${PLAN_TOOL_LOOP_MAX}) reached; finalizing plan from exploration context`);
    let finalizedPlan = await finalizePlanFromExploration(state, nodePlan as any, nextTask);
    if (finalizedPlan) {
      const preSplitPlan = finalizedPlan;
      finalizedPlan = processDiagnosticBatchSplit(state, finalizedPlan, nextTask);
      const batchSplitOccurred = preSplitPlan.length > 50 && finalizedPlan === '';
      const diagnosticPass = isVerificationPassWithoutCodeGen(state, finalizedPlan, batchSplitOccurred);
      const isRemediationTask = isVerificationTask(nextTask) || isErrorTask(nextTask);
      const emptyImplShortCircuit = isRemediationTask && hasEmptyImplementation(finalizedPlan);
      maybeApplyPlanHistory(state, finalizedPlan, batchSplitOccurred, nextTask);
      state._activePhase = 'execute';
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
      }
      const returned: ArchitectGraphState = {
        ...state,
        currentTask: nextTask,
        lessons: state.lessons ?? [],
        planText: finalizedPlan,
        _executeBudget: computeBudgetFromPlanText(finalizedPlan),
        _activePhase: 'execute' as const,
        conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
        // retries intentionally NOT set — handleRetryEntry is the single
        // writer (bc1e45b9). `...state` propagates the correct value.
        completedTasksDetails: state.completedTasksDetails || [],
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        workspaceConfig: state.workspaceConfig,
        llmResponse: (batchSplitOccurred || diagnosticPass || emptyImplShortCircuit)
          ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
          : { done: false, textResponse: '', thinking: '', toolCalls: [] },
      };
      return { kind: 'return', state: returned };
    }
    console.log(`⚠️ [Plan] finalizePlanFromExploration failed; falling back to generatePlanText`);
    state._activePhase = 'execute';
    return { kind: 'fallthrough', forceNoTools: true };
  }

  const result = await runPlanLLMWithTools(state, nodePlan as any, nextTask);
  if (result && '_activePhase' in result) {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    const returned: ArchitectGraphState = {
      ...state,
      conversations: { [CONV_KEYS.NODE_PLAN]: result.nodePlanHistory },
      _activePhase: 'plan' as const,
      llmResponse: result.llmResponse,
      lessons: state.lessons,
    };
    return { kind: 'return', state: returned };
  }
  if (result && 'planText' in result) {
    const preSplitPlan = result.planText;
    const planText = processDiagnosticBatchSplit(state, preSplitPlan, nextTask);
    const batchSplitOccurred = preSplitPlan.length > 50 && planText === '';
    const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
    maybeApplyPlanHistory(state, planText, batchSplitOccurred, nextTask);
    const updatedState: ArchitectGraphState = {
      ...state,
      currentTask: nextTask,
      lessons: state.lessons ?? [],
      planText,
      _executeBudget: computeBudgetFromPlanText(planText),
      _activePhase: 'execute' as const,
      conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
      // retries intentionally NOT set — handleRetryEntry is the single
      // writer (bc1e45b9). `...state` propagates the correct value.
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      llmResponse: (batchSplitOccurred || diagnosticPass)
        ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
        : { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    return { kind: 'return', state: updatedState };
  }

  state._activePhase = 'execute';
  return { kind: 'fallthrough' };
}
