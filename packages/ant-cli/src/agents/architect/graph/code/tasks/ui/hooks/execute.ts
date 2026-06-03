/**
 * ui/hooks/execute.ts — TaskExecuteHook.extraTemplateVars
 *
 * UI tasks are contract consumers (they bind to components, design tokens, and
 * shared types), so they always attest before `<done>`. `ui` has no band axis.
 * Publishes `requiresAttestation: true` so the default execute template renders
 * the pre-`<done>` contract attestation gate
 * (`jobs/code/nodes/execute/injections/attestation`).
 *
 * Design-conformance only — orthogonal to physical build/typecheck/test
 * (owned by the verification task / Tier-2 self-verify reverify). For a Tier-2
 * self-verify ui task this runs in the APPLY phase; the shared verify hook
 * (no `requiresAttestation`) takes over once `_verifyEntered` flips.
 *
 * R1/R2 — lives in the bundle hook, not in phase nodes.
 */

import type { ExecutePromptCtx } from '../../_shared/types';

export function extraTemplateVars(_ctx: ExecutePromptCtx): Record<string, unknown> {
  return { requiresAttestation: true };
}
