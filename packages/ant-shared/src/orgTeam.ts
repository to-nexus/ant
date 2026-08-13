/**
 * Team-organization contract (BE ↔ FE) — Phase 1 of the org system.
 *
 * View projections, request bodies, and stable error codes for the
 * `/api/organizations/*` (teams) routes and the org sections of the
 * `/auth/me` envelope. OSS core: identical on self-hosted and managed
 * cloud deployments. Local mode never reaches these routes (single
 * `local:local` tenant — the FE renders no org surface for kind='local').
 *
 * Storage shapes (`Invitation`, `OrgDomainClaim`) live in ant-cli
 * `core/auth/types.ts`; everything here is the wire projection.
 */

import type { OrganizationKind } from './org';

/** Org-internal role ladder. `owner` is unique per team org. */
export type OrgMembershipRole = 'owner' | 'admin' | 'member';

/** Roles an invite can grant — ownership is only reachable via transfer. */
export type OrgInviteRole = 'admin' | 'member';

/** Stored invite lifecycle. `expired` is derived lazily from `expiresAt`. */
export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** Domain claim lifecycle. `rejected` is a superadmin verdict. */
export type OrgDomainClaimStatus = 'pending' | 'verified' | 'rejected';

/** How a domain claim got verified. */
export type OrgDomainVerifiedBy = 'email' | 'dns' | string; // superadmin email for manual verify

/** Invite validity window (days) — expiry is judged lazily on read. */
export const ORG_INVITE_TTL_DAYS = 14;

// ── View projections ────────────────────────────────────────────────────────

export interface OrgMemberView {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
  role: OrgMembershipRole;
  joinedAt: string;
}

/** Admin-side invite row. `token` is exposed only to admin+ callers. */
export interface OrgInviteView {
  id: string;
  organizationId: string;
  email: string;
  role: OrgInviteRole;
  invitedBy: string;
  status: OrgInviteStatus;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface OrgDomainClaimView {
  domain: string;
  organizationId: string;
  status: OrgDomainClaimStatus;
  autoJoinRole: OrgInviteRole;
  claimedBy: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: OrgDomainVerifiedBy;
  /** TXT record the claimant must create: `_ant-challenge.{domain}`. */
  txtRecordName: string;
  /** Challenge token — the TXT record value. Admin-only surface. */
  verificationToken: string;
}

/** Invitee-side projection carried on `/auth/me` (`pendingInvites`). */
export interface PendingInviteView {
  id: string;
  token: string;
  organizationId: string;
  organizationName: string;
  role: OrgInviteRole;
  invitedBy: string;
  expiresAt: string;
}

/** One-click domain join candidate carried on `/auth/me` (`domainJoinableOrgs`). */
export interface DomainJoinableOrgView {
  organizationId: string;
  organizationName: string;
  domain: string;
  autoJoinRole: OrgInviteRole;
}

export interface OrgSummaryView {
  id: string;
  name: string;
  kind: OrganizationKind;
  createdAt: string;
}

// ── Superadmin (admin dashboard) projections ────────────────────────────────

export interface AdminOrgSummary {
  id: string;
  name: string;
  kind: OrganizationKind;
  ownerId: string | null;
  memberCount: number;
  domainCount: number;
  createdAt: string;
  deletedAt?: string;
}

export interface AdminOrgDetail extends AdminOrgSummary {
  members: OrgMemberView[];
  invites: OrgInviteView[];
  domains: OrgDomainClaimView[];
}

// ── Request bodies ──────────────────────────────────────────────────────────

/** Body of `POST /api/organizations`. */
export interface CreateOrganizationRequest {
  name: string;
}

/** Body of `PUT /api/organizations/:orgId/name`. */
export interface RenameOrganizationRequest {
  name: string;
}

/** Body of `POST /api/organizations/:orgId/invites`. */
export interface CreateOrgInviteRequest {
  email: string;
  role: OrgInviteRole;
}

/** Body of `POST /api/organizations/invites/accept`. */
export interface AcceptOrgInviteRequest {
  token: string;
}

/** Body of `PUT /api/organizations/:orgId/members/:userId/role`. */
export interface SetOrgMemberRoleRequest {
  role: Exclude<OrgMembershipRole, 'owner'>;
}

/** Body of `POST /api/organizations/:orgId/transfer-ownership`. */
export interface TransferOrgOwnershipRequest {
  toUserId: string;
}

/** Body of `POST /api/organizations/:orgId/domains`. */
export interface ClaimOrgDomainRequest {
  domain: string;
}

/** Body of `POST /api/organizations/join-by-domain`. */
export interface JoinByDomainRequest {
  organizationId: string;
}

// ── Stable error codes (surfaced to clients as `{ code }`) ──────────────────

export const ORG_ID_TAKEN = 'ORG_ID_TAKEN';
export const ORG_ID_RESERVED = 'ORG_ID_RESERVED';
export const ORG_NAME_INVALID = 'ORG_NAME_INVALID';
export const ORG_NOT_FOUND = 'ORG_NOT_FOUND';
export const ORG_DELETED = 'ORG_DELETED';
export const ORG_NOT_EMPTY = 'ORG_NOT_EMPTY';
export const NOT_A_MEMBER = 'NOT_A_MEMBER';
export const ALREADY_MEMBER = 'ALREADY_MEMBER';
export const ROLE_FORBIDDEN = 'ROLE_FORBIDDEN';
export const OWNER_MUST_TRANSFER = 'OWNER_MUST_TRANSFER';
export const CANNOT_CHANGE_OWNER_ROLE = 'CANNOT_CHANGE_OWNER_ROLE';
export const MEMBERSHIP_REQUIRED = 'MEMBERSHIP_REQUIRED';
export const INVITE_NOT_FOUND = 'INVITE_NOT_FOUND';
export const INVITE_EXPIRED = 'INVITE_EXPIRED';
export const INVITE_REVOKED = 'INVITE_REVOKED';
export const INVITE_ALREADY_ACCEPTED = 'INVITE_ALREADY_ACCEPTED';
export const INVITE_ALREADY_PENDING = 'INVITE_ALREADY_PENDING';
export const INVITE_EMAIL_MISMATCH = 'INVITE_EMAIL_MISMATCH';
export const DOMAIN_ALREADY_CLAIMED = 'DOMAIN_ALREADY_CLAIMED';
export const DOMAIN_INVALID = 'DOMAIN_INVALID';
export const DOMAIN_NOT_FOUND = 'DOMAIN_NOT_FOUND';
export const DOMAIN_NOT_VERIFIED = 'DOMAIN_NOT_VERIFIED';
export const CONSUMER_DOMAIN_NOT_CLAIMABLE = 'CONSUMER_DOMAIN_NOT_CLAIMABLE';
