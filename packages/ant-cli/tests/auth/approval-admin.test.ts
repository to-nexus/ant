/**
 * RedisOrganizationRepository — approval / admin-config / super-admin guard.
 *
 * Drives the repo against a minimal in-memory Redis fake (get/set/sadd/smembers/
 * scan/multi) so the approval stamping, bidirectional control, USER_INDEX
 * backfill (+ existing-user "pre-approved" migration), admin config, and
 * super-admin reconcile are locked without a real Redis.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Redis from 'ioredis';
import { RedisOrganizationRepository } from '../../src/infrastructure/auth/RedisOrganizationRepository';

// ---------- Minimal in-memory Redis (ioredis-compatible subset) ----------
class FakeRedis {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();

  async get(k: string): Promise<string | null> {
    return this.strings.has(k) ? this.strings.get(k)! : null;
  }
  async set(k: string, v: string, ..._rest: any[]): Promise<'OK' | null> {
    // Honor NX when passed (…, 'NX').
    if (_rest.includes('NX') && this.strings.has(k)) return null;
    this.strings.set(k, v);
    return 'OK';
  }
  async sadd(k: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(k) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) { s.add(m); added++; }
    }
    this.sets.set(k, s);
    return added;
  }
  async smembers(k: string): Promise<string[]> {
    return Array.from(this.sets.get(k) ?? []);
  }
  async scan(cursor: string, _match: 'MATCH', pattern: string, _count: 'COUNT', _n: number): Promise<[string, string[]]> {
    const prefix = pattern.replace(/\*$/, '');
    const keys = Array.from(this.strings.keys()).filter((k) => k.startsWith(prefix));
    return ['0', keys];
  }
  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: any = {
      set: (...a: any[]) => { ops.push(() => this.set(a[0], a[1], ...a.slice(2))); return chain; },
      sadd: (...a: any[]) => { ops.push(() => this.sadd(a[0], ...a.slice(1))); return chain; },
      exec: async () => { for (const op of ops) await op(); return []; },
    };
    return chain;
  }
}

function makeRepo() {
  const redis = new FakeRedis();
  const repo = new RedisOrganizationRepository(redis as unknown as Redis);
  return { redis, repo };
}

const OLD_ENV = process.env.ANT_SUPER_ADMIN_EMAILS;
beforeEach(() => {
  delete process.env.ANT_SUPER_ADMIN_EMAILS;
});
afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.ANT_SUPER_ADMIN_EMAILS;
  else process.env.ANT_SUPER_ADMIN_EMAILS = OLD_ENV;
});

describe('approval stamping at signup (upsertUser)', () => {
  it('stamps a NEW user from the default policy; does not re-stamp on return', async () => {
    const { repo } = makeRepo();
    await repo.setAdminConfig('require-approval', 'root@x.com');

    const created = await repo.upsertUser({ id: 'a@x.com', email: 'a@x.com', currentOrganizationId: 'individual' });
    expect(created.approvalStatus).toBe('pending');

    // Admin approves, then the user logs in again → upsert must NOT re-pend.
    await repo.setUserApproval('a@x.com', 'approved', 'root@x.com');
    const returning = await repo.upsertUser({ id: 'a@x.com', email: 'a@x.com', currentOrganizationId: 'individual' });
    expect(returning.approvalStatus).toBe('approved');
  });

  it('auto-approve policy stamps new users approved', async () => {
    const { repo } = makeRepo();
    const u = await repo.upsertUser({ id: 'b@x.com', email: 'b@x.com', currentOrganizationId: 'individual' });
    expect(u.approvalStatus).toBe('approved');
  });
});

describe('getUserApproval', () => {
  it('returns approved for unknown/legacy users (no retroactive pend)', async () => {
    const { repo } = makeRepo();
    expect(await repo.getUserApproval('nobody@x.com')).toBe('approved');
  });
});

describe('bidirectional control (setUserApproval)', () => {
  it('flips approved → pending → denied → approved', async () => {
    const { repo } = makeRepo();
    await repo.upsertUser({ id: 'c@x.com', email: 'c@x.com', currentOrganizationId: 'individual' });
    for (const s of ['pending', 'denied', 'approved'] as const) {
      await repo.setUserApproval('c@x.com', s, 'root@x.com');
      expect(await repo.getUserApproval('c@x.com')).toBe(s);
    }
  });
});

describe('listUsers backfill + existing-user pre-approval', () => {
  it('indexes users written directly and stamps missing approvalStatus approved', async () => {
    const { redis, repo } = makeRepo();
    // Simulate a legacy user record with no approvalStatus and no index entry.
    await redis.set('ant:auth:user:legacy@x.com', JSON.stringify({
      id: 'legacy@x.com', email: 'legacy@x.com', currentOrganizationId: 'individual', createdAt: '2020-01-01T00:00:00Z',
    }));
    const users = await repo.listUsers();
    expect(users.map((u) => u.id)).toContain('legacy@x.com');
    expect(await repo.getUserApproval('legacy@x.com')).toBe('approved');
  });
});

describe('admin config', () => {
  it('defaults to auto-approve and round-trips a change', async () => {
    const { repo } = makeRepo();
    expect((await repo.getAdminConfig()).defaultApprovalMode).toBe('auto-approve');
    await repo.setAdminConfig('require-approval', 'root@x.com');
    const cfg = await repo.getAdminConfig();
    expect(cfg.defaultApprovalMode).toBe('require-approval');
    expect(cfg.updatedBy).toBe('root@x.com');
  });
});

describe('super-admin reconcile + login stamp', () => {
  it('login stamps isSuperAdmin + forces approved for env allowlist', async () => {
    process.env.ANT_SUPER_ADMIN_EMAILS = 'boss@x.com';
    const { repo } = makeRepo();
    await repo.setAdminConfig('require-approval', 'seed');
    const u = await repo.upsertUser({ id: 'boss@x.com', email: 'boss@x.com', currentOrganizationId: 'individual' });
    expect(u.isSuperAdmin).toBe(true);
    expect(u.approvalStatus).toBe('approved');
  });

  it('syncSuperAdmins flags listed emails and clears removed ones', async () => {
    const { repo } = makeRepo();
    await repo.upsertUser({ id: 'x@x.com', email: 'x@x.com', currentOrganizationId: 'individual' });
    process.env.ANT_SUPER_ADMIN_EMAILS = 'x@x.com';
    await repo.syncSuperAdmins(['x@x.com']);
    expect((await repo.getUser('x@x.com'))?.isSuperAdmin).toBe(true);
    await repo.syncSuperAdmins([]);
    expect((await repo.getUser('x@x.com'))?.isSuperAdmin).toBe(false);
  });
});
