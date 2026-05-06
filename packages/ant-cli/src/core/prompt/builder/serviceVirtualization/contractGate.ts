/**
 * service-virtualization-contract activation gate (SBS SSOT).
 *
 * The `service-virtualization-contract` partial fires when the project has
 * at least one `business` `@connection` (= every external dependency that
 * MUST be reachable through a port whose production and virtualized
 * adapters share the same interface). The single gate axis is:
 *
 *   hasBusinessConnection
 *
 * `hasBusinessConnection` is derived once from the workspace by `resolve`
 * and parked on `state.virtualizationSnapshot.hasBusinessConnection` so all
 * downstream phases share one snapshot.
 *
 * Companions:
 *   - `service-virtualization-data`    (FAKE body realism — non-image data)
 *   - `service-virtualization-imagery` (image subtype dispatch)
 *
 * See `.cursorrules` "Service Virtualization prompt SSOTs (MECE)" and
 * the `mock_real_symmetry_ssot` plan §0 for the umbrella naming policy.
 */

export interface ServiceVirtualizationContractGateInput {
  /** True when the codebase declares at least one `business` connection. */
  hasBusinessConnection: boolean;
}

/**
 * @returns `true` iff a business-connection-bearing port exists for which
 *          the contract body must enforce side-by-side adapters + toggle.
 */
export function isServiceVirtualizationContractActive(
  input: ServiceVirtualizationContractGateInput,
): boolean {
  return input.hasBusinessConnection === true;
}
