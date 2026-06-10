/**
 * Organization model — kind axis (SSOT shared across BE↔FE)
 *
 * `org` is the umbrella layer term. Every organization carries a `kind`
 * discriminator that drives all kind-specific divergence:
 *
 *   - `local`      — the single local-mode tenant (`local:local`).
 *   - `individual` — ONE shared org (id literally `'individual'`) that every
 *                    cloud signup joins today. User identity inside it is the
 *                    full lowercased email (collision-free in a shared org).
 *   - `team`       — future cloud organization subscriber (admin/join flow
 *                    deferred). The current domain-based org becomes this.
 *
 * A single user identity (OAuth sub / email) is independent of the active
 * org: membership is many-to-many and the active org is a context switch,
 * never a separate registration.
 */

export type OrganizationKind = 'local' | 'individual' | 'team';

/** The shared individual org id — every cloud signup joins this today. */
export const INDIVIDUAL_ORG_ID = 'individual';
/** The fixed local-mode tenant org id. */
export const LOCAL_ORG_ID = 'local';
/** The fixed local-mode user id. */
export const LOCAL_USER_ID = 'local';

/**
 * Derive an org's kind from its id alone — the safety-net classifier used
 * when a JWT predates the explicit `kind` claim.
 *
 * `personal-*` is the legacy per-user consumer org prefix; map it to
 * `individual` for backward compatibility so a stale token does not get
 * misrouted as `team`.
 */
export function deriveKindFromOrgId(orgId: string): OrganizationKind {
  if (orgId === LOCAL_ORG_ID) return 'local';
  if (orgId === INDIVIDUAL_ORG_ID) return 'individual';
  if (orgId.startsWith('personal-')) return 'individual';
  return 'team';
}

export function isIndividualKind(kind: OrganizationKind | undefined): boolean {
  return kind === 'individual';
}
export function isTeamKind(kind: OrganizationKind | undefined): boolean {
  return kind === 'team';
}
export function isLocalKind(kind: OrganizationKind | undefined): boolean {
  return kind === 'local';
}
