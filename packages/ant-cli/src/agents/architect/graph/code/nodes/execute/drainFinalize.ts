/**
 * No-progress salvage for the code execute node (rocky-beating-coral RCA).
 *
 * When the no-progress streak nears the circuit breaker
 * (`NO_PROGRESS_HARD_CAP`), the model's remaining turns run tool-less with an
 * "apply your changes now" note, shortly BEFORE the router breaker diverts to
 * checkTaskStatus. This gives a degenerate re-read loop a salvage window to
 * convert its already-gathered context into `<file>` output instead of
 * burning the retry budget.
 *
 * Deliberately NOT triggered by recursion-budget exhaustion (unlike the
 * design-job port source): the code job's near-limit path is governed by
 * Safety Net A (verification-gated) plus the orchestrator's `recursion_limit`
 * interrupt, and silently stripping tools for all tasks near the limit would
 * change that contract.
 *
 * The strip PERSISTS while the trigger holds — it is NOT one-shot. A single
 * salvage turn proved insufficient (sandy-building-dryad: the model answered
 * its one tool-less turn with prose, got the tools back, and read on until
 * the breaker fired with zero output). Release is inherent to the trigger:
 * streaming a file / a tool mutation / `<done>` resets `_noProgressStreak`;
 * otherwise the streak only grows until the router breaker fires.
 */

import type { ArchitectGraphState } from '../../state';
import { NO_PROGRESS_HARD_CAP, DRAIN_FINALIZE_MARGIN } from '../../state';

type StreakInputs = Pick<
  ArchitectGraphState,
  '_noProgressStreak' | '_lastToolBatchAllDupReads'
>;

/**
 * Single owner of the `_noProgressStreak` increment/reset rule. The execute
 * node calls this once per turn (at its return section) and commits the
 * result on every return path.
 *
 * - Progress (streamed files, tool mutation, explicit `<done>`) → 0.
 * - Preceding tool batch was all duplicate-elided reads → +1.
 * - Tool-stripped salvage turn that still produced nothing → +1 (without
 *   this the streak would freeze at CAP − MARGIN once tools are stripped —
 *   the tool node stops running — and the model could emit prose forever
 *   below the breaker).
 * - Anything else (novel reads, commands, fresh reasoning) → 0.
 */
export function computeNextNoProgressStreak(
  state: StreakInputs,
  turn: {
    progressed: boolean;
    drainFinalizing: boolean;
    toolCallCount: number;
  },
): number {
  const prev = state._noProgressStreak || 0;
  if (turn.progressed) return 0;
  if (state._lastToolBatchAllDupReads === true) return prev + 1;
  if (turn.drainFinalizing && turn.toolCallCount === 0) return prev + 1;
  return 0;
}

export interface DrainFinalizeResult<TTool> {
  tools: TTool[];
  drainFinalizing: boolean;
}

/**
 * Mutates `messages` in place (appends the finalization note to the last
 * user message — post-composeMessages, so the note never lands inside a
 * cached prefix) and returns the (possibly stripped) tool list plus the
 * active-turn flag.
 */
export function applyDrainFinalization<TTool>(
  state: StreakInputs,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
): DrainFinalizeResult<TTool> {
  const streak = state._noProgressStreak || 0;
  const drainFinalizing = streak >= NO_PROGRESS_HARD_CAP - DRAIN_FINALIZE_MARGIN;

  if (!drainFinalizing) {
    return { tools, drainFinalizing: false };
  }

  const finalizeNote = `\n\n[SYSTEM] You have made no progress for ${streak} consecutive turns — ` +
    `every recent read returned content you already have. Tools are no longer available. ` +
    `Apply your remaining changes NOW from the context you have already gathered, using ` +
    `<file path="...">full file body</file> tags, or output <done>true</done> if the task's ` +
    `changes are already applied.`;

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
    `🧯 [Execute] No-progress salvage (streak=${streak} ≥ ${NO_PROGRESS_HARD_CAP - DRAIN_FINALIZE_MARGIN}) → tools stripped, forcing final output`,
  );
  return { tools: [], drainFinalizing: true };
}
