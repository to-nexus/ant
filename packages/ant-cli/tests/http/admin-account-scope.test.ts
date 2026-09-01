/**
 * Admin account listing — one row per (user × scope).
 *
 * Credits are keyed per (orgId, userId), so a user in personal + two teams owns
 * three independent accounts. The admin surface used to derive the scope from
 * `UserRecord.currentOrganizationId`, collapsing every user to one row whose
 * identity depended on their last org switch. These rows pin the scope axis.
 *
 * Same pattern as team-routes.test.ts — no supertest; a real Express app on
 * port 0 driven by fetch, `req.user` injected by a middleware, and the REAL
 * `RedisOrganizationRepository` over an in-memory ioredis fake. The ledger is a
 * fake so account existence is controllable per scope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type Redis from 'ioredis';
import type { BalanceSnapshot, CreditTransaction } from '@ant/shared';
import type { PeekedBalance } from '../../src/core/ports/creditLedger';

import { RedisOrganizationRepository } from '../../src/infrastructure/auth/RedisOrganizationRepository';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { createAdminRoutes } from '../../src/periphery/adapters/http/routes/admin.routes';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';

// ---------- In-memory Redis ----------

class FakeRedis {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, string>>();
  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }
  async set(key: string, value: string, mode?: string): Promise<'OK' | null> {
    if (mode === 'NX' && this.kv.has(key)) return null;
    this.kv.set(key, value);
    return 'OK';
  }
  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }
  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async scan(_cursor: string, ..._args: unknown[]): Promise<[string, string[]]> {
    return ['0', []];
  }
  // Removal rows are a HASH — `removeMembership` writes one on every detach.
  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hset(key: string, field: string, value: string): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    const fresh = !h.has(field);
    h.set(field, value);
    this.hashes.set(key, h);
    return fresh ? 1 : 0;
  }
  async hdel(key: string, field: string): Promise<number> {
    return this.hashes.get(key)?.delete(field) ? 1 : 0;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  multi(): any {
    const ops: Array<() => void> = [];
    const self = this;
    const p: any = {
      set: (k: string, v: string, mode?: string) => {
        ops.push(() => {
          if (mode === 'NX' && self.kv.has(k)) return;
          self.kv.set(k, v);
        });
        return p;
      },
      sadd: (k: string, m: string) => {
        ops.push(() => void self.sadd(k, m));
        return p;
      },
      srem: (k: string, m: string) => {
        ops.push(() => void self.srem(k, m));
        return p;
      },
      del: (k: string) => {
        ops.push(() => void self.del(k));
        return p;
      },
      exec: async () => {
        ops.forEach((o) => o());
        return ops.map(() => [null, 'OK']);
      },
    };
    return p;
  }
}

// ---------- Fake ledger: account existence is per (org,user) ----------

function snapshot(credits: number, nextBillingDate?: string): BalanceSnapshot {
  return {
    tier: 'free',
    microCredits: credits * 100_000,
    credits,
    includedCreditsMonthly: 10,
    status: 'none',
    ...(nextBillingDate ? { nextBillingDate } : {}),
  };
}

class FakeLedger implements Partial<CreditLedgerPort> {
  accounts = new Map<string, PeekedBalance>();
  ledgers = new Map<string, CreditTransaction[]>();
  getBalance = vi.fn(async () => snapshot(0));

  seed(orgId: string, userId: string, credits: number, nextBillingDate?: string): void {
    this.accounts.set(`${orgId}|${userId}`, {
      snapshot: snapshot(credits, nextBillingDate),
      stale: false,
    });
  }
  /** An account that predates the billing cutover — exists, balance unusable. */
  seedStale(orgId: string, userId: string, credits: number): void {
    this.accounts.set(`${orgId}|${userId}`, { snapshot: snapshot(credits), stale: true });
  }
  async peekBalance(orgId: string, userId: string): Promise<PeekedBalance | null> {
    return this.accounts.get(`${orgId}|${userId}`) ?? null;
  }
  async listAccountScopes(userId: string): Promise<string[]> {
    return [...this.accounts.keys()]
      .filter((k) => k.endsWith(`|${userId}`))
      .map((k) => k.slice(0, k.lastIndexOf('|')));
  }
  async listTransactions(orgId: string, userId: string): Promise<CreditTransaction[]> {
    return this.ledgers.get(`${orgId}|${userId}`) ?? [];
  }
}

// ---------- Harness ----------

const ADMIN_EMAIL = 'root@ant.dev';
const USER = { id: 'kim@acme.com', email: 'kim@acme.com' };

let repo: RedisOrganizationRepository;
let ledger: FakeLedger;
let baseUrl = '';
let server: http.Server | undefined;

async function startApp(creditLedger: Partial<CreditLedgerPort>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: ADMIN_EMAIL, email: ADMIN_EMAIL, organizationId: 'individual' };
    next();
  });
  app.use(
    '/api',
    createAdminRoutes({
      creditLedger: creditLedger as CreditLedgerPort,
      organizationRepository: repo,
    }),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** `kim` in personal + team-a + team-b. */
async function seedUser(): Promise<void> {
  await repo.upsertUser({
    id: USER.id,
    email: USER.email,
    currentOrganizationId: 'individual',
  });
  for (const [orgId, name] of [
    ['individual', 'Individual'],
    ['team-a', 'Team A'],
    ['team-b', 'Team B'],
  ]) {
    await repo.createOrganization({
      id: orgId,
      name,
      kind: orgId === 'individual' ? 'individual' : 'team',
      ownerId: USER.id,
    });
    await repo.attachMembership({ userId: USER.id, organizationId: orgId, role: 'member' });
  }
}

beforeEach(async () => {
  vi.stubEnv('ANT_SUPER_ADMIN_EMAILS', ADMIN_EMAIL);
  repo = new RedisOrganizationRepository(new FakeRedis() as unknown as Redis);
  ledger = new FakeLedger();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  vi.unstubAllEnvs();
});

describe('GET /admin/users — scope axis', () => {
  it('returns one row per scope that holds an account, with per-scope credits', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 10);
    ledger.seed('team-a', USER.id, 28.4);
    await startApp(ledger);

    const { status, json } = await api('GET', '/admin/users');
    expect(status).toBe(200);

    const rows = json.rows.filter((r: any) => r.userId === USER.id);
    expect(rows).toHaveLength(2);
    expect(
      Object.fromEntries(rows.map((r: any) => [r.organizationId, r.credits])),
    ).toEqual({ individual: 10, 'team-a': 28.4 });
    // team-b is a membership with no ledger account.
    expect(rows.map((r: any) => r.organizationId)).not.toContain('team-b');
    // Identity fields repeat across a user's rows.
    expect(new Set(rows.map((r: any) => r.email))).toEqual(new Set([USER.email]));
  });

  it('never calls getBalance — reading must not mint an account or a grant', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 10);
    await startApp(ledger);

    await api('GET', '/admin/users');
    await api('GET', `/admin/users/${encodeURIComponent(USER.id)}`);

    expect(ledger.getBalance).not.toHaveBeenCalled();
    // The unaccounted scopes stayed unaccounted.
    expect(await ledger.peekBalance('team-a', USER.id)).toBeNull();
    expect(await ledger.peekBalance('team-b', USER.id)).toBeNull();
  });

  it('keeps the row set stable when the active org changes', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 10);
    ledger.seed('team-a', USER.id, 5);
    await startApp(ledger);

    const before = (await api('GET', '/admin/users')).json.rows;
    await repo.upsertUser({
      id: USER.id,
      email: USER.email,
      currentOrganizationId: 'team-b',
    });
    const after = (await api('GET', '/admin/users')).json.rows;

    expect(after.map((r: any) => r.organizationId).sort()).toEqual(
      before.map((r: any) => r.organizationId).sort(),
    );
  });

  it('leads with the personal scope even when a team is the active org', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 10);
    ledger.seed('team-a', USER.id, 5);
    // The operator's target is working inside a team — the ordering must not
    // follow them there, or a fresh account's only row moves once they join one.
    await repo.upsertUser({
      id: USER.id,
      email: USER.email,
      currentOrganizationId: 'team-a',
    });
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows.filter(
      (r: any) => r.userId === USER.id,
    );
    expect(rows.map((r: any) => r.organizationId)).toEqual(['individual', 'team-a']);
    expect(rows[0].active).toBe(false);

    const detail = (await api('GET', `/admin/users/${encodeURIComponent(USER.id)}`)).json;
    expect(detail.scopes[0].organizationId).toBe('individual');
  });

  it('surfaces an account whose membership is gone as orphaned', async () => {
    await seedUser();
    ledger.seed('team-a', USER.id, 7);
    await repo.removeMembership(USER.id, 'team-a', { record: null });
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows;
    const orphan = rows.find((r: any) => r.organizationId === 'team-a');
    expect(orphan).toMatchObject({ orphaned: true, credits: 7 });
    expect(orphan.role).toBeUndefined();
  });

  it('lists every membership when the ledger is a no-op (billing off)', async () => {
    await seedUser();
    await startApp(new NoopCreditLedger());

    const rows = (await api('GET', '/admin/users')).json.rows.filter(
      (r: any) => r.userId === USER.id,
    );
    expect(rows.map((r: any) => r.organizationId).sort()).toEqual([
      'individual',
      'team-a',
      'team-b',
    ]);
  });

  it('still lists a user with no billing account anywhere, so they stay approvable', async () => {
    await seedUser();
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows.filter(
      (r: any) => r.userId === USER.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: null, credits: null, email: USER.email });
  });

  it('reports a pre-cutover account without rendering its stale balance', async () => {
    await seedUser();
    ledger.seedStale('individual', USER.id, 900);
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows.filter(
      (r: any) => r.userId === USER.id,
    );
    expect(rows).toHaveLength(1);
    // The scope is visible (money is not hidden) but the number is withheld.
    expect(rows[0]).toMatchObject({
      organizationId: 'individual',
      stale: true,
      tier: null,
      credits: null,
    });
  });

  it('never treats the onboarding sentinel as a billing scope', async () => {
    await repo.upsertUser({
      id: USER.id,
      email: USER.email,
      currentOrganizationId: '_pending',
    });
    ledger.seed('_pending', USER.id, 5);
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows;
    expect(rows.map((r: any) => r.organizationId)).not.toContain('_pending');
  });

  it('filters rows by organizationId', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 10);
    ledger.seed('team-a', USER.id, 5);
    await startApp(ledger);

    const { json } = await api('GET', '/admin/users?organizationId=team-a');
    expect(json.rows.map((r: any) => r.organizationId)).toEqual(['team-a']);
  });

  it('flags a scope whose monthly grant is past due', async () => {
    await seedUser();
    ledger.seed('individual', USER.id, 2, new Date(Date.now() - 86_400_000).toISOString());
    ledger.seed('team-a', USER.id, 2, new Date(Date.now() + 86_400_000).toISOString());
    await startApp(ledger);

    const rows = (await api('GET', '/admin/users')).json.rows;
    expect(rows.find((r: any) => r.organizationId === 'individual').grantOverdue).toBe(true);
    expect(rows.find((r: any) => r.organizationId === 'team-a').grantOverdue).toBe(false);
  });
});

describe('GET /admin/users/:userId — per-scope detail', () => {
  it('returns a scope entry per membership, including unaccounted ones', async () => {
    await seedUser();
    ledger.seed('team-a', USER.id, 12);
    ledger.ledgers.set(`team-a|${USER.id}`, [
      { id: 't1', ts: new Date().toISOString(), kind: 'topup', microCredits: 1_200_000 } as any,
    ]);
    await startApp(ledger);

    const { json } = await api('GET', `/admin/users/${encodeURIComponent(USER.id)}`);
    const byOrg = Object.fromEntries(json.scopes.map((s: any) => [s.organizationId, s]));

    expect(Object.keys(byOrg).sort()).toEqual(['individual', 'team-a', 'team-b']);
    expect(byOrg['team-a'].balance.credits).toBe(12);
    expect(byOrg['team-a'].transactions).toHaveLength(1);
    // An unaccounted scope reports no balance and is not queried for a ledger.
    expect(byOrg['team-b'].balance).toBeNull();
    expect(byOrg['team-b'].transactions).toEqual([]);
  });
});

describe('DELETE /admin/organizations/:orgId/members/:userId', () => {
  /**
   * Super-admin sits above the org role ladder (it may remove an `admin`), but
   * not above the owner invariant — an ownerless team can no longer transfer,
   * rename or delete itself.
   */
  it.each([
    ['member', 200],
    ['admin', 200],
    ['owner', 403],
  ])('role %s → %i', async (role, expected) => {
    await seedUser();
    await repo.setMembershipRole(USER.id, 'team-a', role as any);
    await startApp(ledger);

    const { status } = await api(
      'DELETE',
      `/admin/organizations/team-a/members/${encodeURIComponent(USER.id)}`,
    );
    expect(status).toBe(expected);
    expect(await repo.getMembership(USER.id, 'team-a')).toEqual(
      expected === 200 ? null : expect.objectContaining({ role }),
    );
  });

  it('records a removal row, so the domain shortcut cannot re-add them at next login', async () => {
    await seedUser();
    await startApp(ledger);

    await api('DELETE', `/admin/organizations/team-a/members/${encodeURIComponent(USER.id)}`);

    const removal = await repo.getMemberRemoval('team-a', USER.id);
    expect(removal).toMatchObject({ reason: 'removed', removedBy: ADMIN_EMAIL });
  });

  it('reverts an active-org pointer that named the org it just detached', async () => {
    await seedUser();
    const user = await repo.getUser(USER.id);
    user!.currentOrganizationId = 'team-a';
    await repo.upsertUser({ ...user!, currentOrganizationId: 'team-a' } as any);
    await startApp(ledger);

    await api('DELETE', `/admin/organizations/team-a/members/${encodeURIComponent(USER.id)}`);

    expect((await repo.getUser(USER.id))!.currentOrganizationId).toBe('individual');
  });

  it.each([
    ['unknown org', '/admin/organizations/nope/members/kim%40acme.com'],
    ['non-member', `/admin/organizations/team-a/members/${encodeURIComponent('ghost@acme.com')}`],
  ])('%s → 404', async (_label, path) => {
    await seedUser();
    await startApp(ledger);
    expect((await api('DELETE', path)).status).toBe(404);
  });
});

describe('DELETE /admin/users/:userId — purge guards', () => {
  /**
   * The purge deps are absent in this harness, so a request that reaches the
   * engine answers 501. Every case below must be REFUSED before that point —
   * a 501 here would mean the guard did not run.
   */
  it('501s when the deployment has no purge deps wired', async () => {
    await seedUser();
    await startApp(ledger);
    const { status } = await api(
      'DELETE',
      `/admin/users/${encodeURIComponent(USER.id)}?confirmEmail=${encodeURIComponent(USER.email)}`,
    );
    expect(status).toBe(501);
  });

  it.each([
    ['no confirmEmail', '', 400],
    ['wrong confirmEmail', 'someone@else.com', 400],
  ])('%s → %i', async (_label, confirm, expected) => {
    await seedUser();
    await startApp(ledger);
    const { status, json } = await api(
      'DELETE',
      `/admin/users/${encodeURIComponent(USER.id)}?confirmEmail=${encodeURIComponent(confirm)}`,
    );
    expect(status).toBe(expected);
    expect(json.code).toBe('PURGE_CONFIRM_MISMATCH');
  });

  it('404s for an unknown user, before the confirm check', async () => {
    await startApp(ledger);
    const { status } = await api('DELETE', '/admin/users/ghost%40acme.com?confirmEmail=ghost%40acme.com');
    expect(status).toBe(404);
  });

  it('refuses a super admin — the env grant would resurrect them at next boot', async () => {
    await repo.upsertUser({ id: ADMIN_EMAIL, email: ADMIN_EMAIL, currentOrganizationId: 'individual' });
    await startApp(ledger);
    const { status, json } = await api(
      'DELETE',
      `/admin/users/${encodeURIComponent(ADMIN_EMAIL)}?confirmEmail=${encodeURIComponent(ADMIN_EMAIL)}`,
    );
    expect(status).toBe(403);
    expect(json.code).toBe('PURGE_FORBIDDEN');
  });

  // The tombstone-lifting route is gone with the tombstone: a purge leaves no
  // blocklist, so there is nothing to undo. `:userId/purge` now falls through
  // to the `:userId` shape, which 404s on an id that no longer exists.
  it('has no un-purge route — a deleted id is simply not found', async () => {
    await seedUser();
    await startApp(ledger);
    expect((await api('DELETE', `/admin/users/${encodeURIComponent(USER.id)}/purge`)).status).toBe(404);
  });
});
