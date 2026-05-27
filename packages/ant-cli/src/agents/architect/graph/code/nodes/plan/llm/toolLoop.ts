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

import type { LLMClient } from '../../../../../../../core/ports';
import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { runPlanLLMWithTools } from './tools';
import { generatePlanText } from './single';
import { finalizePlanOutcome } from '../outcome/finalize';
import {
  BatchSplitSchemaViolation,
  FlatPlanTooLargeViolation,
  buildFlatPlanTooLargeFraming,
  MAX_FLATPLAN_REFRAME_ATTEMPTS,
} from '../../../tasks/_shared/batchSplit';
import { runPlanToolLoopPhase as sharedRunPlanToolLoopPhase } from '../../../../../../common/graph/nodes/plan';

export type PlanToolLoopOutcome =
  | { kind: 'return'; state: ArchitectGraphState }
  | { kind: 'fallthrough' };

export async function runPlanToolLoopPhase(
  state: ArchitectGraphState,
  nextTask: CodeTask,
): Promise<PlanToolLoopOutcome> {
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const isActive = state._activePhase === 'plan' && nodePlan.length > 0;

  const outcome = await sharedRunPlanToolLoopPhase({
    history: nodePlan as any,
    isActive,
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
  });

  if (outcome.kind === 'fallthrough') {
    return { kind: 'fallthrough' };
  }

  if (outcome.kind === 'planText') {
    const callSite = 'plan-llm-toolloop' as const;
    // `feature`/`ui`/`design-system` finalise here, so this is where the
    // plan-time size gate (`process.ts` → `FlatPlanTooLargeViolation`) is
    // caught. On a trip we re-partition the LLM's OWN flat plan into
    // `batches[]` via a single-shot, no-tools re-emission (framing embeds
    // the flat plan, so no re-investigation — dim-beating-brass directive
    // #2). `_flatPlanReframeCount` (on the task) bounds the rounds; once it
    // hits `MAX_FLATPLAN_REFRAME_ATTEMPTS`, `process.ts` throws a terminal
    // `VerificationTerminalError('flatplan_too_large')` that is NOT a
    // `FlatPlanTooLargeViolation`, so it propagates here untouched → the
    // orchestrator soft-fails the task instead of executing into a crash.
    let planText = outcome.planText;
    let updatedState: ArchitectGraphState;
    for (;;) {
      const toolLoopOrigin: 'tool-loop-empty' | undefined =
        planText === '' ? 'tool-loop-empty' : undefined;
      try {
        updatedState = finalizePlanOutcome(state, nextTask, {
          preSplitPlanText: planText,
          callSite,
          planEmptyOrigin: toolLoopOrigin,
        });
        break;
      } catch (e) {
        if (e instanceof BatchSplitSchemaViolation) {
          // Tool-loop already burned its rounds producing this planText —
          // re-running for a schema retry is too expensive. Graceful skip:
          // log the violation and proceed with the parent task's own plan
          // (no fan-out). The main `plan/index.ts` retry path handles the
          // high-frequency case where retry is cheap.
          console.warn(
            `⚠️  [Plan/toolLoop] BatchSplitSchemaViolation in ${callSite}: ` +
            `${e.detail.entryKind}[${e.detail.ordinal}] ${e.detail.reason} '${e.detail.field}' — ` +
            `proceeding without fan-out (parent will execute its own plan).`,
          );
          updatedState = finalizePlanOutcome(state, nextTask, {
            preSplitPlanText: planText,
            callSite,
            planEmptyOrigin: toolLoopOrigin,
            skipBatchSplit: true,
          });
          break;
        }
        if (!(e instanceof FlatPlanTooLargeViolation)) throw e;

        const task = nextTask as { _flatPlanReframeCount?: number };
        task._flatPlanReframeCount = (task._flatPlanReframeCount ?? 0) + 1;
        console.warn(
          `⚠️  [Plan/toolLoop] FlatPlanTooLargeViolation — reframe ` +
          `${task._flatPlanReframeCount}/${MAX_FLATPLAN_REFRAME_ATTEMPTS}: ` +
          `${e.detail.topLevelImplCount} entries / ${e.detail.distinctTopLevelDomains} domains. ` +
          `Re-emitting flat plan as batches[] (single-shot, no re-investigation).`,
        );

        const llm = state.deps?.llm as LLMClient | undefined;
        if (!llm) {
          // No LLM to reframe with — graceful skip rather than crash.
          updatedState = finalizePlanOutcome(state, nextTask, {
            preSplitPlanText: planText,
            callSite,
            planEmptyOrigin: toolLoopOrigin,
            skipBatchSplit: true,
          });
          break;
        }

        // Reuse the single plan-retry framing slot: a flat-too-large plan
        // and a malformed-batches plan are mutually exclusive per LLM
        // output, so one slot (last-write-wins) is correct — no separate
        // flag. Scoped set→clear around the one reframe round.
        state._batchSplitViolationFraming = buildFlatPlanTooLargeFraming(e);
        let reframed = '';
        try {
          // Single-shot, no-tools re-emission. `generatePlanText` forces a
          // `<plan>` block and reads the framing via `buildPlanPrompt`.
          // codeContext is omitted — the framing carries the flat plan,
          // which is the only input the re-partition needs.
          reframed = await generatePlanText(llm, nextTask, state, undefined, state.violations);
        } finally {
          state._batchSplitViolationFraming = undefined;
        }
        if (!reframed) {
          updatedState = finalizePlanOutcome(state, nextTask, {
            preSplitPlanText: planText,
            callSite,
            planEmptyOrigin: toolLoopOrigin,
            skipBatchSplit: true,
          });
          break;
        }
        planText = reframed;
        // loop: finalize again with the re-partitioned plan.
      }
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
