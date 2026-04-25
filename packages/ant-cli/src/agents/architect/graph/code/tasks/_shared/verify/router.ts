/**
 * `_shared/verify/router` — TaskRouterHook.routeAfterDone shared by every
 * verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/router.ts`. Moved here so
 * self-verify Tier 2 tasks share the same `<done>` routing semantics as
 * Tier 3/4 verification tasks once they enter verify-mode.
 *
 * Returns:
 *   - `'checkTaskStatus'`  — verify completion and either finish or
 *                            surface a `verification_incomplete` violation
 *   - `'plan'`             — re-enter the plan phase for reverify so the
 *                            diagnostic loop can re-confirm gate state
 *   - `null`               — hook declines to decide; router continues
 *                            with its default logic
 *
 * R2 — depends only on the graph state shape.
 */

import type { ArchitectGraphState } from '../../../state';

/**
 * Verify-mode `routeAfterDone`. Used by every task that owns a
 * verification cycle (verification task type AND self-verify Tier 2
 * tasks) once `state._verifyEntered === true`.
 */
export function routeAfterDone(state: ArchitectGraphState): string | null {
  const hasPlan = !!state.planText?.trim();
  const madeFileChanges = state._executeModifiedFiles === true;

  // Empty plan means the diagnostic phase found nothing to change. Route
  // to checkTaskStatus so the session / tracker can confirm whether the
  // gate set is actually satisfied.
  if (!hasPlan) return 'checkTaskStatus';

  // Plan exists but execute made no file changes — nothing was applied,
  // so reverifying would just loop. Let checkTaskStatus adjudicate.
  if (!madeFileChanges) return 'checkTaskStatus';

  // All gates already passing — skip reverify.
  const session = state.verification;
  if (session?.isComplete()) return 'checkTaskStatus';

  // Applied fixes + unsatisfied gates → reverify.
  return 'plan';
}
