/**
 * `_shared/verify/checkRetryTermination` — TaskPlanHook.checkRetryTermination
 * shared by every verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/plan.ts::checkRetryTermination`.
 * Moved here so verify-mode self-verify tasks share the same
 * no-progress termination semantics as Tier 3/4 verification tasks.
 *
 * R2 — depends only on `_shared/verify/Session` + `errors`.
 */

import type { ArchitectGraphState } from '../../../state';
import { VerificationTerminalError } from './errors';

/** Trailing identical-plan count that marks the LLM as stuck. */
const NO_PROGRESS_STREAK = 2;

/**
 * Verification's retry terminator. Returns `no_progress` when the just-failed
 * plan matches the trailing plan-history streak; `null` continues the loop.
 * Runaway is bounded by `state.recursionLimit` at the routing layer.
 *
 * Empty-plan coverage: `state.planText === ''` is a legitimate input here.
 * The plan-phase LLM sometimes emits `<done>true</done>` with no `<plan>`
 * block mid-retry — a protocol-violation "silent give-up" that used to
 * evade termination because the old `!state.planText` early-return bailed
 * out before the hash comparison. Empty strings now flow through
 * `isPlanRepeated` and hash to a stable value, so two consecutive empties
 * register as a repeated-plan streak and throw `no_progress` through the
 * same channel that catches verbatim repeated plans.
 */
export function checkRetryTermination(
  state: ArchitectGraphState,
): VerificationTerminalError | null {
  const session = state.verification;
  if (!session) return null;

  const repeat = session.isPlanRepeated(state.planText ?? '');
  if (repeat.count >= NO_PROGRESS_STREAK) {
    const planDesc = state.planText ? `the same plan` : `an empty plan`;
    return new VerificationTerminalError(
      'no_progress',
      `Task "${state.currentTask?.name ?? 'verification'}" stuck: the LLM produced ${planDesc} ${repeat.count} times in a row.`,
      session.snapshot(),
    );
  }
  return null;
}
