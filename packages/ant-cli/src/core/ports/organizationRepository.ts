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
} from '../auth/types';
import type {
  OrganizationKind,
  ApprovalStatus,
  AdminConfig,
  DefaultApprovalMode,
  AdminUserListQuery,
} from '@ant/shared';

export interface OrganizationSummary {
  id: string;
  name: string;
  kind?: OrganizationKind;
}

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
   * `ownerId` / `createdAt` leakage to the FE. The shared `individual`
   * org is NEVER returned (it is not a joinable team).
   */
  searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]>;

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
   */
  removeMembership(userId: string, orgId: string): Promise<void>;

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

  /** Release a claim (owner delete / superadmin reject cleanup). Idempotent. */
  deleteDomainClaim(domain: string): Promise<void>;

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
  }): Promise<UserRecord>;

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
