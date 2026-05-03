/**
 * `runPlanToolLoopPhase` — re-entry orchestrator for the plan↔tool loop.
 *
 * Called by each job's plan node when control returns from the tool node
 * after a previous round emitted tool_use blocks. Decides:
 *
 *   1. Are we still in the loop? (`isPlanActive` — typically checks
 *      `state._activePhase === 'plan' && history.length > 0`).
 *      If not → fallthrough so caller proceeds with fresh-entry path.
 *   2. Have we exceeded `toolLoopMax`?
 *      → invoke `onOverLimit(history)` to synthesize a `<plan>` from
 *        the gathered exploration context. If it succeeds → return
 *        `planText` with origin `'over-limit'`. Otherwise → fallthrough
 *        with reason `'over-limit-failed'`.
 *   3. Otherwise → invoke `runRound(history)` (caller's wrapper around
 *      `runPlanWithTools`) for one more round.
 *      → propagate `planText` / `toolCalls` / `null` outcomes.
 *
 * Caller responsibilities (NOT in this helper):
 *   - State shape mutation (e.g. setting `_activePhase`, conversation
 *     history merge, workflow exitNode bookkeeping).
 *   - Loop ceiling configuration (`toolLoopMax` defaults to
 *     `PLAN_TOOL_LOOP_MAX` but caller may override for tests).
 *   - Building messages / selecting model — caller's `runRound` closure.
 */

import type { ConversationMessage } from '../../conversations';
import { PLAN_TOOL_LOOP_MAX } from './constants';
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
  /** Loop ceiling — defaults to PLAN_TOOL_LOOP_MAX. */
  toolLoopMax?: number;
  /**
   * One more LLM+tools round. Caller's closure over `runPlanWithTools`
   * (with prompt/model/tools resolved per their job).
   */
  runRound: (history: ConversationMessage[]) => Promise<PlanRoundResult>;
  /**
   * Synthesize a `<plan>` from the exploration history without tools.
   * Returns the planText or null on failure. Caller wraps a finalize-from-
   * exploration LLM call (code = `finalizePlanFromExploration`, design = its
   * own variant).
   */
  onOverLimit: (history: ConversationMessage[]) => Promise<string | null>;
}

export async function runPlanToolLoopPhase(
  args: RunPlanToolLoopPhaseArgs,
): Promise<PlanLoopOutcome> {
  const { history, isActive, toolLoopMax = PLAN_TOOL_LOOP_MAX, runRound, onOverLimit } = args;
  if (!isActive) {
    return { kind: 'fallthrough', reason: 'no-output' };
  }

  const overLimit = history.length >= toolLoopMax * 2;
  if (overLimit) {
    console.log(
      `\n⚠️ [Plan] Plan↔tool loop limit (${toolLoopMax}) reached; finalizing plan from exploration context`,
    );
    const synthesized = await onOverLimit(history);
    if (synthesized && synthesized.length > 0) {
      return { kind: 'planText', planText: synthesized, origin: 'over-limit' };
    }
    console.log('⚠️ [Plan] over-limit synthesis failed');
    return { kind: 'fallthrough', reason: 'over-limit-failed' };
  }

  const result = await runRound(history);
  if (result === null) {
    return { kind: 'fallthrough', reason: 'no-output' };
  }
  if (result.kind === 'planText') {
    return { kind: 'planText', planText: result.planText, origin: 'tool-loop' };
  }
  return { kind: 'toolCalls', llmResponse: result.llmResponse, assistantMessage: result.assistantMessage };
}
