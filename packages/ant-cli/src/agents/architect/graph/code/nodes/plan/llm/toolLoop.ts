/**
 * STEP 0.9 — plan↔tool loop.
 *
 * Drives the plan↔tool loop and either produces a finalised plan state
 * (`kind: 'return'`) or asks the caller to fall through into normal plan
 * generation (`kind: 'fallthrough'`). Plan-tool-loop `read_file` results
 * live in NODE_PLAN conversation only — execute reads files on-demand
 * via its own tool calls.
 */

import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { finalizePlanFromExploration } from './finalize';
import { PLAN_TOOL_LOOP_MAX, runPlanLLMWithTools } from './tools';
import { finalizePlanOutcome } from '../outcome/finalize';

export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough'; forceNoTools?: boolean };

export async function runPlanToolLoopPhase(
  state: ArchitectGraphState,
  nextTask: CodeTask,
): Promise<PlanToolLoopOutcome> {
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  if (!(state._activePhase === 'plan' && nodePlan.length > 0)) {
    return { kind: 'fallthrough' };
  }

  const overLimit = nodePlan.length >= PLAN_TOOL_LOOP_MAX * 2;

  if (overLimit) {
    console.log(`\n⚠️ [Plan] Plan↔tool loop limit (${PLAN_TOOL_LOOP_MAX}) reached; finalizing plan from exploration context`);
    const finalizedPlan = await finalizePlanFromExploration(state, nodePlan as any, nextTask);
    if (finalizedPlan) {
      const returned = finalizePlanOutcome(state, nextTask, {
        preSplitPlanText: finalizedPlan,
        callSite: 'plan-llm-overlimit',
      });
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
      }
      return { kind: 'return', state: returned };
    }
    console.log(`⚠️ [Plan] finalizePlanFromExploration failed; falling back to generatePlanText`);
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
    const toolLoopOrigin: 'tool-loop-empty' | undefined =
      result.planText === '' ? 'tool-loop-empty' : undefined;
    const updatedState = finalizePlanOutcome(state, nextTask, {
      preSplitPlanText: result.planText,
      callSite: 'plan-llm-toolloop',
      planEmptyOrigin: toolLoopOrigin,
    });
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    return { kind: 'return', state: updatedState };
  }

  return { kind: 'fallthrough' };
}
