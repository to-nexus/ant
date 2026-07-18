/**
 * Drain-time forced finalization for the design execute node.
 *
 * When the recursion budget is nearly exhausted OR the no-output streak nears
 * the circuit breaker (NO_OUTPUT_HARD_CAP), the model's remaining turns run
 * tool-less with an "emit the artifact now" note, shortly BEFORE the router's
 * drain guard diverts to checkTaskStatus. This converts an imminent pause
 * into a written (possibly partial) document instead of discarding the
 * exploration (local-caring-board RCA).
 *
 * The strip PERSISTS while a trigger holds — it is NOT one-shot. A single
 * salvage turn proved insufficient (sandy-building-dryad: the model answered
 * its one tool-less turn with prose, got the tools back, and read on until
 * the breaker fired with zero output). Release is inherent to the triggers:
 * writing a file resets `_noOutputCallCount`, and the recursion budget only
 * tightens until checkTaskStatus resets the counters at the task boundary.
 */

import type { DesignGraphState } from '../../state';
import { RECURSION_DRAIN_THRESHOLD, DRAIN_FINALIZE_MARGIN, NO_OUTPUT_HARD_CAP } from '../../routers/executeRouter';

type DrainInputs = Pick<DesignGraphState, 'recursionCount' | 'recursionLimit' | '_noOutputCallCount'>;

export interface DrainFinalizeResult<TTool> {
  tools: TTool[];
  drainFinalizing: boolean;
}

/**
 * Mutates `messages` in place (appends the finalization note to the last user
 * message, mirroring the no-output-streak nudge injection) and returns the
 * (possibly stripped) tool list plus the active-turn flag.
 */
export function applyDrainFinalization<TTool>(
  state: DrainInputs,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
): DrainFinalizeResult<TTool> {
  const remaining = (state.recursionLimit || 0) - (state.recursionCount || 0);
  const noOutputCount = state._noOutputCallCount || 0;
  // Two independent triggers; the strip holds for every turn a trigger is true:
  //  - recursion budget nearly exhausted, or
  //  - no-output streak within the finalize margin below the circuit breaker.
  const recursionTrigger = !!state.recursionLimit
    && remaining < RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN;
  const noOutputTrigger = noOutputCount >= NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;
  const drainFinalizing = recursionTrigger || noOutputTrigger;

  if (!drainFinalizing) {
    return { tools, drainFinalizing: false };
  }

  const reasonNote = recursionTrigger
    ? `Recursion budget nearly exhausted (${remaining} steps left).`
    : `You have explored for ${noOutputCount} turns without writing anything.`;
  const finalizeNote = `\n\n[SYSTEM] ${reasonNote} ` +
    `Tools are no longer available. Emit your FINAL output NOW from the context you have ` +
    `already gathered: write the complete artifact body using <append>/<file> tags and finish with <done>true</done>.`;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    if (Array.isArray(lastMsg.content)) {
      (lastMsg.content as any[]).push({ type: 'text', text: finalizeNote });
    } else if (typeof lastMsg.content === 'string') {
      lastMsg.content = [
        { type: 'text', text: lastMsg.content },
        { type: 'text', text: finalizeNote },
      ];
    }
  }
  console.warn(
    `🧯 [Execute] Drain finalization (${recursionTrigger ? `${remaining} steps remaining` : `no-output streak ${noOutputCount}`}) → tools stripped, forcing final output`,
  );
  return { tools: [], drainFinalizing: true };
}
