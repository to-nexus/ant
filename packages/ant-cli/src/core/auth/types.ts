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
  /** Role granted on one-click domain join. */
  autoJoinRole: OrgInviteRole;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: OrgDomainVerifiedBy;
}
