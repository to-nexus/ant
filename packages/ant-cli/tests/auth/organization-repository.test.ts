/**
 * RedisOrganizationRepository — integration-style guard.
 *
 * Drives the repo against an in-memory Redis-compatible fake so the
 * `_pending` / membership / search / SETNX behaviors are locked in
 * without requiring a real Redis container. The fake mirrors only the
 * ioredis surface the repo actually uses (`get`, `multi`+`set`/`sadd`,
 * `smembers`). If a future repo change calls an unimplemented op the
 * test fails loudly at first invocation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type Redis from 'ioredis';

import { RedisOrganizationRepository } from '../../src/infrastructure/auth/RedisOrganizationRepository';
import { REDIS_KEYS } from '../../src/core/constants/redis';

// ---------- Minimal in-memory Redis (ioredis-compatible) ----------

interface FakeOp {
  kind: 'set' | 'set-nx' | 'sadd';
  args: any[];
}

class FakePipeline {
  ops: FakeOp[] = [];

  constructor(private store: FakeRedis) {}

  set(key: string, value: string, mode?: string): this {
    if (mode === 'NX') {
      this.ops.push({ kind: 'set-nx', args: [key, value] });
    } else {
      this.ops.push({ kind: 'set', args: [key, value] });
    }
    return this;
  }

  sadd(key: string, member: string): this {
    this.ops.push({ kind: 'sadd', args: [key, member] });
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) {
      try {
        if (op.kind === 'set') {
          this.store.kv.set(op.args[0], op.args[1]);
          results.push([null, 'OK']);
        } else if (op.kind === 'set-nx') {
          if (this.store.kv.has(op.args[0])) {
            results.push([null, null]);
          } else {
            this.store.kv.set(op.args[0], op.args[1]);
            results.push([null, 'OK']);
          }
        } else if (op.kind === 'sadd') {
          const set = this.store.sets.get(op.args[0]) ?? new Set<string>();
          set.add(op.args[1]);
          this.store.sets.set(op.args[0], set);
          results.push([null, 1]);
        }
      } catch (err) {
        results.push([err as Error, null]);
      }
    }
    return results;
  }
}

class FakeRedis {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string, mode?: string): Promise<'OK' | null> {
    if (mode === 'NX' && this.kv.has(key)) return null;
    this.kv.set(key, value);
    return 'OK';
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  multi(): FakePipeline {
    return new FakePipeline(this);
  }
}

function makeRepo(): { repo: RedisOrganizationRepository; redis: FakeRedis } {
  const redis = new FakeRedis();
  const repo = new RedisOrganizationRepository(redis as unknown as Redis);
  return { repo, redis };
}

// ---------- Tests ----------

describe('RedisOrganizationRepository', () => {
  describe('organizations', () => {
    let repo: RedisOrganizationRepository;
    let redis: FakeRedis;

    beforeEach(() => {
      ({ repo, redis } = makeRepo());
    });

    it('getOrCreateOrganization is idempotent', async () => {
      const a = await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme Inc' });
      const b = await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme Different' });
      expect(a.id).toBe('acme');
      expect(b.id).toBe('acme');
      expect(b.createdAt).toBe(a.createdAt); // existing record wins
      expect(b.name).toBe('Acme Inc'); // first writer's name is preserved
    });

    it('adds new orgs to the index SET', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      await repo.getOrCreateOrganization({ id: 'beta', name: 'Beta Corp' });
      const indexed = await redis.smembers(REDIS_KEYS.AUTH.ORG_INDEX);
      expect(indexed.sort()).toEqual(['acme', 'beta']);
    });

    it('returns null for unknown org', async () => {
      const result = await repo.getOrganization('does-not-exist');
      expect(result).toBeNull();
    });

    it('searchOrganizations matches id and name (case-insensitive)', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme Inc' });
      await repo.getOrCreateOrganization({ id: 'acme-team', name: 'Acme Team' });
      await repo.getOrCreateOrganization({ id: 'zeta', name: 'Zeta Corp' });

      const byId = await repo.searchOrganizations('ACME', 10);
      expect(byId.map((o) => o.id).sort()).toEqual(['acme', 'acme-team']);

      const byName = await repo.searchOrganizations('zeta', 10);
      expect(byName).toEqual([{ id: 'zeta', name: 'Zeta Corp', kind: 'team' }]);
    });

    it('searchOrganizations excludes the shared individual org', async () => {
      await repo.getOrCreateOrganization({ id: 'individual', name: 'Individual', kind: 'individual' });
      await repo.getOrCreateOrganization({ id: 'indie-co', name: 'Individual Co' });
      const results = await repo.searchOrganizations('indi', 10);
      // `individual` (kind=individual) is filtered; only the team org remains.
      expect(results.map((o) => o.id)).toEqual(['indie-co']);
    });

    it('searchOrganizations respects limit cap', async () => {
      for (let i = 0; i < 50; i++) {
        await repo.getOrCreateOrganization({ id: `acme-${i}`, name: `Acme ${i}` });
      }
      const results = await repo.searchOrganizations('acme', 5);
      expect(results.length).toBe(5);
    });

    it('searchOrganizations rejects empty query (cheap guard)', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      const results = await repo.searchOrganizations('   ', 10);
      expect(results).toEqual([]);
    });
  });

  describe('memberships', () => {
    let repo: RedisOrganizationRepository;
    let redis: FakeRedis;

    beforeEach(() => {
      ({ repo, redis } = makeRepo());
    });

    it('attachMembership is idempotent (SETNX semantics)', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      const m1 = await repo.attachMembership({ userId: 'user-1', organizationId: 'acme' });
      const m2 = await repo.attachMembership({ userId: 'user-1', organizationId: 'acme' });
      expect(m1.role).toBe('member');
      expect(m1.createdAt).toBe(m2.createdAt); // first writer's timestamp preserved
    });

    it('listUserOrganizations returns every org the user joined', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      await repo.getOrCreateOrganization({ id: 'beta', name: 'Beta' });
      await repo.attachMembership({ userId: 'user-1', organizationId: 'acme' });
      await repo.attachMembership({ userId: 'user-1', organizationId: 'beta' });

      const orgs = await repo.listUserOrganizations('user-1');
      expect(orgs.map((o) => o.id).sort()).toEqual(['acme', 'beta']);
    });

    it('listMembershipsByUser returns role-carrying membership rows (account switcher)', async () => {
      await repo.getOrCreateOrganization({ id: 'individual', name: 'Individual', kind: 'individual' });
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme', kind: 'team' });
      await repo.attachMembership({ userId: 'bob@x.com', organizationId: 'individual', role: 'member' });
      await repo.attachMembership({ userId: 'bob@x.com', organizationId: 'acme', role: 'owner' });

      const rows = await repo.listMembershipsByUser('bob@x.com');
      expect(rows.map((m) => m.organizationId).sort()).toEqual(['acme', 'individual']);
      expect(rows.find((m) => m.organizationId === 'acme')?.role).toBe('owner');
    });

    it('membership populates BOTH org→users and user→orgs indices', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      await repo.attachMembership({ userId: 'user-1', organizationId: 'acme' });

      const orgMembers = await redis.smembers(`${REDIS_KEYS.AUTH.ORG_MEMBERS}acme`);
      const userOrgs = await redis.smembers(`${REDIS_KEYS.AUTH.USER_ORGS}user-1`);
      expect(orgMembers).toEqual(['user-1']);
      expect(userOrgs).toEqual(['acme']);
    });
  });

  describe('users', () => {
    let repo: RedisOrganizationRepository;

    beforeEach(() => {
      ({ repo } = makeRepo());
    });

    it('upsertUser preserves createdAt on subsequent calls', async () => {
      const first = await repo.upsertUser({
        id: 'sub-1',
        email: 'alice@acme.io',
        currentOrganizationId: '_pending',
      });
      // Yield to advance the clock so a `Date.now()` race can't mask the bug.
      await new Promise((r) => setTimeout(r, 5));
      const second = await repo.upsertUser({
        id: 'sub-1',
        email: 'alice@acme.io',
        name: 'Alice',
        currentOrganizationId: 'acme.io',
      });
      expect(second.createdAt).toBe(first.createdAt);
      expect(second.name).toBe('Alice'); // new field merged
      expect(second.currentOrganizationId).toBe('acme.io'); // org transitioned
    });

    it('getUserByEmail (case-insensitive)', async () => {
      await repo.upsertUser({
        id: 'sub-1',
        email: 'Alice@Acme.IO',
        currentOrganizationId: 'acme.io',
      });
      const found = await repo.getUserByEmail('alice@acme.io');
      expect(found?.id).toBe('sub-1');
      const foundUpper = await repo.getUserByEmail('ALICE@ACME.IO');
      expect(foundUpper?.id).toBe('sub-1');
    });

    it('getUserByEmail returns null for unknown email', async () => {
      const result = await repo.getUserByEmail('nobody@example.com');
      expect(result).toBeNull();
    });

    it('upsertUser merges name/picture without erasing earlier values', async () => {
      await repo.upsertUser({
        id: 'sub-1',
        email: 'a@b.co',
        name: 'Original',
        picture: 'http://example.com/a.png',
        currentOrganizationId: '_pending',
      });
      const updated = await repo.upsertUser({
        id: 'sub-1',
        email: 'a@b.co',
        currentOrganizationId: 'b.co',
      });
      expect(updated.name).toBe('Original');
      expect(updated.picture).toBe('http://example.com/a.png');
    });
  });

  describe('backfillFromWorkspaceTree', () => {
    let repo: RedisOrganizationRepository;

    beforeEach(() => {
      ({ repo } = makeRepo());
    });

    it('creates org + user + membership rows for each entry', async () => {
      const result = await repo.backfillFromWorkspaceTree([
        { userId: 'sub-alice', email: 'alice@acme.io', organizationId: 'acme.io' },
        { userId: 'sub-bob', email: 'bob@acme.io', organizationId: 'acme.io' },
      ]);
      expect(result.orgsCreated).toBe(1);
      expect(result.usersCreated).toBe(2);
      expect(result.membershipsCreated).toBe(2);
      expect(result.skipped).toBe(0);

      const acmeMembers = await repo.listUserOrganizations('sub-alice');
      expect(acmeMembers.map((o) => o.id)).toEqual(['acme.io']);
    });

    it('skips entries with the _pending sentinel', async () => {
      const result = await repo.backfillFromWorkspaceTree([
        { userId: 'sub-x', email: 'x@y.co', organizationId: '_pending' },
        { userId: 'sub-y', organizationId: '' },
      ]);
      expect(result.skipped).toBe(2);
      expect(result.orgsCreated).toBe(0);
    });

    it('is idempotent on repeated calls (counters reflect new vs existing)', async () => {
      await repo.backfillFromWorkspaceTree([
        { userId: 'sub-a', organizationId: 'acme.io' },
      ]);
      const second = await repo.backfillFromWorkspaceTree([
        { userId: 'sub-a', organizationId: 'acme.io' },
      ]);
      expect(second.orgsCreated).toBe(0);
      expect(second.usersCreated).toBe(0);
      expect(second.membershipsCreated).toBe(0);
    });
  });

  describe('key layout regression guard', () => {
    let repo: RedisOrganizationRepository;
    let redis: FakeRedis;

    beforeEach(() => {
      ({ repo, redis } = makeRepo());
    });

    it('writes to the documented REDIS_KEYS.AUTH prefixes', async () => {
      await repo.getOrCreateOrganization({ id: 'acme', name: 'Acme' });
      await repo.attachMembership({ userId: 'sub-1', organizationId: 'acme' });
      await repo.upsertUser({ id: 'sub-1', email: 'a@b.co', currentOrganizationId: 'acme' });

      // Snapshot what landed in Redis — every key must start with one of
      // the documented prefixes. Any new key path must be added to
      // REDIS_KEYS.AUTH in core/constants/redis.ts.
      const allKeys = Array.from(redis.kv.keys());
      const allSetKeys = Array.from(redis.sets.keys());
      const everyKey = [...allKeys, ...allSetKeys];

      const allowedPrefixes = [
        REDIS_KEYS.AUTH.ORG,
        REDIS_KEYS.AUTH.ORG_INDEX,
        REDIS_KEYS.AUTH.ORG_MEMBERS,
        REDIS_KEYS.AUTH.USER_ORGS,
        REDIS_KEYS.AUTH.MEMBERSHIP,
        REDIS_KEYS.AUTH.USER,
        REDIS_KEYS.AUTH.USER_BY_EMAIL,
      ];
      for (const key of everyKey) {
        const matched = allowedPrefixes.some((p) => key.startsWith(p));
        expect(matched, `Unexpected Redis key: ${key}`).toBe(true);
      }
    });
  });
});
