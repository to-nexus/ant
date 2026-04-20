/**
 * verification/hooks/check.ts — TaskCheckHook.evaluate
 *
 * Produces the `verification_incomplete` violation that the `check_task_status`
 * node currently synthesises via `evaluateVerificationCompletion` from
 * `utils/verificationCompleteness.ts`. This hook is the future single entry
 * point; during T5 coexistence the legacy path still runs and this hook is
 * only exercised from tests.
 *
 * Routing:
 *   - If `state.verification` exists, consult the session (preferred).
 *   - Else fall back to the legacy tracker so the hook remains callable in
 *     scenarios that have not yet been migrated to populate the session.
 *
 * R1 — encapsulates verification-specific completion judgement; the
 * `check_task_status` phase will delegate here in T6.
 * R2 — depends only on `model/` (Session, gates) and `utils/verificationCompleteness`
 * (a pure helper that will survive T5 as a temporary bridge).
 */

import type { ArchitectGraphState, Violation, ViolationType } from '../../../state';
import { getMissingStepDetail } from '../model/gates';
import { evaluateVerificationCompletion } from '../../../utils/verificationCompleteness';

/**
 * Compose the snippet of the last failed command's error output when
 * available. Keeps the phrasing identical to the legacy helper so the
 * prompt surface does not drift when T6 swaps over.
 */
function composeErrorDetail(state: ArchitectGraphState): string {
  const history = state.commandHistory || [];
  const lastFailed = [...history].reverse().find(h => !h.success);
  if (!lastFailed?.errorSnippet) return '';
  return `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`;
}

/**
 * Verification-specific retry hint rendered on the budget-exhausted
 * violation. Replaces the legacy `taskType === 'verification'` branch
 * previously inlined in `graph.ts` L120 / `workerGraph.ts` L156.
 */
export const budgetExhaustedHint =
  'Verification task did not complete — build may have failed. Will retry with remaining budget.';

export function evaluate(state: ArchitectGraphState): Violation | null {
  const session = state.verification;

  if (session) {
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

  // Legacy bridge: session not populated yet — re-use the existing helper
  // so the hook produces the same violation the main graph does today.
  return evaluateVerificationCompletion({
    tracker: state._verificationTracker,
    commandHistory: state.commandHistory,
    logPrefix: 'verification.check.evaluate',
  });
}
