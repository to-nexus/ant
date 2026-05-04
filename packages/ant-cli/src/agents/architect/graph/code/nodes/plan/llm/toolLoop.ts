/**
 * STEP 0.9 — plan↔tool loop (code job).
 *
 * Thin wrapper around the shared `runPlanToolLoopPhase` helper in
 * `agents/common/graph/nodes/plan/`. Code-specific concerns retained:
 *   - `_activePhase === 'plan'` gating against the code state shape.
 *   - finalizePlanOutcome / batch-split shape on success.
 *   - workflowUpdate.exitNode bookkeeping.
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
import { runPlanLLMWithTools } from './tools';
import { finalizePlanOutcome } from '../outcome/finalize';
import { BatchSplitSchemaViolation } from '../../../tasks/_shared/batchSplit';
import {
  runPlanToolLoopPhase as sharedRunPlanToolLoopPhase,
  PLAN_TOOL_LOOP_MAX,
} from '../../../../../../common/graph/nodes/plan';

export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough'; forceNoTools?: boolean };

export async function runPlanToolLoopPhase(
  state: ArchitectGraphState,
  nextTask: CodeTask,
): Promise<PlanToolLoopOutcome> {
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const isActive = state._activePhase === 'plan' && nodePlan.length > 0;

  const outcome = await sharedRunPlanToolLoopPhase({
    history: nodePlan as any,
    isActive,
    toolLoopMax: PLAN_TOOL_LOOP_MAX,
    runRound: async (history) => {
      const result = await runPlanLLMWithTools(state, history as any, nextTask);
      if (result === null) return null;
      if ('planText' in result) {
        return { kind: 'planText', planText: result.planText };
      }
      // Tool-calls branch: re-shape to the shared helper's expected output.
      // The legacy `runPlanLLMWithTools` returns `nodePlanHistory` already
      // appended; the shared helper expects a single assistant message.
      const last = result.nodePlanHistory[result.nodePlanHistory.length - 1] as any;
      return {
        kind: 'toolCalls',
        llmResponse: result.llmResponse,
        assistantMessage: last,
      };
    },
    onOverLimit: async (history) =>
      (await finalizePlanFromExploration(state, history as any, nextTask)) ?? null,
  });

  if (outcome.kind === 'fallthrough') {
    return { kind: 'fallthrough', forceNoTools: outcome.reason === 'over-limit-failed' };
  }

  if (outcome.kind === 'planText') {
    const toolLoopOrigin: 'tool-loop-empty' | undefined =
      outcome.planText === '' ? 'tool-loop-empty' : undefined;
    const callSite = outcome.origin === 'over-limit' ? 'plan-llm-overlimit' : 'plan-llm-toolloop';
    let updatedState: ArchitectGraphState;
    try {
      updatedState = finalizePlanOutcome(state, nextTask, {
        preSplitPlanText: outcome.planText,
        callSite,
        planEmptyOrigin: toolLoopOrigin,
      });
    } catch (e) {
      if (!(e instanceof BatchSplitSchemaViolation)) throw e;
      // Tool-loop already burned its rounds producing this planText —
      // re-running for a retry is too expensive. Graceful skip: log the
      // violation and proceed with the parent task's own plan (no fan-out).
      // The main `plan/index.ts` retry path handles the high-frequency
      // case where retry is cheap. Toolloop violations are rare in
      // practice (tool-loop output is more constrained than top-level
      // emissions) but the safety net is here for completeness.
      console.warn(
        `⚠️  [Plan/toolLoop] BatchSplitSchemaViolation in ${callSite}: ` +
        `${e.detail.entryKind}[${e.detail.ordinal}] missing '${e.detail.missingField}' — ` +
        `proceeding without fan-out (parent will execute its own plan).`,
      );
      updatedState = finalizePlanOutcome(state, nextTask, {
        preSplitPlanText: outcome.planText,
        callSite,
        planEmptyOrigin: toolLoopOrigin,
        skipBatchSplit: true,
      });
    }
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    return { kind: 'return', state: updatedState };
  }

  // toolCalls: short-circuit to tool node. Re-build NODE_PLAN history
  // from previous + assistant message (legacy shape).
  const updatedHistory = [...nodePlan, outcome.assistantMessage] as any;
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
  }
  const returned: ArchitectGraphState = {
    ...state,
    conversations: { [CONV_KEYS.NODE_PLAN]: updatedHistory },
    _activePhase: 'plan' as const,
    llmResponse: outcome.llmResponse as any,
    lessons: state.lessons,
  };
  return { kind: 'return', state: returned };
}
