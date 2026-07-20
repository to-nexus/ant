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

/** Ring size for `_recentExecuteTextHashes` — covers the A/B-alternating
 * degenerate pattern observed in vivid-orbiting-dodge (two sentences
 * alternated for ~30s before locking onto one). */
const RECENT_TEXT_RING_SIZE = 3;

function normalizeAssistantText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** FNV-1a 32-bit — non-crypto; a collision merely risks one spurious +1 in a
 * streak that needs 10+ consecutive hits to act. */
function hashText(normalized: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Output-side no-progress signal (vivid-orbiting-dodge RCA): the current
 * turn's assistant text is byte-identical (after whitespace/case
 * normalization) to one of the last `RECENT_TEXT_RING_SIZE` execute turns.
 * Degenerate loops repeat a fixed sentence verbatim; healthy execution
 * varies its narration every round. Empty text never matches.
 */
export function isRepeatedAssistantText(
  recentTextHashes: string[] | undefined,
  textResponse: string,
): boolean {
  const normalized = normalizeAssistantText(textResponse);
  if (!normalized) return false;
  return (recentTextHashes || []).includes(hashText(normalized));
}

/** Rolling window of the last few non-empty assistant text hashes. Committed
 * by the execute node on every return path (same cadence as
 * `_noProgressStreak`); task/attempt boundaries reset it to `[]`. */
export function computeNextRecentTextHashes(
  recentTextHashes: string[] | undefined,
  textResponse: string,
): string[] {
  const prev = recentTextHashes || [];
  const normalized = normalizeAssistantText(textResponse);
  if (!normalized) return prev;
  return [...prev, hashText(normalized)].slice(-RECENT_TEXT_RING_SIZE);
}

/**
 * Single owner of the `_noProgressStreak` increment/reset rule. The execute
 * node calls this once per turn (at its return section) and commits the
 * result on every return path.
 *
 * - Progress (streamed files, tool mutation, explicit `<done>`) → 0.
 * - Drain-finalize turn truncated at `max_tokens` with no open `<file>`
 *   block → jump to `NO_PROGRESS_HARD_CAP`. The model entered its forced
 *   final turn already degenerate and burned the whole output budget on
 *   repetition; granting the remaining drain turns is a repeat 17-minute
 *   gamble (vivid-orbiting-dodge call 219), while the router breaker's
 *   fresh-conversation retry is the designed escape for exactly this state.
 * - Preceding tool batch was all duplicate-elided reads → +1.
 * - Tool-stripped salvage turn that still produced nothing → +1 (without
 *   this the streak would freeze at CAP − MARGIN once tools are stripped —
 *   the tool node stops running — and the model could emit prose forever
 *   below the breaker).
 * - Assistant text identical to a recent turn with zero output → +1
 *   (novel-read degenerate variant: the model repeats one sentence while
 *   merely advancing a read cursor, so the dup-read signal stays silent
 *   until the file pool is exhausted — vivid-orbiting-dodge burned 190
 *   rounds / 20 min in that blind spot).
 * - Anything else (novel reads, commands, fresh reasoning) → 0.
 */
export function computeNextNoProgressStreak(
  state: StreakInputs,
  turn: {
    progressed: boolean;
    drainFinalizing: boolean;
    toolCallCount: number;
    repeatedIdenticalText?: boolean;
    drainTruncatedNoFile?: boolean;
  },
): number {
  const prev = state._noProgressStreak || 0;
  if (turn.progressed) return 0;
  if (turn.drainTruncatedNoFile === true) return NO_PROGRESS_HARD_CAP;
  if (state._lastToolBatchAllDupReads === true) return prev + 1;
  if (turn.drainFinalizing && turn.toolCallCount === 0) return prev + 1;
  if (turn.repeatedIdenticalText === true) return prev + 1;
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
