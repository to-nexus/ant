/**
 * No-progress salvage for the code execute node (rocky-beating-coral RCA).
 *
 * When the no-progress streak nears the circuit breaker
 * (`NO_PROGRESS_HARD_CAP`), the model's remaining turns run tool-less with an
 * "apply your changes now" note, shortly BEFORE the router breaker diverts to
 * checkTaskStatus. This gives a degenerate re-read loop a salvage window to
 * convert its already-gathered context into file output instead of
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
import { NO_PROGRESS_HARD_CAP, DRAIN_FINALIZE_MARGIN, NO_OUTPUT_HARD_CAP } from '../../state';
// Single-owner primitives — see core/utils/textRepetition.ts (also consumed
// by callLLMWithToolLoop's in-stream degeneration breaker).
import { normalizeAssistantText, hashText } from '../../../../../../core/utils/textRepetition';

type StreakInputs = Pick<
  ArchitectGraphState,
  '_noProgressStreak' | '_lastToolBatchAllDupReads' | '_noOutputStreak'
>;

/** Ring size for `_recentExecuteTextHashes` — covers the A/B-alternating
 * degenerate pattern observed in vivid-orbiting-dodge (two sentences
 * alternated for ~30s before locking onto one). */
const RECENT_TEXT_RING_SIZE = 3;

/**
 * Command-output identity hash (shy-crushing-bloom RCA). Volatile numerals
 * (durations, timestamps, per-test ms) are masked to `#` before hashing —
 * the incident's 357 identical vitest runs oscillated between 2627/2628
 * chars purely on a timing digit, so byte-identity would never match. The
 * masking cannot hide real progress: an output only changes meaningfully
 * after a mutation, and any mutation turn resets the no-progress streak
 * before this hash is ever compared.
 */
export function hashCommandOutput(output: string): string {
  const normalized = output
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');
  return hashText(normalized);
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
 * - Drain-finalize turn truncated at `max_tokens` with no open file
 *   write → jump to `NO_PROGRESS_HARD_CAP`. The model entered its forced
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

/**
 * Single owner of the `_noOutputStreak` increment/reset rule (cyan-catching-
 * cedar RCA). Complements `computeNextNoProgressStreak`: it counts consecutive
 * execute turns with NO FORWARD OUTPUT, regardless of read/search novelty, so
 * a loop that keeps issuing genuinely-novel reads (novel line ranges of
 * already-read files, novel `search_code`) while producing no
 * mutation / `<done>` is still bounded. Ported from the design job's
 * `_noOutputCallCount` rule.
 *
 * - Forward output (tool mutation or explicit `<done>`) → 0.
 * - A turn with tool calls, OR a tool-stripped salvage turn that produced
 *   nothing → +1. The `drainFinalizing` clause mirrors the `_noProgressStreak`
 *   salvage rule: once tools are stripped the tool node stops running, so
 *   without this the streak would freeze one short of the cap and the model
 *   could emit prose forever below the breaker (sandy-building-dryad).
 * - A plain reasoning-only re-entry (no tools, not finalizing) → 0.
 *
 * Kept a SEPARATE function (not folded into `computeNextNoProgressStreak`)
 * because that function is shared with the plan tool-loop, whose rounds
 * legitimately never write files. This rule is execute-only.
 */
export function computeNextNoOutputStreak(
  state: Pick<ArchitectGraphState, '_noOutputStreak'>,
  turn: { progressed: boolean; toolCallCount: number; drainFinalizing: boolean },
): number {
  const prev = state._noOutputStreak || 0;
  if (turn.progressed) return 0;
  if (turn.toolCallCount > 0 || turn.drainFinalizing) return prev + 1;
  return 0;
}

/**
 * Salvage-window tool surface: file-writing only. Exploration (read/search/
 * list) is what the degenerate loop was burning turns on; the WRITE channel
 * must stay open or the salvage window has no way to apply changes at all
 * (the pre-tool-protocol design used `toolChoice:'none'` + `<file>` tags —
 * with tags retired, 'none' would leave zero write channels).
 * `mkdir` stays excluded (oat-judging-mound: 4× mkdir "progress" →
 * design_no_output) and `delete_file` is never the salvage move.
 */
export const DRAIN_SALVAGE_WRITE_TOOLS = ['create_file', 'append_file', 'edit_file'] as const;

export interface DrainFinalizeResult<TTool> {
  tools: TTool[];
  /**
   * `{ allow: [write tools] }` while draining: the advertised set narrows to
   * the file-writing tools, so exploration stops but changes can still land.
   * Declarations are never DELETED outright — deleting them while the history
   * is full of tool_calls degenerated GLM into repetition loops against the
   * full output budget (vivid-orbiting-dodge at 64K; same axis as
   * sage-causing-rover). resolveToolChoice keeps ≥1 tool declared.
   */
  toolChoice?: import('../../../../../../core/ports/llm').LLMToolChoice;
  drainFinalizing: boolean;
  /**
   * The salvage allow-list this round's LLM actually received (same value as
   * `toolChoice.allow`). Published on the `_drainSalvageTools` channel so the
   * tool node can REFUSE calls outside it — `{ allow }` only narrows the
   * ADVERTISED declarations, and OpenAI-compat providers (GLM) keep emitting
   * history-pattern tools that are not declared (narrow-ending-flour RCA).
   */
  salvageTools?: string[];
}

/**
 * Mutates `messages` in place (appends the finalization note to the last
 * user message — post-composeMessages, so the note never lands inside a
 * cached prefix) and returns the tool list + tool-call constraint plus the
 * active-turn flag.
 */
export function applyDrainFinalization<TTool>(
  state: StreakInputs,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
): DrainFinalizeResult<TTool> {
  const progressStreak = state._noProgressStreak || 0;
  const outputStreak = state._noOutputStreak || 0;
  const drainFinalizing =
    progressStreak >= NO_PROGRESS_HARD_CAP - DRAIN_FINALIZE_MARGIN ||
    outputStreak >= NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;

  if (!drainFinalizing) {
    return { tools, drainFinalizing: false };
  }

  // Cover both triggers: `_noProgressStreak` (re-reading already-seen content)
  // and `_noOutputStreak` (novel reads/searches but zero file output).
  const streak = Math.max(progressStreak, outputStreak);
  const finalizeNote = `\n\n[SYSTEM] You have produced no file output for ${streak} consecutive turns — ` +
    `further reading or searching is not making progress. Exploration tools are no longer available; ` +
    `only the file-writing tools (${DRAIN_SALVAGE_WRITE_TOOLS.join(', ')}) remain. ` +
    `Apply your remaining changes NOW from the context you have already gathered by calling ` +
    `create_file / edit_file / append_file, or output <done>true</done> if the task's ` +
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
    `🧯 [Execute] No-output salvage (noProgress=${progressStreak}/${NO_PROGRESS_HARD_CAP}, noOutput=${outputStreak}/${NO_OUTPUT_HARD_CAP}) → toolChoice={allow: write tools}, forcing final output`,
  );
  return {
    tools,
    toolChoice: { allow: [...DRAIN_SALVAGE_WRITE_TOOLS] },
    drainFinalizing: true,
    salvageTools: [...DRAIN_SALVAGE_WRITE_TOOLS],
  };
}
