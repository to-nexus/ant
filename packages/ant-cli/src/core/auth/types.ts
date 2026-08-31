/**
 * Auth domain types — mirror the SQL schema from the Phase 3 plan so a
 * future migration from Redis to Postgres preserves shape.
 *
 *   table organizations  → Organization
 *   table memberships    → Membership
 *
 * `ownerId === null` is the current "owner-less" model (Future-A
 * migration may flip it NOT NULL later — keep the optional field for
 * forward compatibility now).
 */

import type {
  OrganizationKind,
  ApprovalStatus,
  OrgMembershipRole,
  OrgInviteRole,
  OrgInviteStatus,
  OrgDomainClaimStatus,
  OrgDomainVerifiedBy,
  OrgJoinRequestStatus,
  OrgMemberRemovalReason,
} from '@ant/shared';

export interface Organization {
  /** Slugified organization id — primary key. */
  id: string;
  /** Original user-supplied display name (preserves casing/whitespace). */
  name: string;
  /**
   * Org kind discriminator. Optional for forward/backward compatibility with
   * records written before the kind axis existed — readers fall back to
   * `deriveKindFromOrgId(id)`.
   */
  kind?: OrganizationKind;
  /** Owner user id — null in the pre-team "free join" model; required for teams. */
  ownerId: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /**
   * Listed in organization search so non-members can find it and request to
   * join. `undefined` ⇒ NOT discoverable — search visibility is opt-in.
   */
  discoverable?: boolean;
  /** Soft-delete marker (superadmin force-delete / sole-owner delete). */
  deletedAt?: string;
}

/** 3-role ladder — the wire type in `@ant/shared/orgTeam.ts` is the SSOT. */
export type MembershipRole = OrgMembershipRole;

export interface Membership {
  userId: string;
  organizationId: string;
  role: MembershipRole;
  createdAt: string;
}

/**
 * User record stored alongside organizations — keyed by stable userId
 * (Google OAuth `sub`). The `currentOrganizationId` field is denormalised
 * for fast JWT issuance; the authoritative org list comes from the
 * memberships index.
 */
export interface UserRecord {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  /** Org the user is currently active in (matches JWT `org` claim). */
  currentOrganizationId: string | null;
  createdAt: string;
  /**
   * Cloud account approval ("verification") state. `undefined` ⇒ legacy /
   * unmanaged, treated as `approved` (never retroactively pended). Set at signup
   * from the global default policy and mutated by admins. OSS/local ignore it.
   */
  approvalStatus?: ApprovalStatus;
  /** ISO-8601 of last approval change. */
  approvedAt?: string;
  /** Admin email that last set the approval state. */
  approvedBy?: string;
  /** Projection of `ANT_SUPER_ADMIN_EMAILS` (env is authoritative for gating). */
  isSuperAdmin?: boolean;
  /** 0/undefined = normal; ≥1 = test-payment enabled (2/3 reserved). */
  testAccountLevel?: number;
  /**
   * Last domain auto-join granted at login. Exists only so `/auth/me` can
   * tell an EXISTING account it was backfilled into a team (a brand-new
   * account lands in the team as its active org and needs no notice). Never
   * an authority for membership — the membership row is.
   */
  lastDomainAutoJoin?: {
    organizationId: string;
    domain: string;
    at: string;
  };
}

/**
 * Team invitation — storage shape (Redis `ant:auth:invite:{id}`), kept
 * PG-ready. Expiry is judged lazily on read (`expiresAt` vs now); the stored
 * `status` never becomes `'expired'` on disk.
 */
export interface Invitation {
  id: string;
  organizationId: string;
  /** Invitee email, lowercased. Acceptance enforces exact match. */
  email: string;
  role: OrgInviteRole;
  /** Inviter userId (= email in cloud). */
  invitedBy: string;
  /** Unguessable acceptance token (deep link `/app/?invite={token}`). */
  token: string;
  status: Exclude<OrgInviteStatus, 'expired'>;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/**
 * Org email-domain claim — storage shape (Redis `ant:auth:domain:{domain}`),
 * PG-ready. `domain` is the PK and globally unique: one org per domain.
 */
export interface OrgDomainClaim {
  /** Lowercased email domain (e.g. `acme.com`) — global PK. */
  domain: string;
  organizationId: string;
  /** Claiming admin's userId. */
  claimedBy: string;
  /** DNS TXT challenge token (`_ant-challenge.{domain}`). */
  verificationToken: string;
  status: OrgDomainClaimStatus;
  /**
   * Grant membership at login to every account on this domain. `undefined`
   * ⇒ ON: claims written before the toggle existed keep auto-joining, so no
   * migration is needed. Read it as `autoJoin !== false`.
   */
  autoJoin?: boolean;
  /** Role granted on domain join (auto at login, or the one-click banner). */
  autoJoinRole: OrgInviteRole;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: OrgDomainVerifiedBy;
}

/**
 * Request to join a discoverable org — storage shape (Redis
 * `ant:auth:joinreq:{id}`), PG-ready. Expiry is judged lazily on read
 * (`expiresAt` vs now); the stored `status` never becomes `'expired'`.
 */
export interface OrgJoinRequest {
  id: string;
  organizationId: string;
  /** Requester userId (= email in cloud). */
  userId: string;
  /** Requester email, lowercased. */
  email: string;
  /** Optional free-text note to the org admins, capped at authoring time. */
  message?: string;
  status: Exclude<OrgJoinRequestStatus, 'expired'>;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  /** Admin userId that approved / rejected it. */
  decidedBy?: string;
}

/**
 * A member who left or was removed — storage shape (Redis hash
 * `ant:auth:org:removed:{orgId}`, field = userId). Suppresses the domain
 * shortcut so a removal survives the member's next login. Cleared by an
 * explicit re-admission: invite accepted, join request approved, or an admin
 * clearing the row.
 */
export interface OrgMemberRemoval {
  organizationId: string;
  userId: string;
  email: string;
  reason: OrgMemberRemovalReason;
  removedAt: string;
  /** Admin userId for `removed`; the member's own userId for `left`. */
  removedBy: string;
}
