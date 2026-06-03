/**
 * feature/hooks/execute.ts — TaskExecuteHook.extraTemplateVars
 *
 * Publishes `requiresAttestation` for contract-consumer feature tasks so the
 * default execute template renders the pre-`<done>` contract attestation gate
 * (`jobs/code/nodes/execute/injections/attestation`).
 *
 * Scope (consumer, not author): ordinary feature (band undefined) and
 * integration feature (band 'integration') consume cross-package contracts and
 * attest. Foundation / platform features author the shared surfaces others
 * consume → excluded.
 *
 * This is DESIGN-conformance (read-before-bind self-check), orthogonal to
 * PHYSICAL verification (build/typecheck/test). For a Tier-2 self-verify
 * feature it runs in the APPLY phase only; `activeExecuteHook` swaps to the
 * shared verify hook (no `requiresAttestation`) once `_verifyEntered` flips,
 * so attest and physical never collide in one phase.
 *
 * R1/R2 — task-type+band branching lives here (the bundle hook, the sanctioned
 * home), never in phase nodes. `band` is type-bound to FeatureTask; mirror the
 * narrowing used by `hooks/scheduling.ts::classify`.
 */

import type { ExecutePromptCtx } from '../../_shared/types';

export function extraTemplateVars({ task }: ExecutePromptCtx): Record<string, unknown> {
  const band = task.type === 'feature' ? task.band : undefined;
  return { requiresAttestation: band === undefined || band === 'integration' };
}
