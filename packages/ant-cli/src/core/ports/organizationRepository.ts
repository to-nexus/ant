/**
 * Organization Repository Port
 *
 * Persistence contract for the cloud-mode organization + membership +
 * user records described in the Phase 3 plan. The current implementation
 * is Redis-backed (see `RedisOrganizationRepository`), which lets us
 * stay inside the Unified Distributed System Principle (no in-memory
 * fallback). The interface is shaped so a future Postgres migration
 * preserves call-sites verbatim — `Organization` / `Membership` /
 * `UserRecord` mirror the SQL schema from the plan.
 *
 * All `getOrCreate*` / `attach*` operations are idempotent: re-calling
 * them with the same inputs MUST converge on the same state.
 */

import type {
  Organization,
  Membership,
  MembershipRole,
  UserRecord,
  Invitation,
  OrgDomainClaim,
  OrgJoinRequest,
  OrgMemberRemoval,
} from '../auth/types';
import type {
  OrganizationKind,
  ApprovalStatus,
  AdminConfig,
  DefaultApprovalMode,
  AdminUserListQuery,
  OrgInviteRole,
  OrgMemberRemovalReason,
} from '@ant/shared';

export interface OrganizationSummary {
  id: string;
  name: string;
  kind?: OrganizationKind;
}

/** Tombstone left by `purgeAccount` — see `recordUserPurge`. Carries no PII. */
export interface UserPurgeRecord {
  userId: string;
  purgedAt: string;
  /** Operator email for an admin purge; the account's own id for a withdrawal. */
  purgedBy: string;
  reason: UserPurgeReason;
}

export type UserPurgeReason = 'admin-purge' | 'self-withdrawal';

export interface OrganizationRepositoryPort {
  // -------- Organizations --------

  /** Lookup by primary key (slug). */
  getOrganization(orgId: string): Promise<Organization | null>;

  /**
   * Idempotently upsert an organization. When an org with the same id
   * already exists, the existing record is returned unchanged ("free
   * join" / handshake model).
   */
  getOrCreateOrganization(input: {
    id: string;
    name: string;
    /** Org kind — defaults to `deriveKindFromOrgId(id)` when omitted. */
    kind?: OrganizationKind;
    /** Pre-Future-A migration this is always null. */
    ownerId?: string | null;
  }): Promise<Organization>;

  /**
   * Substring + case-insensitive search across BOTH the org id and the
   * display name. Returns `{ id, name, kind }` projections only — no
   * `ownerId` / `createdAt` leakage to the FE. Three orgs are NEVER
   * returned: the shared `individual` org (not a joinable team), a
   * soft-deleted org, and one that has not opted into discovery.
   */
  searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]>;

  /**
   * Opt an org into / out of organization search. Search visibility is the
   * only thing this controls — it grants no access. Null when absent.
   */
  setOrganizationDiscoverable(
    orgId: string,
    discoverable: boolean,
  ): Promise<Organization | null>;

  /**
   * Strict team creation (Phase 1) — SETNX semantics. Returns `null` when an
   * org with that id already exists (HTTP 409 `ORG_ID_TAKEN` at the route).
   * Unlike `getOrCreateOrganization`, an existing record is NEVER "joined".
   */
  createOrganization(input: {
    id: string;
    name: string;
    kind: OrganizationKind;
    ownerId: string;
  }): Promise<Organization | null>;

  /** Rename (display name only — the id/slug is immutable). Null when absent. */
  updateOrganizationName(orgId: string, name: string): Promise<Organization | null>;

  /**
   * Soft-delete cascade: stamps `deletedAt`, detaches every membership
   * (members' `currentOrganizationId` reverts to the shared individual org),
   * revokes pending invites, and releases domain claims. The org record and
   * workspace directories are preserved (no hard purge in Phase 1).
   */
  softDeleteOrganization(orgId: string, deletedBy: string): Promise<void>;

  /** Superadmin enumeration of every org (soft-deleted included when asked). */
  listOrganizations(opts?: { includeDeleted?: boolean }): Promise<Organization[]>;

  // -------- Memberships --------

  /**
   * Insert a membership. Idempotent — repeating with the same
   * `(userId, organizationId)` is a no-op and returns the existing
   * record.
   */
  attachMembership(input: {
    userId: string;
    organizationId: string;
    role?: MembershipRole;
  }): Promise<Membership>;

  /** Membership for a specific (user, org) pair, or null if not joined. */
  getMembership(userId: string, organizationId: string): Promise<Membership | null>;

  /** Every org this user belongs to. Order is unspecified. */
  listUserOrganizations(userId: string): Promise<Organization[]>;

  /**
   * Every membership of this user (org id + role), for the account
   * switcher / `/auth/me` envelope. Order is unspecified.
   */
  listMembershipsByUser(userId: string): Promise<Membership[]>;

  /** Every membership of one org (member management list). */
  listOrgMemberships(orgId: string): Promise<Membership[]>;

  /**
   * Detach a membership (leave / admin removal). When the removed user's
   * `currentOrganizationId` pointed at this org, it reverts to the shared
   * individual org. Idempotent — absent membership is a no-op.
   *
   * `opts.record` is REQUIRED, not optional, so every caller is forced by the
   * compiler to decide whether this detach leaves a removal row behind (which
   * suppresses the domain shortcut). The `softDeleteOrganization` cascade
   * passes `null` — the org is gone, so a row would be noise.
   */
  removeMembership(
    userId: string,
    orgId: string,
    opts: {
      record: { removedBy: string; reason: OrgMemberRemovalReason } | null;
    },
  ): Promise<void>;

  /** Change a member's role. Null when the membership does not exist. */
  setMembershipRole(
    userId: string,
    orgId: string,
    role: MembershipRole,
  ): Promise<Membership | null>;

  /**
   * Atomic ownership transfer: `fromUserId` owner→admin, `toUserId` →owner,
   * `Organization.ownerId` = toUserId. False when either membership is
   * missing or `fromUserId` is not the current owner.
   */
  transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<boolean>;

  // -------- Invitations (Phase 1) --------

  /** Persist a new invite (id/token uniqueness is caller-generated crypto). */
  createInvite(invite: Invitation): Promise<void>;

  getInvite(inviteId: string): Promise<Invitation | null>;

  getInviteByToken(token: string): Promise<Invitation | null>;

  /** Every invite an org has issued (all statuses; expiry judged lazily). */
  listOrgInvites(orgId: string): Promise<Invitation[]>;

  /** Every invite addressed to an email (for `/auth/me` pendingInvites). */
  listInvitesByEmail(email: string): Promise<Invitation[]>;

  /** Full-record update (accept / revoke transitions). */
  updateInvite(invite: Invitation): Promise<void>;

  // -------- Domain claims (Phase 1) --------

  /**
   * Claim a domain — SETNX on the global `domain` PK. Returns `null` when the
   * domain is already claimed by ANY org (HTTP 409 `DOMAIN_ALREADY_CLAIMED`).
   */
  createDomainClaim(claim: OrgDomainClaim): Promise<OrgDomainClaim | null>;

  getDomainClaim(domain: string): Promise<OrgDomainClaim | null>;

  listOrgDomains(orgId: string): Promise<OrgDomainClaim[]>;

  /** Full-record update (verify / reject transitions). */
  updateDomainClaim(claim: OrgDomainClaim): Promise<void>;

  /**
   * Patch the join policy of an existing claim. Null when the domain is not
   * claimed. Separate from `updateDomainClaim` so a policy edit cannot
   * clobber the verification state it read moments earlier.
   */
  patchDomainJoinPolicy(
    domain: string,
    patch: { autoJoin?: boolean; autoJoinRole?: OrgInviteRole },
  ): Promise<OrgDomainClaim | null>;

  /** Release a claim (owner delete / superadmin reject cleanup). Idempotent. */
  deleteDomainClaim(domain: string): Promise<void>;

  // -------- Join requests --------

  /**
   * Persist a new join request, claiming the one-live-request guard for
   * `(organizationId, userId)`. Returns `null` when a pending request already
   * exists (HTTP 409 `JOIN_REQUEST_ALREADY_PENDING`).
   */
  createJoinRequest(request: OrgJoinRequest): Promise<OrgJoinRequest | null>;

  getJoinRequest(requestId: string): Promise<OrgJoinRequest | null>;

  /** Every request addressed to an org (all statuses; expiry judged lazily). */
  listJoinRequestsByOrg(orgId: string): Promise<OrgJoinRequest[]>;

  /** Every request raised by a user (for `/auth/me` myJoinRequests). */
  listJoinRequestsByUser(userId: string): Promise<OrgJoinRequest[]>;

  /**
   * Move a request out of `pending` (approve / reject / cancel) and release
   * the one-live-request guard. Null when the request is absent.
   */
  setJoinRequestStatus(
    requestId: string,
    status: Exclude<OrgJoinRequest['status'], 'pending'>,
    decidedBy: string,
  ): Promise<OrgJoinRequest | null>;

  // -------- Member removals (domain-shortcut blocklist) --------

  /** Record that a member left or was removed. Overwrites an earlier row. */
  recordMemberRemoval(removal: OrgMemberRemoval): Promise<void>;

  /** Point lookup used by the login path and the join surface. */
  getMemberRemoval(orgId: string, userId: string): Promise<OrgMemberRemoval | null>;

  /** Every removal row of one org (admin management list). */
  listRemovedMembers(orgId: string): Promise<OrgMemberRemoval[]>;

  /**
   * Clear a removal row — an explicit re-admission (invite accepted, join
   * request approved, admin "allow again"). Idempotent.
   */
  clearMemberRemoval(orgId: string, userId: string): Promise<void>;

  // -------- Users --------

  /** Stable userId → record lookup. */
  getUser(userId: string): Promise<UserRecord | null>;

  /** Email → record lookup (case-insensitive). */
  getUserByEmail(email: string): Promise<UserRecord | null>;

  /**
   * Idempotent upsert keyed by `id`. Used by the OAuth callback on every
   * successful authentication to keep `email` / `name` / `picture` /
   * `currentOrganizationId` fresh.
   */
  upsertUser(input: {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    currentOrganizationId: string | null;
    /** Stamp of the last login-time domain auto-join (backfill notice). */
    lastDomainAutoJoin?: UserRecord['lastDomainAutoJoin'];
  }): Promise<UserRecord>;

  // -------- Purge tombstones --------

  /**
   * Record that an account was purged. The tombstone carries NO PII — its only
   * job is to answer two questions the deleted record can no longer answer:
   *
   *  - `getUserApproval` must say `denied`, not the missing-record default
   *    `approved`. JWTs are stateless with no denylist, so a plain delete would
   *    leave the session cookie working for days and a desktop token for 90.
   *  - `upsertUser` must not silently re-create the identity (and re-populate
   *    the email / name / picture a purge just removed) on the next OAuth
   *    callback.
   *
   * `reason` is the policy fork: `admin-purge` refuses a re-signup outright,
   * `self-withdrawal` lets the person come back as a brand-new account.
   */
  /**
   * Delete the identity records for a purged account: the user JSON, its
   * `byEmail` pointer, its entry in the admin enumeration index, its raised
   * join requests (and their per-org pending guards), and the invites addressed
   * to its email. `email` is optional because the caller may already have
   * dropped the record; without it the byEmail pointer cannot be resolved.
   *
   * ALWAYS pair this with `recordUserPurge` — on its own it leaves an id whose
   * approval reads as the missing-record default `approved`.
   */
  deleteUserIdentity(userId: string, email?: string): Promise<void>;

  recordUserPurge(purge: UserPurgeRecord): Promise<void>;

  /** Tombstone for a purged account, or `null` when the id was never purged. */
  getUserPurge(userId: string): Promise<UserPurgeRecord | null>;

  /** Lift a tombstone — an admin undoing a mistaken purge, or a re-signup. */
  clearUserPurge(userId: string): Promise<void>;

  // -------- Backfill --------

  /**
   * Idempotent backfill — given a list of `(userId, email, organizationId)`
   * tuples observed from another source of truth (e.g. existing
   * workspace tree under `{workspaces}/{orgId}/{userId}`), create the
   * org / user / membership records if they don't already exist.
   *
   * Records carrying the `_pending` sentinel as `organizationId` are
   * skipped (they belong to an in-flight onboarding flow). The plan's
   * Postgres backfill flow is mirrored here so the on-disk → Redis
   * lift is a single function call.
   */
  backfillFromWorkspaceTree(
    entries: Array<{ userId: string; email?: string; organizationId: string }>,
  ): Promise<{ orgsCreated: number; usersCreated: number; membershipsCreated: number; skipped: number }>;

  // -------- Approval / admin (cloud-only; Noop = always approved) --------

  /**
   * Read a user's approval state. Returns `'approved'` when the field is absent
   * (legacy / unmanaged — never retroactively pended). This is the gate read
   * consumed by the OSS job/chat start routes.
   */
  getUserApproval(userId: string): Promise<ApprovalStatus>;

  /**
   * Set a user's approval state to any of approved/pending/denied (bidirectional
   * control — applies to already-approved and legacy users too). Records
   * `approvedAt` + `approvedBy`. No-op when the user does not exist.
   */
  setUserApproval(userId: string, status: ApprovalStatus, adminEmail: string): Promise<void>;

  /** Set the test-account level (0 = normal, ≥1 = test-payment enabled). */
  setTestAccountLevel(userId: string, level: number, adminEmail: string): Promise<void>;

  /**
   * Enumerate users for the admin dashboard. Backed by a `USER_INDEX` SET
   * (backfilled from `SCAN` on first call). Optional `status` filters by
   * approval state.
   */
  listUsers(query?: AdminUserListQuery): Promise<UserRecord[]>;

  /** Global default-approval policy (defaults to `auto-approve`). */
  getAdminConfig(): Promise<AdminConfig>;

  /** Set the global default-approval policy. */
  setAdminConfig(mode: DefaultApprovalMode, adminEmail: string): Promise<void>;

  /**
   * Reconcile the DB `isSuperAdmin` flag against the env allowlist: emails in
   * the list are flagged + force-approved, emails no longer present are cleared.
   * Ensures the `USER_INDEX` backfill has run first.
   */
  syncSuperAdmins(emails: string[]): Promise<void>;
}
