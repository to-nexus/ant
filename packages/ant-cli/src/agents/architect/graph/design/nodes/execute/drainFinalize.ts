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
 * Single owner of the `_noOutputCallCount` increment/reset rule. Mirror of the
 * code job's `computeNextNoOutputStreak` (code/nodes/execute/drainFinalize.ts).
 *
 * - Forward output (a `<file>` this turn) → 0.
 * - A turn with tool calls, OR a tool-stripped salvage turn that produced
 *   nothing → +1. The `drainFinalizing` clause is load-bearing: once the strip
 *   PERSISTS (this file's header), the tool node stops running, so without
 *   counting the stripped turns the streak would freeze one margin short of the
 *   cap and the breaker (executeRouter NO_OUTPUT_HARD_CAP) would be unreachable
 *   — the model could emit prose forever below it (round-grading-sable, the
 *   design twin of sandy-building-dryad).
 * - A plain reasoning-only re-entry (no tools, not finalizing) → 0.
 */
export function computeNextNoOutputCount(
  prev: number,
  turn: { hasNewFileOutput: boolean; hasToolCallsOnly: boolean; drainFinalizing: boolean },
): number {
  if (turn.hasNewFileOutput) return 0;
  if (turn.hasToolCallsOnly || turn.drainFinalizing) return prev + 1;
  return prev;
}

/**
 * Mutates `messages` in place (appends the finalization note to the last user
 * message, mirroring the no-output-streak nudge injection) and returns the
 * (possibly stripped) tool list plus the active-turn flag.
 *
 * `opts.targetExists` dispatches the drain-time exit affordance on the task's
 * write channel (the same disk-existence signal the prompt builders use for
 * REVISE-vs-generate): an existing target keeps the write tools (edit_file IS
 * the REVISE exit), a not-yet-created target strips ALL tools — its only
 * channel is the `<file>` tag, and a surviving edit_file can never succeed
 * against a missing file, so it becomes a degenerate error-loop attractor
 * instead (sharp-baking-bride RCA: 4× `edit_file` on the unborn spec doc
 * until the breaker). Defaults to `true` (keep write tools) when the caller
 * has no target signal.
 */
export function applyDrainFinalization<TTool>(
  state: DrainInputs,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
  opts?: { targetExists?: boolean },
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

  const targetExists = opts?.targetExists ?? true;
  const reasonNote = recursionTrigger
    ? `Recursion budget nearly exhausted (${remaining} steps left).`
    : `You have explored for ${noOutputCount} turns without writing anything.`;
  // The exit instruction must only advertise channels that can actually
  // succeed: edit_file against a not-yet-created target errors every time.
  const exitNote = targetExists
    ? `Exploration tools are no longer available. Finish NOW from the context you have ` +
      `already gathered: write the complete artifact body using <append>/<file> tags — or, when the ` +
      `target file already exists, apply your final edit_file changes — then output <done>true</done>.`
    : `Tools are no longer available. The target document does not exist yet, so there is ` +
      `nothing to edit. Write the complete artifact body NOW using the <file> tag from the ` +
      `context you have already gathered, then output <done>true</done>.`;
  const finalizeNote = `\n\n[SYSTEM] ${reasonNote} ${exitNote}`;

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
  // Strip EXPLORATION tools only when the target exists — write tools ARE the
  // exit for a REVISE task (its contract is read_file + edit_file, not <file>
  // regeneration; full-file regeneration of an existing bundle file from
  // partial context is destructive). A successful drained write resets the
  // streak via `_turnToolWrites`; `computeNextNoOutputCount`'s drainFinalizing
  // clause still bounds non-writing turns, so the breaker stays reachable.
  // `mkdir` is deliberately NOT a survivor: it emits no sideEffects, so it can
  // never satisfy the exit condition, yet it always "succeeds" — during forced
  // finalization it becomes the only rewarding call and traps the model in a
  // no-op loop until the breaker (oat-judging-mound RCA: 4× mkdir → design_no_output).
  // A not-yet-created target strips everything: no surviving write tool can
  // succeed against a missing file, and any survivor out-competes the <file>
  // tag as a tool-call attractor (sharp-baking-bride RCA).
  const WRITE_TOOL_NAMES = new Set(['edit_file', 'create_file', 'delete_file']);
  const drainedTools = targetExists
    ? tools.filter((t: any) => WRITE_TOOL_NAMES.has(t?.name))
    : ([] as TTool[]);
  console.warn(
    `🧯 [Execute] Drain finalization (${recursionTrigger ? `${remaining} steps remaining` : `no-output streak ${noOutputCount}`}) → ${targetExists ? `exploration tools stripped (${drainedTools.length} write tool(s) kept)` : 'all tools stripped (target not yet created — <file> tag is the only channel)'}, forcing final output`,
  );
  return { tools: drainedTools, drainFinalizing: true };
}
