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
  Invitation,
  OrgDomainClaim,
} from '../../core/auth/types';
import { deriveKindFromOrgId, INDIVIDUAL_ORG_ID } from '@ant/shared';
import type {
  ApprovalStatus,
  AdminConfig,
  DefaultApprovalMode,
  AdminUserListQuery,
} from '@ant/shared';
import { isSuperAdminEmail } from '../../core/auth/superAdmin';

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
  private inviteKey(inviteId: string): string {
    return `${REDIS_KEYS.AUTH.INVITE}${inviteId}`;
  }
  private inviteByTokenKey(token: string): string {
    return `${REDIS_KEYS.AUTH.INVITE_BY_TOKEN}${token}`;
  }
  private orgInvitesKey(orgId: string): string {
    return `${REDIS_KEYS.AUTH.ORG_INVITES}${orgId}`;
  }
  private invitesByEmailKey(email: string): string {
    return `${REDIS_KEYS.AUTH.INVITES_BY_EMAIL}${email.toLowerCase()}`;
  }
  private domainKey(domain: string): string {
    return `${REDIS_KEYS.AUTH.DOMAIN}${domain.toLowerCase()}`;
  }
  private orgDomainsKey(orgId: string): string {
    return `${REDIS_KEYS.AUTH.ORG_DOMAINS}${orgId}`;
  }

  // -------- Organizations --------

  async getOrganization(orgId: string): Promise<Organization | null> {
    const raw = await this.redis.get(this.orgKey(orgId));
    if (!raw) return null;
    try {
      const org = JSON.parse(raw) as Organization;
      // Records written before the kind axis lack `kind` — derive it so
      // every caller sees a populated kind.
      if (!org.kind) org.kind = deriveKindFromOrgId(org.id);
      return org;
    } catch (err) {
      logger.warn(`[OrgRepo] Corrupt org record for ${orgId}; dropping`, { component: 'OrgRepo' }, err);
      return null;
    }
  }

  async getOrCreateOrganization(input: {
    id: string;
    name: string;
    kind?: import('@ant/shared').OrganizationKind;
    ownerId?: string | null;
  }): Promise<Organization> {
    const existing = await this.getOrganization(input.id);
    if (existing) return existing;

    const record: Organization = {
      id: input.id,
      name: input.name,
      kind: input.kind ?? deriveKindFromOrgId(input.id),
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
      const org = await this.getOrganization(id);
      if (!org) continue;
      // The shared individual org is never a joinable team — exclude it.
      if (org.kind === 'individual') continue;
      const hit = id.toLowerCase().includes(q) || org.name.toLowerCase().includes(q);
      if (hit) matches.push({ id: org.id, name: org.name, kind: org.kind });
      if (matches.length >= cappedLimit) break;
    }

    return matches;
  }

  // -------- Teams (Phase 1) --------

  async createOrganization(input: {
    id: string;
    name: string;
    kind: import('@ant/shared').OrganizationKind;
    ownerId: string;
  }): Promise<Organization | null> {
    const record: Organization = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      ownerId: input.ownerId,
      createdAt: nowIso(),
    };
    // Strict SETNX — a soft-deleted org still occupies its id (reuse would
    // resurrect the previous org's workspace paths under a new owner).
    const wrote = await this.redis.set(this.orgKey(input.id), JSON.stringify(record), 'NX');
    if (wrote === null) return null;
    await this.redis.sadd(REDIS_KEYS.AUTH.ORG_INDEX, input.id);
    return record;
  }

  async updateOrganizationName(orgId: string, name: string): Promise<Organization | null> {
    const org = await this.getOrganization(orgId);
    if (!org) return null;
    org.name = name;
    await this.redis.set(this.orgKey(orgId), JSON.stringify(org));
    return org;
  }

  async softDeleteOrganization(orgId: string, deletedBy: string): Promise<void> {
    const org = await this.getOrganization(orgId);
    if (!org || org.deletedAt) return;

    const members = await this.listOrgMemberships(orgId);
    for (const m of members) {
      await this.removeMembership(m.userId, orgId);
    }

    const invites = await this.listOrgInvites(orgId);
    for (const invite of invites) {
      if (invite.status === 'pending') {
        invite.status = 'revoked';
        invite.revokedAt = nowIso();
        invite.revokedBy = deletedBy;
        await this.updateInvite(invite);
      }
    }

    // Release domain claims so the domain becomes claimable again.
    const domains = await this.listOrgDomains(orgId);
    for (const claim of domains) {
      await this.deleteDomainClaim(claim.domain);
    }

    org.deletedAt = nowIso();
    await this.redis.set(this.orgKey(orgId), JSON.stringify(org));
    logger.info(`[OrgRepo] soft-deleted org ${orgId} by ${deletedBy}`, { component: 'OrgRepo' });
  }

  async listOrganizations(opts?: { includeDeleted?: boolean }): Promise<Organization[]> {
    const ids = await this.redis.smembers(REDIS_KEYS.AUTH.ORG_INDEX);
    if (ids.length === 0) return [];
    const orgs = (await Promise.all(ids.map((id) => this.getOrganization(id)))).filter(
      (o): o is Organization => o !== null,
    );
    const visible = opts?.includeDeleted ? orgs : orgs.filter((o) => !o.deletedAt);
    visible.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return visible;
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

  async listMembershipsByUser(userId: string): Promise<Membership[]> {
    const orgIds = await this.redis.smembers(this.userOrgsKey(userId));
    if (orgIds.length === 0) return [];
    const memberships = await Promise.all(
      orgIds.map((orgId) => this.getMembership(userId, orgId)),
    );
    return memberships.filter((m): m is Membership => m !== null);
  }

  async listOrgMemberships(orgId: string): Promise<Membership[]> {
    const userIds = await this.redis.smembers(this.orgMembersKey(orgId));
    if (userIds.length === 0) return [];
    const rows = await Promise.all(userIds.map((uid) => this.getMembership(uid, orgId)));
    const memberships = rows.filter((m): m is Membership => m !== null);
    memberships.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return memberships;
  }

  async removeMembership(userId: string, orgId: string): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.del(this.membershipKey(orgId, userId));
    pipeline.srem(this.orgMembersKey(orgId), userId);
    pipeline.srem(this.userOrgsKey(userId), orgId);
    await pipeline.exec();

    // A user whose active org was just removed reverts to the shared
    // individual org so the next JWT refresh lands on a valid tenant.
    const user = await this.getUser(userId);
    if (user && user.currentOrganizationId === orgId) {
      user.currentOrganizationId = INDIVIDUAL_ORG_ID;
      await this.redis.set(this.userKey(userId), JSON.stringify(user));
    }
  }

  async setMembershipRole(
    userId: string,
    orgId: string,
    role: MembershipRole,
  ): Promise<Membership | null> {
    const membership = await this.getMembership(userId, orgId);
    if (!membership) return null;
    membership.role = role;
    await this.redis.set(this.membershipKey(orgId, userId), JSON.stringify(membership));
    return membership;
  }

  async transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<boolean> {
    const org = await this.getOrganization(orgId);
    if (!org || org.deletedAt) return false;
    const from = await this.getMembership(fromUserId, orgId);
    const to = await this.getMembership(toUserId, orgId);
    if (!from || !to || from.role !== 'owner') return false;

    from.role = 'admin';
    to.role = 'owner';
    org.ownerId = toUserId;

    const pipeline = this.redis.multi();
    pipeline.set(this.membershipKey(orgId, fromUserId), JSON.stringify(from));
    pipeline.set(this.membershipKey(orgId, toUserId), JSON.stringify(to));
    pipeline.set(this.orgKey(orgId), JSON.stringify(org));
    await pipeline.exec();
    return true;
  }

  // -------- Invitations (Phase 1) --------

  private parseInvite(raw: string | null): Invitation | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Invitation;
    } catch {
      return null;
    }
  }

  async createInvite(invite: Invitation): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.set(this.inviteKey(invite.id), JSON.stringify(invite));
    pipeline.set(this.inviteByTokenKey(invite.token), invite.id);
    pipeline.sadd(this.orgInvitesKey(invite.organizationId), invite.id);
    pipeline.sadd(this.invitesByEmailKey(invite.email), invite.id);
    await pipeline.exec();
  }

  async getInvite(inviteId: string): Promise<Invitation | null> {
    return this.parseInvite(await this.redis.get(this.inviteKey(inviteId)));
  }

  async getInviteByToken(token: string): Promise<Invitation | null> {
    const inviteId = await this.redis.get(this.inviteByTokenKey(token));
    if (!inviteId) return null;
    return this.getInvite(inviteId);
  }

  async listOrgInvites(orgId: string): Promise<Invitation[]> {
    const ids = await this.redis.smembers(this.orgInvitesKey(orgId));
    if (ids.length === 0) return [];
    const invites = (await Promise.all(ids.map((id) => this.getInvite(id)))).filter(
      (i): i is Invitation => i !== null,
    );
    invites.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return invites;
  }

  async listInvitesByEmail(email: string): Promise<Invitation[]> {
    const ids = await this.redis.smembers(this.invitesByEmailKey(email));
    if (ids.length === 0) return [];
    const invites = (await Promise.all(ids.map((id) => this.getInvite(id)))).filter(
      (i): i is Invitation => i !== null,
    );
    invites.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return invites;
  }

  async updateInvite(invite: Invitation): Promise<void> {
    await this.redis.set(this.inviteKey(invite.id), JSON.stringify(invite));
  }

  // -------- Domain claims (Phase 1) --------

  async createDomainClaim(claim: OrgDomainClaim): Promise<OrgDomainClaim | null> {
    // SETNX on the global domain PK — one org per domain, first writer wins.
    const wrote = await this.redis.set(this.domainKey(claim.domain), JSON.stringify(claim), 'NX');
    if (wrote === null) return null;
    await this.redis.sadd(this.orgDomainsKey(claim.organizationId), claim.domain);
    return claim;
  }

  async getDomainClaim(domain: string): Promise<OrgDomainClaim | null> {
    const raw = await this.redis.get(this.domainKey(domain));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OrgDomainClaim;
    } catch {
      return null;
    }
  }

  async listOrgDomains(orgId: string): Promise<OrgDomainClaim[]> {
    const domains = await this.redis.smembers(this.orgDomainsKey(orgId));
    if (domains.length === 0) return [];
    const claims = (await Promise.all(domains.map((d) => this.getDomainClaim(d)))).filter(
      (c): c is OrgDomainClaim => c !== null,
    );
    claims.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    return claims;
  }

  async updateDomainClaim(claim: OrgDomainClaim): Promise<void> {
    await this.redis.set(this.domainKey(claim.domain), JSON.stringify(claim));
  }

  async deleteDomainClaim(domain: string): Promise<void> {
    const claim = await this.getDomainClaim(domain);
    const pipeline = this.redis.multi();
    pipeline.del(this.domainKey(domain));
    if (claim) {
      pipeline.srem(this.orgDomainsKey(claim.organizationId), domain);
    }
    await pipeline.exec();
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
    const isSuper = isSuperAdminEmail(input.email);

    // Approval is stamped ONLY when the record is newly created (existing===null)
    // — upsertUser runs on every login, so returning users are never re-stamped.
    // This is precisely the "accounts created after time T" behavior. Env
    // super-admins are always forced approved.
    let approvalStatus = existing?.approvalStatus;
    if (existing === null) {
      if (isSuper) {
        approvalStatus = 'approved';
      } else {
        const cfg = await this.getAdminConfig();
        approvalStatus = cfg.defaultApprovalMode === 'require-approval' ? 'pending' : 'approved';
      }
    } else if (isSuper && existing.approvalStatus !== 'approved') {
      approvalStatus = 'approved';
    }

    const record: UserRecord = {
      id: input.id,
      email: input.email,
      name: input.name ?? existing?.name,
      picture: input.picture ?? existing?.picture,
      currentOrganizationId: input.currentOrganizationId,
      createdAt: existing?.createdAt ?? nowIso(),
      approvalStatus,
      approvedAt: existing?.approvedAt,
      approvedBy: existing?.approvedBy,
      isSuperAdmin: isSuper ? true : existing?.isSuperAdmin,
      testAccountLevel: existing?.testAccountLevel,
    };

    const pipeline = this.redis.multi();
    pipeline.set(this.userKey(input.id), JSON.stringify(record));
    pipeline.set(this.userByEmailKey(input.email), input.id);
    pipeline.sadd(REDIS_KEYS.AUTH.USER_INDEX, input.id);
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

  // -------- Approval / admin --------

  private userIndexBackfilled = false;

  /**
   * One-time (per-process) build of the `USER_INDEX` SET via SCAN, since users
   * were historically reachable only through the byEmail lookup. During the
   * scan, existing users missing `approvalStatus` are stamped `'approved'` — the
   * rollout "existing users are pre-approved" migration. Idempotent.
   */
  private async ensureUserIndexBackfilled(): Promise<void> {
    if (this.userIndexBackfilled) return;
    const prefix = REDIS_KEYS.AUTH.USER; // 'ant:auth:user:'
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      const userIds: string[] = [];
      for (const key of keys) {
        const suffix = key.slice(prefix.length);
        // The USER prefix is also a prefix of byEmail:/orgs:/index — exclude those.
        if (!suffix || suffix.startsWith('byEmail:') || suffix.startsWith('orgs:') || suffix === 'index') {
          continue;
        }
        userIds.push(suffix);
      }
      for (const userId of userIds) {
        const u = await this.getUser(userId);
        if (u && u.approvalStatus === undefined) {
          u.approvalStatus = 'approved';
          await this.redis.set(this.userKey(userId), JSON.stringify(u));
        }
      }
      if (userIds.length > 0) {
        await this.redis.sadd(REDIS_KEYS.AUTH.USER_INDEX, ...userIds);
      }
    } while (cursor !== '0');
    this.userIndexBackfilled = true;
  }

  async getUserApproval(userId: string): Promise<ApprovalStatus> {
    const u = await this.getUser(userId);
    return u?.approvalStatus ?? 'approved';
  }

  async setUserApproval(userId: string, status: ApprovalStatus, adminEmail: string): Promise<void> {
    const u = await this.getUser(userId);
    if (!u) {
      logger.warn(`[OrgRepo] setUserApproval: user ${userId} not found`, { component: 'OrgRepo' });
      return;
    }
    u.approvalStatus = status;
    u.approvedAt = nowIso();
    u.approvedBy = adminEmail;
    await this.redis.set(this.userKey(userId), JSON.stringify(u));
  }

  async setTestAccountLevel(userId: string, level: number, adminEmail: string): Promise<void> {
    const u = await this.getUser(userId);
    if (!u) {
      logger.warn(`[OrgRepo] setTestAccountLevel: user ${userId} not found`, { component: 'OrgRepo' });
      return;
    }
    u.testAccountLevel = Math.max(0, Math.floor(level));
    await this.redis.set(this.userKey(userId), JSON.stringify(u));
    logger.info(`[OrgRepo] testAccountLevel ${userId} → ${u.testAccountLevel} by ${adminEmail}`, {
      component: 'OrgRepo',
    });
  }

  async listUsers(query?: AdminUserListQuery): Promise<UserRecord[]> {
    await this.ensureUserIndexBackfilled();
    const ids = await this.redis.smembers(REDIS_KEYS.AUTH.USER_INDEX);
    if (ids.length === 0) return [];
    const users = (await Promise.all(ids.map((id) => this.getUser(id)))).filter(
      (u): u is UserRecord => u !== null,
    );
    let filtered = users;
    if (query?.status) {
      filtered = users.filter((u) => (u.approvalStatus ?? 'approved') === query.status);
    }
    // Newest first (stable display).
    filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const limit = query?.limit ? Math.max(1, Math.min(query.limit, 1000)) : filtered.length;
    return filtered.slice(0, limit);
  }

  async getAdminConfig(): Promise<AdminConfig> {
    const raw = await this.redis.get(REDIS_KEYS.ADMIN.CONFIG);
    if (raw) {
      try {
        return JSON.parse(raw) as AdminConfig;
      } catch {
        logger.warn('[OrgRepo] corrupt admin config; using default', { component: 'OrgRepo' });
      }
    }
    return { defaultApprovalMode: 'auto-approve', updatedAt: new Date(0).toISOString(), updatedBy: '' };
  }

  async setAdminConfig(mode: DefaultApprovalMode, adminEmail: string): Promise<void> {
    const cfg: AdminConfig = { defaultApprovalMode: mode, updatedAt: nowIso(), updatedBy: adminEmail };
    await this.redis.set(REDIS_KEYS.ADMIN.CONFIG, JSON.stringify(cfg));
  }

  async syncSuperAdmins(emails: string[]): Promise<void> {
    await this.ensureUserIndexBackfilled();
    const wanted = new Set(emails.map((e) => e.toLowerCase()));
    const ids = await this.redis.smembers(REDIS_KEYS.AUTH.USER_INDEX);
    for (const id of ids) {
      const u = await this.getUser(id);
      if (!u) continue;
      const shouldBe = wanted.has(u.email.toLowerCase());
      const isNow = u.isSuperAdmin === true;
      if (shouldBe && (!isNow || u.approvalStatus !== 'approved')) {
        u.isSuperAdmin = true;
        u.approvalStatus = 'approved';
        await this.redis.set(this.userKey(id), JSON.stringify(u));
      } else if (!shouldBe && isNow) {
        u.isSuperAdmin = false;
        await this.redis.set(this.userKey(id), JSON.stringify(u));
      }
    }
    logger.info(`[OrgRepo] syncSuperAdmins done (${wanted.size} configured)`, { component: 'OrgRepo' });
  }
}
