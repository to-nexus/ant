/**
 * Shared auth types — single source of truth for the BE↔FE auth contract
 * consumed by both ant-site and ant-ui.
 */

/**
 * Org kind discriminator. MUST stay in lockstep with `@ant/shared`
 * `OrganizationKind` — mirrored locally because this package is standalone
 * (no `@ant/shared` dependency; consumed by ant-site too).
 */
export type OrgKind = 'local' | 'individual' | 'team';

/**
 * Org-internal role ladder. MUST stay in lockstep with `@ant/shared`
 * `OrgMembershipRole` (mirrored — no `@ant/shared` dep here).
 */
export type OrgRole = 'owner' | 'admin' | 'member';

/** One org the user belongs to (account switcher / `/auth/me` envelope). */
export interface OrgMembership {
  organizationId: string;
  kind: OrgKind;
  name: string;
  role: OrgRole;
}

/** Actionable pending invite riding on `/auth/me` (Phase 1). */
export interface PendingInvite {
  id: string;
  token: string;
  organizationId: string;
  organizationName: string;
  role: 'admin' | 'member';
  invitedBy: string;
  expiresAt: string;
}

/** Verified-domain one-click join candidate riding on `/auth/me` (Phase 1). */
export interface DomainJoinableOrg {
  organizationId: string;
  organizationName: string;
  domain: string;
  autoJoinRole: 'admin' | 'member';
}

/**
 * Cloud account approval state. MUST stay in lockstep with `@ant/shared`
 * `ApprovalStatus` — mirrored locally (this package has no `@ant/shared` dep).
 */
export type AuthApprovalStatus = 'pending' | 'approved' | 'denied';

export interface AuthUser {
  email: string;
  userId: string;
  organization: string;
  /** Active org kind. Optional — absent from pre-kind servers. */
  orgKind?: OrgKind;
  name?: string;
  picture?: string;
  /** Cloud approval state. Absent from legacy servers ⇒ treat as `approved`. */
  approvalStatus?: AuthApprovalStatus;
  /** Super-admin flag (env-authoritative on the server). Absent ⇒ false. */
  isAdmin?: boolean;
  /** Test-account level (0 = normal, ≥1 = test-payment enabled). Absent ⇒ 0. */
  testAccountLevel?: number;
}

/**
 * Discriminated outcome of `/auth/me`. Each branch maps to a distinct
 * deployment misconfiguration so the caller can surface a precise hint.
 * `kind: 'user'` is the only success state.
 *
 *   kind=user           → signed-in user payload (carries onboarding flags too)
 *   kind=no-session     → cookie absent or invalid (200 + {user: null})
 *   kind=misconfigured  → backend returned 503 (ANT_JWT_SECRET unset)
 *   kind=http-error     → any other non-2xx
 *   kind=network        → fetch threw (CORS, offline, abort)
 *   kind=shape          → 200 but body shape unrecognised
 *
 * `needsOnboarding` / `suggestedOrganizationName` ride on the success
 * branch — they describe the user (the `_pending` sentinel state) and
 * are meaningless when there's no session.
 */
export type AuthMeResult =
  | {
      kind: 'user';
      user: AuthUser;
      /** Active org context. `null` from pre-envelope servers. */
      activeOrg: { id: string; kind: OrgKind; name: string } | null;
      /** All orgs the user belongs to (length 1 = individual-only today). */
      memberships: OrgMembership[];
      /** Pending invites addressed to this email (Phase 1; [] from older servers). */
      pendingInvites: PendingInvite[];
      /** Verified-domain join candidates (Phase 1; [] from older servers). */
      domainJoinableOrgs: DomainJoinableOrg[];
      needsOnboarding: boolean;
      suggestedOrganizationName: string | null;
    }
  | { kind: 'no-session' }
  | { kind: 'misconfigured' }
  | { kind: 'http-error'; status: number }
  | { kind: 'network'; message: string }
  | { kind: 'shape'; raw: unknown };

/**
 * Cross-tab auth message envelope. Posted on `BroadcastChannel('ant-auth')`
 * (or the localStorage `storage`-event fallback). Receivers should NOT
 * re-broadcast — the bridge is one-way to avoid feedback loops.
 *
 *   logout           → user-initiated logout in another tab
 *   session-expired  → 401 detected (server cookie invalid / expired)
 */
export type AuthBroadcastMessage =
  | { type: 'logout'; at: number }
  | { type: 'session-expired'; at: number };

export const AUTH_BROADCAST_CHANNEL = 'ant-auth';
