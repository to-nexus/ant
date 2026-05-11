/**
 * Redis-backed Organization Repository
 *
 * Concrete implementation of `OrganizationRepositoryPort`. Stores the
 * Phase 3 organization / membership / user records as Redis keys —
 * see `REDIS_KEYS.AUTH` in `core/constants/redis.ts` for the SSOT key
 * layout.
 *
 * No in-memory fallback. Failure to reach Redis raises — consistent
 * with the Unified Distributed System Principle.
 */

import type Redis from 'ioredis';
import { logger } from '../../utils/logger';
import { REDIS_KEYS } from '../state/redisConstants';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../../core/ports/organizationRepository';
import type {
  Organization,
  Membership,
  MembershipRole,
  UserRecord,
} from '../../core/auth/types';

const PENDING_ORG_SENTINEL = '_pending';

function nowIso(): string {
  return new Date().toISOString();
}

export class RedisOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly redis: Redis) {}

  // -------- helpers --------

  private orgKey(id: string): string {
    return `${REDIS_KEYS.AUTH.ORG}${id}`;
  }
  private orgMembersKey(id: string): string {
    return `${REDIS_KEYS.AUTH.ORG_MEMBERS}${id}`;
  }
  private userKey(id: string): string {
    return `${REDIS_KEYS.AUTH.USER}${id}`;
  }
  private userByEmailKey(email: string): string {
    return `${REDIS_KEYS.AUTH.USER_BY_EMAIL}${email.toLowerCase()}`;
  }
  private userOrgsKey(userId: string): string {
    return `${REDIS_KEYS.AUTH.USER_ORGS}${userId}`;
  }
  private membershipKey(orgId: string, userId: string): string {
    return `${REDIS_KEYS.AUTH.MEMBERSHIP}${orgId}:${userId}`;
  }

  // -------- Organizations --------

  async getOrganization(orgId: string): Promise<Organization | null> {
    const raw = await this.redis.get(this.orgKey(orgId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Organization;
    } catch (err) {
      logger.warn(`[OrgRepo] Corrupt org record for ${orgId}; dropping`, { component: 'OrgRepo' }, err);
      return null;
    }
  }

  async getOrCreateOrganization(input: {
    id: string;
    name: string;
    ownerId?: string | null;
  }): Promise<Organization> {
    const existing = await this.getOrganization(input.id);
    if (existing) return existing;

    const record: Organization = {
      id: input.id,
      name: input.name,
      ownerId: input.ownerId ?? null,
      createdAt: nowIso(),
    };

    const pipeline = this.redis.multi();
    // SETNX so a parallel onboarding (two users joining the same fresh
    // org slug at once) does not clobber the first writer.
    pipeline.set(this.orgKey(input.id), JSON.stringify(record), 'NX');
    pipeline.sadd(REDIS_KEYS.AUTH.ORG_INDEX, input.id);
    await pipeline.exec();

    // Re-read so concurrent writers converge on the surviving record.
    const written = await this.getOrganization(input.id);
    return written ?? record;
  }

  async searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]> {
    const orgIds = await this.redis.smembers(REDIS_KEYS.AUTH.ORG_INDEX);
    if (orgIds.length === 0) return [];

    const q = query.trim().toLowerCase();
    if (!q) return [];

    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const matches: OrganizationSummary[] = [];

    // SMEMBERS + GET per match is O(N) — fine at OSS scale. When the
    // index grows past ~10k orgs, swap in a RediSearch / Postgres
    // ILIKE backend without changing this port's contract.
    for (const id of orgIds) {
      if (id.toLowerCase().includes(q)) {
        const org = await this.getOrganization(id);
        if (org) matches.push({ id: org.id, name: org.name });
      } else {
        const org = await this.getOrganization(id);
        if (org && org.name.toLowerCase().includes(q)) {
          matches.push({ id: org.id, name: org.name });
        }
      }
      if (matches.length >= cappedLimit) break;
    }

    return matches;
  }

  // -------- Memberships --------

  async attachMembership(input: {
    userId: string;
    organizationId: string;
    role?: MembershipRole;
  }): Promise<Membership> {
    const existing = await this.getMembership(input.userId, input.organizationId);
    if (existing) return existing;

    const record: Membership = {
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role ?? 'member',
      createdAt: nowIso(),
    };

    const pipeline = this.redis.multi();
    pipeline.set(this.membershipKey(input.organizationId, input.userId), JSON.stringify(record), 'NX');
    pipeline.sadd(this.orgMembersKey(input.organizationId), input.userId);
    pipeline.sadd(this.userOrgsKey(input.userId), input.organizationId);
    await pipeline.exec();

    const written = await this.getMembership(input.userId, input.organizationId);
    return written ?? record;
  }

  async getMembership(userId: string, organizationId: string): Promise<Membership | null> {
    const raw = await this.redis.get(this.membershipKey(organizationId, userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Membership;
    } catch {
      return null;
    }
  }

  async listUserOrganizations(userId: string): Promise<Organization[]> {
    const orgIds = await this.redis.smembers(this.userOrgsKey(userId));
    if (orgIds.length === 0) return [];
    const orgs = await Promise.all(orgIds.map((id) => this.getOrganization(id)));
    return orgs.filter((o): o is Organization => o !== null);
  }

  // -------- Users --------

  async getUser(userId: string): Promise<UserRecord | null> {
    const raw = await this.redis.get(this.userKey(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserRecord;
    } catch {
      return null;
    }
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const userId = await this.redis.get(this.userByEmailKey(email));
    if (!userId) return null;
    return this.getUser(userId);
  }

  async upsertUser(input: {
    id: string;
    email: string;
    name?: string;
    picture?: string;
    currentOrganizationId: string | null;
  }): Promise<UserRecord> {
    const existing = await this.getUser(input.id);
    const record: UserRecord = {
      id: input.id,
      email: input.email,
      name: input.name ?? existing?.name,
      picture: input.picture ?? existing?.picture,
      currentOrganizationId: input.currentOrganizationId,
      createdAt: existing?.createdAt ?? nowIso(),
    };

    const pipeline = this.redis.multi();
    pipeline.set(this.userKey(input.id), JSON.stringify(record));
    pipeline.set(this.userByEmailKey(input.email), input.id);
    await pipeline.exec();
    return record;
  }

  // -------- Backfill --------

  async backfillFromWorkspaceTree(
    entries: Array<{ userId: string; email?: string; organizationId: string }>,
  ): Promise<{ orgsCreated: number; usersCreated: number; membershipsCreated: number; skipped: number }> {
    let orgsCreated = 0;
    let usersCreated = 0;
    let membershipsCreated = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!entry.organizationId || entry.organizationId === PENDING_ORG_SENTINEL) {
        logger.warn(
          `[OrgRepo] backfill: skipping user ${entry.userId} with sentinel/empty org`,
          { component: 'OrgRepo' },
        );
        skipped += 1;
        continue;
      }

      const orgBefore = await this.getOrganization(entry.organizationId);
      const org = await this.getOrCreateOrganization({
        id: entry.organizationId,
        name: entry.organizationId,
        ownerId: null,
      });
      if (!orgBefore) orgsCreated += 1;

      const userBefore = await this.getUser(entry.userId);
      await this.upsertUser({
        id: entry.userId,
        email: entry.email ?? `${entry.userId}@${entry.organizationId}`,
        currentOrganizationId: org.id,
      });
      if (!userBefore) usersCreated += 1;

      const memBefore = await this.getMembership(entry.userId, org.id);
      await this.attachMembership({
        userId: entry.userId,
        organizationId: org.id,
        role: 'member',
      });
      if (!memBefore) membershipsCreated += 1;
    }

    logger.info(
      `[OrgRepo] backfill done — orgs=${orgsCreated} users=${usersCreated} memberships=${membershipsCreated} skipped=${skipped}`,
      { component: 'OrgRepo' },
    );

    return { orgsCreated, usersCreated, membershipsCreated, skipped };
  }
}
