/**
 * verification/hooks/check.ts — TaskCheckHook.evaluate
 *
 * Produces the `verification_incomplete` violation that
 * `nodes/checkTaskStatus/evaluate.ts` surfaces when a verification task
 * signalled `<done>` but one or more required gates still remain. The
 * sole input is `state.verification` — the check-task-status phase is
 * blind to verification internals.
 *
 * R1 — encapsulates verification-specific completion judgement.
 * R2 — depends only on `model/` (Session, gates).
 */

import type { ArchitectGraphState, Violation, ViolationType } from '../../../state';
import { getMissingStepDetail } from '../model/gates';

/**
 * Compose the snippet of the last failed command's error output when
 * available. Keeps the phrasing identical to the legacy helper so the
 * prompt surface does not drift.
 */
function composeErrorDetail(state: ArchitectGraphState): string {
  const history = state.commandHistory || [];
  const lastFailed = [...history].reverse().find(h => !h.success);
  if (!lastFailed?.errorSnippet) return '';
  return `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`;
}

/**
 * Verification-specific retry hint rendered on the budget-exhausted
 * violation. Consumed by `checkTaskStatus/evaluate.ts` when the Session
 * reports budget is exhausted but gates are still missing.
 */
export const budgetExhaustedHint =
  'Verification task did not complete — build may have failed. Will retry with remaining budget.';

export function evaluate(state: ArchitectGraphState): Violation | null {
  const session = state.verification;
  // No session → either a non-verification task (not our concern) or a
  // verification task whose plan hook hasn't fired yet (shouldn't happen
  // post-T4b-β; we still guard defensively).
  if (!session) return null;
  if (session.isComplete()) return null;

  const missing = session.missing();
  const firstMissing = missing[0];
  const detail = getMissingStepDetail(firstMissing);
  return {
    type: 'verification_incomplete' as ViolationType,
    severity: 'critical',
    message: detail.message + composeErrorDetail(state),
    isRetryable: true,
    suggestedFix: detail.fix,
  };
}
