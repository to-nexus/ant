/**
 * verification/hooks/router.ts — TaskRouterHook.routeAfterDone
 *
 * Factors the verification-specific branch out of `executeRouter`. The
 * router itself stays a pure predicate (no state mutation beyond the
 * `_nextPlanEntry='reverify'` signal it flips when this hook returns
 * `'plan'`): it asks the hook whether to reverify and translates the
 * answer into a node name.
 *
 * Summary of what this hook replaces:
 *   - `executeRouter.routeAfterExecute` L173~209 (verification-done branching)
 *
 * An earlier draft also published `shortCircuitAfterPlan` for
 * `planRouter` to consult, but the plan node already flips
 * `llmResponse.done = true` on its own short-circuit paths (batch split,
 * diagnostic pass, empty implementation) so `routeAfterPlan` stays blind
 * to task type and reads the flag directly. The slot was retired in the
 * T11 post-review as dead surface; the hook now owns a single
 * responsibility.
 */

import type { ArchitectGraphState } from '../../../state';

/**
 * Execute-router decision for verification tasks when the LLM signals
 * `<done>`. Returns:
 *   - `'checkTaskStatus'`  — verify completion and either finish or
 *                            surface a `verification_incomplete` violation
 *   - `'plan'`             — re-enter the plan phase for reverify so the
 *                            diagnostic loop can re-confirm gate state
 *   - `null`               — hook declines to decide; router continues
 *                            with its default logic
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
