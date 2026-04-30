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
 *
 * Decision tree (post-`urban-fronting-faith` simplification):
 *   1. No Session yet (Tier-2 self-verify first verify) → plan (initSession
 *      runs on the reverify entry path; silent-bug guard).
 *   2. Empty planText → checkTaskStatus (diagnostic phase found nothing
 *      actionable; let session adjudicate).
 *   3. Session reports `isComplete()` → checkTaskStatus (every required
 *      gate passed; nothing to reverify).
 *   4. Otherwise → plan (re-diagnose the unsatisfied gates).
 *
 * The retired `madeFileChanges = state._executeModifiedFiles === true`
 * branch used to short-circuit step 4 to checkTaskStatus when execute
 * applied no new files. That signal was redundant with case 3 plus
 * `checkRetryTermination`'s `isPlanRepeated` → `no_progress` termination
 * (a "fix nothing → done" cycle yields the same plan twice and trips the
 * plan-hash repeat detector). It also caused a hard regression: every
 * retry/reverify entry handler reset `_executeModifiedFiles = false`, so
 * the moment a verification cycle entered retry the next `<done>` always
 * routed to checkTaskStatus instead of plan, trapping verification in a
 * checkTaskStatus → retry loop. Removing the branch lifts the lockout
 * while leaving termination guarantees intact (recursionLimit + Safety
 * Net C + plan-hash repeat).
 */
export function routeAfterDone(state: ArchitectGraphState): string | null {
  const hasPlan = !!state.planText?.trim();
  const session = state.verification;

  // Step 1: Self-verify Tier 2 task's FIRST verify entry — Session not yet
  // created. The apply phase emitted `<done>` regardless of whether files
  // were modified (the LLM may have decided "no fix needed" without
  // actually running gates). To enforce the silent-bug guard
  // (`onyx-building-fence` incident), always route to plan so the
  // reverify entry path fires `initSession` and the verify cycle runs
  // gates at least once.
  if (!session && requiresVerification(state.currentTask)) {
    return 'plan';
  }

  // Step 2: Empty plan means the diagnostic phase found nothing to change.
  // Route to checkTaskStatus so the session / tracker can confirm whether
  // the gate set is actually satisfied.
  if (!hasPlan) return 'checkTaskStatus';

  // Step 3: All required gates already passing → skip reverify.
  if (session?.isComplete()) return 'checkTaskStatus';

  // Step 4: Plan present and gates not complete → reverify. If the LLM
  // applied no actual fix this cycle, plan will re-emit the same plan and
  // `checkRetryTermination`'s `isPlanRepeated` → `no_progress` will fire
  // after 2 consecutive identical plans (empty plans hash to a stable
  // value, so "give-up" cycles also terminate cleanly).
  return 'plan';
}
