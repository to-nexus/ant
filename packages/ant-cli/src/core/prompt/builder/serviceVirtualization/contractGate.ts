/**
 * service-virtualization-contract activation gate (SBS SSOT).
 *
 * The `service-virtualization-contract` partial fires for every generative
 * service-domain code task unless the user opted out (§4 default-ON). The
 * gate axis is:
 *
 *   domain==='service' ∧ ¬optedOut
 *
 * `domain` is the workspace selector (call sites coerce undefined→service via
 * `getEffectiveDomain`); `optedOut` is the decompose `<serviceVirtualization>`
 * decision on `state.resolvedAction.basis.serviceVirtualization`. The partial
 * self-scopes ("every external-dependency port…"), so a project with no
 * external dependency yields no extra content even with the gate open.
 *
 * Companions:
 *   - `service-virtualization-data`    (FAKE body realism — non-image data)
 *   - `service-virtualization-imagery` (image subtype dispatch)
 *
 * See `AGENTS.md` "Service Virtualization prompt SSOTs (MECE)" and
 * the `mock_real_symmetry_ssot` plan §0 for the umbrella naming policy.
 */

export interface ServiceVirtualizationContractGateInput {
  /** Workspace domain (coerced undefined→service by `getEffectiveDomain`). */
  domain: string | undefined;
  /** Decompose `<serviceVirtualization>` opt-out (real-backend-only). */
  optedOut: boolean;
}

/**
 * @returns `true` for a generative service-domain task that did not opt out —
 *          the contract body then enforces side-by-side adapters + toggle.
 */
export function isServiceVirtualizationContractActive(
  input: ServiceVirtualizationContractGateInput,
): boolean {
  return input.domain === 'service' && input.optedOut !== true;
}
