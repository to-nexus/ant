/**
 * verification/hooks/router.ts — TaskRouterHook.shortCircuitAfterPlan /
 * TaskRouterHook.routeAfterDone
 *
 * Factors the verification-specific branches out of `planRouter` and
 * `executeRouter`. The routers themselves stay pure predicates after T6
 * (no state mutation): they ask the hook whether to short-circuit and
 * whether to reverify, and translate the answer into a node name.
 *
 * Summary of what these hooks replace:
 *   - `planRouter.routeAfterPlan` L57~63 (isDiagnostic + hasEmptyImplementation)
 *   - `executeRouter.routeAfterExecute` L173~209 (verification-done branching)
 *
 * Neither hook mutates state; any `_nextPlanEntry` / `violations` reset that
 * the legacy router does today is moved to the plan/execute phase nodes'
 * hook call in T6 (a mutation of the mutating hook, not the router).
 */

import type { ArchitectGraphState } from '../../../state';

function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  return m ? m[1].trim() : trimmed;
}

/**
 * Literal "implementation contains no modify/create/delete entries and no
 * batches" detector. Kept local so the hook has no cross-phase imports.
 */
function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripFences(planText);
  if (!body.length) return false;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    return false;
  }
}

/**
 * Return true when the plan router should bypass `execute` and route
 * straight to `checkTaskStatus`. Fires when either (a) the session
 * already considers every required gate passed, or (b) the plan is
 * structurally empty — running execute on an empty plan would burn
 * budget without producing any file changes.
 *
 * Note — `hasEmptyImplementation` is intentionally not replaced by
 * `session.evaluate({ planText })`. Although `Session.evaluate` also
 * returns `short_circuit.empty_plan` for empty bodies, the two helpers
 * disagree on the degenerate "empty string planText" case
 * (`hasEmptyImplementation('') === false`, `isEmptyPlanBody('') === true`).
 * Preserving the legacy `hasEmptyImplementation` semantics keeps behavior
 * parity with the pre-hook router; aligning the two is tracked as
 * follow-up work outside the T5 window.
 */
export function shortCircuitAfterPlan(state: ArchitectGraphState): boolean {
  const session = state.verification;
  if (session?.isComplete()) return true;

  return hasEmptyImplementation(state.planText);
}

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
