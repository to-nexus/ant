import { GENERAL_INTENT } from '@ant/shared';

/**
 * Continuation pins from a `plan_complete` card payload: the plan turn's
 * intent minus `general` (a default-resolved id IS kept — pinning it
 * freezes the plan's actual intent against later catalog edits; `general`
 * pins nothing so the follow-up re-resolves explicit → default → general
 * deterministically), and the plan docs as `@ctx` context.
 *
 * A run binds at most ONE intent, and this table also feeds the
 * selector-bypassing `handleProceed` post — so the cap is enforced here
 * (pre-cutover cards may still carry several ids; the first survives).
 *
 * Leaf module (no store/http imports) so the pin table stays unit-testable
 * in a node environment.
 */
export function planContinuationPins(payload: { intents?: unknown; planFiles?: unknown }): {
  intents: string[] | undefined;
  context: string[] | undefined;
} {
  const intents = (Array.isArray(payload.intents) ? payload.intents : [])
    .filter((i): i is string => typeof i === 'string')
    .filter((i) => i !== GENERAL_INTENT)
    .slice(0, 1);
  const context = (Array.isArray(payload.planFiles) ? payload.planFiles : [])
    .filter((p): p is string => typeof p === 'string');
  return {
    intents: intents.length ? intents : undefined,
    context: context.length ? context : undefined,
  };
}
