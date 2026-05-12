/**
 * `runPlanToolLoopPhase` — re-entry orchestrator for the plan↔tool loop.
 *
 * Called by each job's plan node when control returns from the tool node
 * after a previous round emitted tool_use blocks. Decides:
 *
 *   1. Are we still in the loop? (`isActive` — typically checks
 *      `state._activePhase === 'plan' && history.length > 0`).
 *      If not → fallthrough so caller proceeds with fresh-entry path.
 *   2. Otherwise → invoke `runRound(history)` (caller's wrapper around
 *      `runPlanWithTools`) for one more round.
 *      → propagate `planText` / `toolCalls` / `null` outcomes.
 *
 * No round cap by design: a per-loop ceiling would have to be either too
 * low (collapsing large parent tasks into flat plans under forced no-tools
 * synthesis) or arbitrary. Runaway is bounded by the orthogonal safety
 * nets — LangGraph `recursionLimit`, `executeRouter` Safety Nets A/E,
 * and `MAX_BATCH_SPLIT_CYCLES` for queue-side fan-out.
 *
 * Caller responsibilities (NOT in this helper):
 *   - State shape mutation (e.g. setting `_activePhase`, conversation
 *     history merge, workflow exitNode bookkeeping).
 *   - Building messages / selecting model — caller's `runRound` closure.
 */

import type { ConversationMessage } from '../../conversations';
import type { PlanLoopOutcome, PlanRoundResult } from './types';

export interface RunPlanToolLoopPhaseArgs {
  /** Conversation history for the plan↔tool loop (NODE_PLAN). */
  history: ConversationMessage[];
  /**
   * Whether the loop is currently active. Caller decides — typically
   * `state._activePhase === 'plan' && history.length > 0`. When false
   * the helper returns `fallthrough`. Caller can short-circuit fresh
   * entry without consulting this helper at all if preferred.
   */
  isActive: boolean;
  /**
   * One more LLM+tools round. Caller's closure over `runPlanWithTools`
   * (with prompt/model/tools resolved per their job).
   */
  runRound: (history: ConversationMessage[]) => Promise<PlanRoundResult>;
}

export async function runPlanToolLoopPhase(
  args: RunPlanToolLoopPhaseArgs,
): Promise<PlanLoopOutcome> {
  const { history, isActive, runRound } = args;
  if (!isActive) {
    return { kind: 'fallthrough', reason: 'no-output' };
  }

  const result = await runRound(history);
  if (result === null) {
    return { kind: 'fallthrough', reason: 'no-output' };
  }
  if (result.kind === 'planText') {
    return { kind: 'planText', planText: result.planText };
  }
  return { kind: 'toolCalls', llmResponse: result.llmResponse, assistantMessage: result.assistantMessage };
}
