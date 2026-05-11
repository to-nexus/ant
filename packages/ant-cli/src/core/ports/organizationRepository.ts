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

import type { Organization, Membership, MembershipRole, UserRecord } from '../auth/types';

export interface OrganizationSummary {
  id: string;
  name: string;
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
    /** Pre-Future-A migration this is always null. */
    ownerId?: string | null;
  }): Promise<Organization>;

  /**
   * Substring + case-insensitive search across BOTH the org id and the
   * display name. Returns `{ id, name }` projections only — no
   * `ownerId` / `createdAt` leakage to the FE.
   */
  searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]>;

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
}
