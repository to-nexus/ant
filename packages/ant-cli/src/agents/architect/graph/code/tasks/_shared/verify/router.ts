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
import { requiresVerification } from './predicate';

/**
 * Verify-mode `routeAfterDone`. Used by every task that owns a
 * verification cycle (verification task type AND self-verify Tier 2
 * tasks).
 */
export function routeAfterDone(state: ArchitectGraphState): string | null {
  const hasPlan = !!state.planText?.trim();
  const madeFileChanges = state._executeModifiedFiles === true;
  const session = state.verification;

  // Self-verify Tier 2 task's FIRST verify entry — Session not yet
  // created. The apply phase emitted `<done>` regardless of whether
  // files were modified (the LLM may have decided "no fix needed"
  // without actually running gates). To enforce the silent-bug guard
  // (`onyx-building-fence` incident), always route to plan so the
  // reverify entry path fires `initSession` and the verify cycle runs
  // gates at least once. `hasPlan` / `madeFileChanges` checks below
  // apply only on subsequent verify cycles where the Session already
  // exists.
  if (!session && requiresVerification(state.currentTask)) {
    return 'plan';
  }

  // Empty plan means the diagnostic phase found nothing to change. Route
  // to checkTaskStatus so the session / tracker can confirm whether the
  // gate set is actually satisfied.
  if (!hasPlan) return 'checkTaskStatus';

  // Plan exists but execute made no file changes — nothing was applied,
  // so reverifying would just loop. Let checkTaskStatus adjudicate.
  if (!madeFileChanges) return 'checkTaskStatus';

  // All gates already passing — skip reverify.
  if (session?.isComplete()) return 'checkTaskStatus';

  // Applied fixes + unsatisfied gates → reverify.
  return 'plan';
}
