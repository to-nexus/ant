/**
 * Drain-time forced finalization for the design execute node.
 *
 * When the recursion budget is nearly exhausted, the model gets exactly ONE
 * tool-less turn to emit the artifact from context it already gathered,
 * shortly BEFORE the router's drain guard (RECURSION_DRAIN_THRESHOLD) diverts
 * to checkTaskStatus. This converts an imminent recursion-limit pause into a
 * written (possibly partial) document instead of discarding hundreds of steps
 * of exploration (local-caring-board RCA). Same accepted pattern as
 * callLLMWithToolLoop's final-round tool strip. One-shot per task via
 * `_drainFinalized` (reset on task completion by checkTaskStatus).
 */

import type { DesignGraphState } from '../../state';
import { RECURSION_DRAIN_THRESHOLD, DRAIN_FINALIZE_MARGIN } from '../../routers/executeRouter';

type DrainInputs = Pick<DesignGraphState, 'recursionCount' | 'recursionLimit' | '_drainFinalized'>;

export interface DrainFinalizeResult<TTool> {
  tools: TTool[];
  drainFinalizing: boolean;
}

/**
 * Mutates `messages` in place (appends the finalization note to the last user
 * message, mirroring the no-output-streak nudge injection) and returns the
 * (possibly stripped) tool list plus the one-shot flag to commit on the
 * node's returned delta.
 */
export function applyDrainFinalization<TTool>(
  state: DrainInputs,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
): DrainFinalizeResult<TTool> {
  const remaining = (state.recursionLimit || 0) - (state.recursionCount || 0);
  const drainFinalizing = !!state.recursionLimit
    && remaining < RECURSION_DRAIN_THRESHOLD + DRAIN_FINALIZE_MARGIN
    && !state._drainFinalized;

  if (!drainFinalizing) {
    return { tools, drainFinalizing: false };
  }

  const finalizeNote = `\n\n[SYSTEM] Recursion budget nearly exhausted (${remaining} steps left). ` +
    `Tools are no longer available this turn. Emit your FINAL output NOW from the context you have ` +
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
  console.warn(`🧯 [Execute] Drain finalization: ${remaining} steps remaining → tools stripped, forcing final output`);
  return { tools: [], drainFinalizing: true };
}
