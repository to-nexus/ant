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
 *
 * The retry plan reads the last failed command from NODE_PLAN conversation
 * history (the `run_command` tool result is preserved in the LLM message
 * stream), so this violation message no longer duplicates the snippet.
 */
export function evaluate(state: ArchitectGraphState): Violation | null {
  const session = state.verification;
  if (!session) return null;
  if (session.isComplete()) return null;

  const missing = session.missing();
  const firstMissing = missing[0];
  const detail = getMissingStepDetail(firstMissing);
  return {
    type: 'verification_incomplete' as ViolationType,
    severity: 'critical',
    message: detail.message,
    isRetryable: true,
    suggestedFix: detail.fix,
  };
}
