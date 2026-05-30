/**
 * `_shared/verify/antrulesDecisionCheck` — mandatory `<antrules-decision>` gate
 * for Tier 3/4 final verification tasks.
 *
 * Closes the Defect 2 detection responsibility gap: prior to this gate the
 * decision to record an ANTRULES entry was entirely *discretionary* — the
 * verification prompt asked the LLM to apply the 3-condition filter but
 * never asked it to *prove* the filter ran. Silent skip was the dominant
 * outcome (0% ANTRULES creation observed in green-camping-brick despite
 * multiple filter-passing candidates).
 *
 * Activation gate: `isVerificationTask(task)` AND `state.llmResponse.done === true`.
 *
 * - Tier 2 self-verify (`task.selfVerifyOnDone === true` on feature / ui /
 *   error / setup tasks) is intentionally OUT of scope — those reverify
 *   phases are per-task code checks; forcing an ANTRULES decision there
 *   would over-fire (`feedback-antrules-broad-role` — "다른 task 에 mirror
 *   시도 시 본 feedback 위반").
 * - Tier 0/1 has no verification task at all.
 *
 * The gate inspects the textual LLM response for:
 *
 *   - exactly one `<antrules-decision>(none|write|update)</antrules-decision>`
 *   - a `<reply>...</reply>` of ≥10 characters somewhere in the response
 *
 * Missing tag / out-of-range value / short justification → retryable
 * violation. The LLM's existing `_failedAttempts` retry budget caps the
 * recovery loop (silent skip is replaced by a bounded, explicit failure).
 */

import type { ArchitectGraphState, Violation } from '../../../state';
import { isVerificationTask } from '../../verification/model/is';

const MIN_JUSTIFICATION_CHARS = 10;
const VALID_DECISION_VALUES = new Set(['none', 'write', 'update']);

/**
 * Best-effort textual snapshot of the most recent LLM response. Verify-mode
 * tasks emit the decision through `<reply>` + `<antrules-decision>` in the
 * same execute turn that closes with `<done>true</done>`, so the gate runs
 * on `state.rawResponse` (full streamed buffer for the turn) with a
 * `llmResponse.textResponse` fallback for tool-call-only turns where
 * rawResponse may be empty.
 */
function responseTextOf(state: ArchitectGraphState): string {
  return (state.rawResponse || state.llmResponse?.textResponse || '').trim();
}

function extractDecisionValue(text: string): string | undefined {
  const m = text.match(/<antrules-decision>\s*([a-z]+)\s*<\/antrules-decision>/i);
  return m ? m[1].toLowerCase() : undefined;
}

function extractReplyBodies(text: string): string[] {
  const re = /<reply>([\s\S]*?)<\/reply>/gi;
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    bodies.push(m[1].trim());
  }
  return bodies;
}

export async function antrulesDecisionCheck(
  state: ArchitectGraphState,
): Promise<Violation | null> {
  // Activation gate — Tier 3/4 dedicated verification task only.
  if (!isVerificationTask(state.currentTask)) return null;
  // Only evaluate at task close (LLM emitted <done>true</done>).
  if (state.llmResponse?.done !== true) return null;

  const text = responseTextOf(state);
  if (!text) return null;

  const decision = extractDecisionValue(text);
  if (!decision) {
    return {
      type: 'other',
      message:
        'Verification turn closed without `<antrules-decision>`. ' +
        'Tier 3/4 final verification MUST emit exactly one ' +
        '`<antrules-decision>none|write|update</antrules-decision>` ' +
        'followed by a `<reply>` justification of at least ' +
        `${MIN_JUSTIFICATION_CHARS} characters before \`<done>true</done>\`. ` +
        'Re-emit the decision tag (see verification rules.md → ' +
        '"Mandatory decision emit before <done>true</done>").',
      isRetryable: true,
    };
  }
  if (!VALID_DECISION_VALUES.has(decision)) {
    return {
      type: 'other',
      message:
        `Invalid \`<antrules-decision>\` value "${decision}". ` +
        'Allowed values are exactly: `none`, `write`, `update`. ' +
        'Re-emit with one of these values.',
      isRetryable: true,
    };
  }

  const replies = extractReplyBodies(text);
  const longestReply = replies.reduce(
    (max, body) => Math.max(max, body.length),
    0,
  );
  if (longestReply < MIN_JUSTIFICATION_CHARS) {
    return {
      type: 'other',
      message:
        `Verification turn closed with \`<antrules-decision>${decision}</antrules-decision>\` ` +
        `but no accompanying justification of ≥${MIN_JUSTIFICATION_CHARS} characters. ` +
        'Emit a `<reply>` body that explains *why* every candidate failed ' +
        'the 3-condition filter (for `none`) or summarizes the recorded ' +
        'entry (for `write` / `update`).',
      isRetryable: true,
    };
  }

  return null;
}
