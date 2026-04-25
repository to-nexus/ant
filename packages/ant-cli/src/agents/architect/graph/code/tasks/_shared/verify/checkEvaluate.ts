/**
 * `_shared/verify/checkEvaluate` — TaskCheckHook.evaluate +
 * `budgetExhaustedHint` shared by every verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/check.ts`. Moved here so
 * self-verify Tier 2 tasks emit the same `verification_incomplete`
 * violation as Tier 3/4 verification tasks when they signal `<done>`
 * with unsatisfied gates.
 *
 * R1 — encapsulates verification-completion judgement; the phase layer
 * stays blind. R2 — depends only on `_shared/verify/gates`.
 */

import type { ArchitectGraphState } from '../../../state';
import type { Violation, ViolationType } from '../../../state';
import { getMissingStepDetail } from './gates';

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
 * Hint rendered on the `budget_exhausted` violation (execute call loop)
 * for any task in verify-mode. Consumed by `checkTaskStatus/evaluate.ts`.
 */
export const budgetExhaustedHint =
  'Verification task did not complete — build may have failed. Retry pending.';

/**
 * Evaluate verify-mode completion. Returns `verification_incomplete`
 * violation when the task signalled `<done>` with one or more required
 * gates still missing. Returns `null` when complete (or session not yet
 * initialised — defensive guard for the "non-verification task" edge).
 */
export function evaluate(state: ArchitectGraphState): Violation | null {
  const session = state.verification;
  // No session → either a non-verification task (not our concern) or a
  // verification-mode task whose plan hook hasn't fired yet (shouldn't
  // happen post-T4b-β; we still guard defensively).
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
