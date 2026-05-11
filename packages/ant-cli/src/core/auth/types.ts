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

export interface Organization {
  /** Slugified organization id — primary key. */
  id: string;
  /** Original user-supplied display name (preserves casing/whitespace). */
  name: string;
  /** Owner user id — null in the current "free join" model. */
  ownerId: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export type MembershipRole = 'owner' | 'member';

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
}
