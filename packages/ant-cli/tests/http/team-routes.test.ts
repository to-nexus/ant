/**
 * Team organization routes (Phase 1) — role-gate truth table, invite
 * acceptance edges, owner-leave, domain claims, join-by-domain.
 *
 * Same pattern as auth-me-route.test.ts — no supertest; a real Express app
 * on port 0 driven by fetch. Authentication is simulated by a middleware
 * that injects `req.user` (what jwtAuth would set); the repo is the REAL
 * `RedisOrganizationRepository` over an in-memory ioredis fake, so the
 * route ↔ repo contract is exercised end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type Redis from 'ioredis';

// DNS is external — controllable per test. Everything else in the module
// (normalize/validate/token) runs real.
const verifyDomainOwnershipMock = vi.fn(async () => false);
vi.mock('../../src/infrastructure/deploy/customDomain/verification', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/infrastructure/deploy/customDomain/verification')
  >();
  return {
    ...actual,
    verifyDomainOwnership: (...args: unknown[]) => verifyDomainOwnershipMock(...(args as [])),
  };
});

import { RedisOrganizationRepository } from '../../src/infrastructure/auth/RedisOrganizationRepository';
import { createTeamsRoutes } from '../../src/periphery/adapters/http/routes/teams.routes';

// ---------- In-memory Redis (get/set/del/smembers/sadd/srem/multi/scan) ----------

type Op = { kind: 'set' | 'set-nx' | 'sadd' | 'srem' | 'del'; args: any[] };

class FakePipeline {
  ops: Op[] = [];
  constructor(private store: FakeRedis) {}
  set(key: string, value: string, mode?: string): this {
    this.ops.push({ kind: mode === 'NX' ? 'set-nx' : 'set', args: [key, value] });
    return this;
  }
  sadd(key: string, member: string): this {
    this.ops.push({ kind: 'sadd', args: [key, member] });
    return this;
  }
  srem(key: string, member: string): this {
    this.ops.push({ kind: 'srem', args: [key, member] });
    return this;
  }
  del(key: string): this {
    this.ops.push({ kind: 'del', args: [key] });
    return this;
  }
  async exec(): Promise<Array<[Error | null, unknown]>> {
    const out: Array<[Error | null, unknown]> = [];
    for (const op of this.ops) {
      if (op.kind === 'set') {
        this.store.kv.set(op.args[0], op.args[1]);
        out.push([null, 'OK']);
      } else if (op.kind === 'set-nx') {
        if (this.store.kv.has(op.args[0])) out.push([null, null]);
        else {
          this.store.kv.set(op.args[0], op.args[1]);
          out.push([null, 'OK']);
        }
      } else if (op.kind === 'sadd') {
        const s = this.store.sets.get(op.args[0]) ?? new Set<string>();
        s.add(op.args[1]);
        this.store.sets.set(op.args[0], s);
        out.push([null, 1]);
      } else if (op.kind === 'srem') {
        this.store.sets.get(op.args[0])?.delete(op.args[1]);
        out.push([null, 1]);
      } else {
        this.store.kv.delete(op.args[0]);
        out.push([null, 1]);
      }
    }
    return out;
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
  multi(): FakePipeline {
    return new FakePipeline(this);
  }
}

// ---------- Harness ----------

const OWNER = { id: 'kim@acme.com', email: 'kim@acme.com' };
const ADMIN = { id: 'park@acme.com', email: 'park@acme.com' };
const MEMBER = { id: 'lee@acme.com', email: 'lee@acme.com' };
const OUTSIDER = { id: 'sam@other.io', email: 'sam@other.io' };

let currentUser: { id: string; email: string } | null = OWNER;

let repo: RedisOrganizationRepository;
let baseUrl = '';
let server: http.Server | undefined;

async function startApp(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (currentUser) (req as any).user = { ...currentUser, organizationId: 'individual' };
    next();
  });
  app.use('/api', createTeamsRoutes({ organizationRepository: repo }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function as(user: typeof OWNER, method: string, path: string, body?: unknown) {
  currentUser = user;
  return api(method, path, body);
}

/** Seed: approved users + an 'acme' team with owner/admin/member rows. */
async function seedTeam(): Promise<void> {
  for (const u of [OWNER, ADMIN, MEMBER, OUTSIDER]) {
    await repo.upsertUser({ id: u.id, email: u.email, currentOrganizationId: 'individual' });
  }
  await as(OWNER, 'POST', '/organizations', { name: 'Acme' });
  await repo.attachMembership({ userId: ADMIN.id, organizationId: 'acme', role: 'admin' });
  await repo.attachMembership({ userId: MEMBER.id, organizationId: 'acme', role: 'member' });
}

beforeEach(async () => {
  verifyDomainOwnershipMock.mockReset();
  verifyDomainOwnershipMock.mockResolvedValue(false);
  currentUser = OWNER;
  repo = new RedisOrganizationRepository(new FakeRedis() as unknown as Redis);
  await startApp();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

// ---------- Creation ----------

describe('POST /api/organizations', () => {
  beforeEach(async () => {
    await repo.upsertUser({ id: OWNER.id, email: OWNER.email, currentOrganizationId: 'individual' });
  });

  it('creates a team and attaches the caller as owner', async () => {
    const { status, json } = await as(OWNER, 'POST', '/organizations', { name: 'Acme Inc.' });
    expect(status).toBe(201);
    expect(json.organization).toMatchObject({ id: 'acme-inc', kind: 'team', name: 'Acme Inc.' });
    const m = await repo.getMembership(OWNER.id, 'acme-inc');
    expect(m?.role).toBe('owner');
    const org = await repo.getOrganization('acme-inc');
    expect(org?.ownerId).toBe(OWNER.id);
  });

  it('409 ORG_ID_TAKEN on duplicate slug', async () => {
    await as(OWNER, 'POST', '/organizations', { name: 'Acme' });
    const { status, json } = await as(OWNER, 'POST', '/organizations', { name: 'acme' });
    expect(status).toBe(409);
    expect(json.code).toBe('ORG_ID_TAKEN');
  });

  it('400 ORG_ID_RESERVED for reserved names and the personal- prefix', async () => {
    const reserved = await as(OWNER, 'POST', '/organizations', { name: 'admin' });
    expect(reserved.status).toBe(400);
    expect(reserved.json.code).toBe('ORG_ID_RESERVED');
    const personal = await as(OWNER, 'POST', '/organizations', { name: 'personal Space' });
    expect(personal.status).toBe(400);
    expect(personal.json.code).toBe('ORG_ID_RESERVED');
  });

  it('403 for a non-approved account', async () => {
    await repo.upsertUser({ id: OUTSIDER.id, email: OUTSIDER.email, currentOrganizationId: 'individual' });
    await repo.setUserApproval(OUTSIDER.id, 'pending', 'op@ant.dev');
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations', { name: 'Rogue' });
    expect(status).toBe(403);
    expect(json.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('401 without a session', async () => {
    currentUser = null;
    const { status } = await api('POST', '/organizations', { name: 'Ghost' });
    expect(status).toBe(401);
  });
});

// ---------- Role-gate truth table ----------

describe('role gates', () => {
  beforeEach(seedTeam);

  const cases: Array<{
    who: typeof OWNER;
    method: string;
    path: string;
    body?: unknown;
    expect: number;
  }> = [
    // member: read-only surface
    { who: MEMBER, method: 'GET', path: '/organizations/acme/members', expect: 200 },
    { who: MEMBER, method: 'GET', path: '/organizations/acme/invites', expect: 403 },
    { who: MEMBER, method: 'POST', path: '/organizations/acme/invites', body: { email: 'x@y.io', role: 'member' }, expect: 403 },
    { who: MEMBER, method: 'PUT', path: '/organizations/acme/name', body: { name: 'New' }, expect: 403 },
    { who: MEMBER, method: 'POST', path: '/organizations/acme/domains', body: { domain: 'acme.com' }, expect: 403 },
    // admin: manage members/invites/domains, but not admin-grade actions
    { who: ADMIN, method: 'GET', path: '/organizations/acme/invites', expect: 200 },
    { who: ADMIN, method: 'POST', path: '/organizations/acme/invites', body: { email: 'x@y.io', role: 'member' }, expect: 201 },
    { who: ADMIN, method: 'POST', path: '/organizations/acme/invites', body: { email: 'z@y.io', role: 'admin' }, expect: 403 },
    { who: ADMIN, method: 'PUT', path: '/organizations/acme/name', body: { name: 'Acme2' }, expect: 200 },
    { who: ADMIN, method: 'PUT', path: `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}/role`, body: { role: 'admin' }, expect: 403 },
    { who: ADMIN, method: 'DELETE', path: '/organizations/acme', expect: 403 },
    // owner: everything
    { who: OWNER, method: 'POST', path: '/organizations/acme/invites', body: { email: 'z@y.io', role: 'admin' }, expect: 201 },
    { who: OWNER, method: 'PUT', path: `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}/role`, body: { role: 'admin' }, expect: 200 },
    // outsider: indistinguishable 404
    { who: OUTSIDER, method: 'GET', path: '/organizations/acme/members', expect: 404 },
  ];

  for (const c of cases) {
    it(`${c.who.id.split('@')[0]} ${c.method} ${c.path} → ${c.expect}`, async () => {
      const { status } = await as(c.who, c.method, c.path, c.body);
      expect(status).toBe(c.expect);
    });
  }

  it('non-team org ids 404 (kind-dispatch: individual is not manageable)', async () => {
    await repo.getOrCreateOrganization({ id: 'individual', name: 'Individual' });
    await repo.attachMembership({ userId: OWNER.id, organizationId: 'individual' });
    const { status } = await as(OWNER, 'GET', '/organizations/individual/members');
    expect(status).toBe(404);
  });
});

// ---------- Members: remove / role / transfer / leave ----------

describe('member management', () => {
  beforeEach(seedTeam);

  it('admin removes a member; only owner removes an admin', async () => {
    const byAdmin = await as(ADMIN, 'DELETE', `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}`);
    expect(byAdmin.status).toBe(200);
    expect(await repo.getMembership(MEMBER.id, 'acme')).toBeNull();

    await repo.attachMembership({ userId: MEMBER.id, organizationId: 'acme', role: 'admin' });
    const adminOnAdmin = await as(ADMIN, 'DELETE', `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}`);
    expect(adminOnAdmin.status).toBe(403);
    const ownerOnAdmin = await as(OWNER, 'DELETE', `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}`);
    expect(ownerOnAdmin.status).toBe(200);
  });

  it('the owner cannot be removed', async () => {
    const { status, json } = await as(ADMIN, 'DELETE', `/organizations/acme/members/${encodeURIComponent(OWNER.id)}`);
    expect(status).toBe(403);
    expect(json.code).toBe('OWNER_MUST_TRANSFER');
  });

  it('removal reverts the target currentOrganizationId to individual', async () => {
    await repo.upsertUser({ id: MEMBER.id, email: MEMBER.email, currentOrganizationId: 'acme' });
    await as(OWNER, 'DELETE', `/organizations/acme/members/${encodeURIComponent(MEMBER.id)}`);
    const u = await repo.getUser(MEMBER.id);
    expect(u?.currentOrganizationId).toBe('individual');
  });

  it('role change never targets the owner', async () => {
    const { status, json } = await as(OWNER, 'PUT', `/organizations/acme/members/${encodeURIComponent(OWNER.id)}/role`, { role: 'member' });
    expect(status).toBe(403);
    expect(json.code).toBe('CANNOT_CHANGE_OWNER_ROLE');
  });

  it('transfer-ownership swaps roles and updates ownerId', async () => {
    const { status } = await as(OWNER, 'POST', '/organizations/acme/transfer-ownership', { toUserId: ADMIN.id });
    expect(status).toBe(200);
    expect((await repo.getMembership(OWNER.id, 'acme'))?.role).toBe('admin');
    expect((await repo.getMembership(ADMIN.id, 'acme'))?.role).toBe('owner');
    expect((await repo.getOrganization('acme'))?.ownerId).toBe(ADMIN.id);
  });

  it('owner leave → 403 OWNER_MUST_TRANSFER; member leave ok', async () => {
    const owner = await as(OWNER, 'POST', '/organizations/acme/leave');
    expect(owner.status).toBe(403);
    expect(owner.json.code).toBe('OWNER_MUST_TRANSFER');
    const member = await as(MEMBER, 'POST', '/organizations/acme/leave');
    expect(member.status).toBe(200);
    expect(await repo.getMembership(MEMBER.id, 'acme')).toBeNull();
  });

  it('delete refuses while members remain, succeeds when sole, then 404s', async () => {
    const populated = await as(OWNER, 'DELETE', '/organizations/acme');
    expect(populated.status).toBe(409);
    expect(populated.json.code).toBe('ORG_NOT_EMPTY');

    await as(ADMIN, 'POST', '/organizations/acme/leave');
    await as(MEMBER, 'POST', '/organizations/acme/leave');
    const sole = await as(OWNER, 'DELETE', '/organizations/acme');
    expect(sole.status).toBe(200);

    const after = await as(OWNER, 'GET', '/organizations/acme');
    expect(after.status).toBe(404);
  });
});

// ---------- Invites ----------

describe('invitations', () => {
  beforeEach(seedTeam);

  async function createInvite(email = 'new@acme.com', role = 'member'): Promise<any> {
    const { json } = await as(OWNER, 'POST', '/organizations/acme/invites', { email, role });
    return json.invite;
  }

  it('duplicate pending invite → 409 INVITE_ALREADY_PENDING', async () => {
    await createInvite();
    const { status, json } = await as(OWNER, 'POST', '/organizations/acme/invites', { email: 'new@acme.com', role: 'member' });
    expect(status).toBe(409);
    expect(json.code).toBe('INVITE_ALREADY_PENDING');
  });

  it('inviting an existing member → 409 ALREADY_MEMBER', async () => {
    const { status, json } = await as(OWNER, 'POST', '/organizations/acme/invites', { email: MEMBER.email, role: 'member' });
    expect(status).toBe(409);
    expect(json.code).toBe('ALREADY_MEMBER');
  });

  it('accept: email mismatch → 403 INVITE_EMAIL_MISMATCH', async () => {
    const invite = await createInvite('new@acme.com');
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: invite.token });
    expect(status).toBe(403);
    expect(json.code).toBe('INVITE_EMAIL_MISMATCH');
  });

  it('accept: revoked → 410 INVITE_REVOKED', async () => {
    const invite = await createInvite(OUTSIDER.email);
    await as(OWNER, 'POST', `/organizations/acme/invites/${invite.id}/revoke`);
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: invite.token });
    expect(status).toBe(410);
    expect(json.code).toBe('INVITE_REVOKED');
  });

  it('accept: expired → 410 INVITE_EXPIRED (lazy judgment)', async () => {
    const invite = await createInvite(OUTSIDER.email);
    const stored = await repo.getInvite(invite.id);
    stored!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await repo.updateInvite(stored!);
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: invite.token });
    expect(status).toBe(410);
    expect(json.code).toBe('INVITE_EXPIRED');
  });

  it('accept: happy path attaches membership with the invite role', async () => {
    const invite = await createInvite(OUTSIDER.email, 'admin');
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: invite.token });
    expect(status).toBe(200);
    expect(json).toMatchObject({ alreadyMember: false, role: 'admin' });
    expect((await repo.getMembership(OUTSIDER.id, 'acme'))?.role).toBe('admin');
    expect((await repo.getInvite(invite.id))?.status).toBe('accepted');
  });

  it('accept: already a member → 200 alreadyMember (switch prompt, not error)', async () => {
    // Race: invited first, then joined via another path (e.g. domain join)
    // before clicking the link. Accept degrades to a switch prompt.
    const invite = await createInvite(OUTSIDER.email);
    await repo.attachMembership({ userId: OUTSIDER.id, organizationId: 'acme', role: 'member' });
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: invite.token });
    expect(status).toBe(200);
    expect(json.alreadyMember).toBe(true);
  });

  it('accept: unknown token → 404 INVITE_NOT_FOUND', async () => {
    const { status, json } = await as(OUTSIDER, 'POST', '/organizations/invites/accept', { token: 'nope' });
    expect(status).toBe(404);
    expect(json.code).toBe('INVITE_NOT_FOUND');
  });

  it('revoke is idempotent', async () => {
    const invite = await createInvite('new@acme.com');
    const first = await as(ADMIN, 'POST', `/organizations/acme/invites/${invite.id}/revoke`);
    expect(first.status).toBe(200);
    const second = await as(ADMIN, 'POST', `/organizations/acme/invites/${invite.id}/revoke`);
    expect(second.status).toBe(200);
    expect(second.json.invite.status).toBe('revoked');
  });
});

// ---------- Domains ----------

describe('domain claims', () => {
  beforeEach(seedTeam);

  it('consumer domains are never claimable', async () => {
    const { status, json } = await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'gmail.com' });
    expect(status).toBe(400);
    expect(json.code).toBe('CONSUMER_DOMAIN_NOT_CLAIMABLE');
  });

  it('email-host fast-path verifies instantly (verifiedBy email)', async () => {
    const { status, json } = await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.com' });
    expect(status).toBe(201);
    expect(json.domain).toMatchObject({ status: 'verified', verifiedBy: 'email' });
  });

  it('host mismatch → pending claim with TXT challenge', async () => {
    const { status, json } = await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });
    expect(status).toBe(201);
    expect(json.domain.status).toBe('pending');
    expect(json.domain.txtRecordName).toBe('_ant-challenge.acme.io');
    expect(json.domain.verificationToken).toMatch(/^ant-verify-/);
  });

  it('a domain is globally single-claim → 409 DOMAIN_ALREADY_CLAIMED', async () => {
    await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });
    const again = await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('DOMAIN_ALREADY_CLAIMED');
  });

  it('explicit DNS verify flips pending → verified only when TXT matches', async () => {
    await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });

    verifyDomainOwnershipMock.mockResolvedValueOnce(false);
    const miss = await as(OWNER, 'POST', '/organizations/acme/domains/acme.io/verify');
    expect(miss.status).toBe(200);
    expect(miss.json.verified).toBe(false);
    expect(miss.json.domain.status).toBe('pending');

    verifyDomainOwnershipMock.mockResolvedValueOnce(true);
    const hit = await as(OWNER, 'POST', '/organizations/acme/domains/acme.io/verify');
    expect(hit.json.verified).toBe(true);
    expect(hit.json.domain).toMatchObject({ status: 'verified', verifiedBy: 'dns' });
  });

  it('join-by-domain requires a VERIFIED claim matching the caller host', async () => {
    await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'other.io' }); // pending
    const pending = await as(OUTSIDER, 'POST', '/organizations/join-by-domain', { organizationId: 'acme' });
    expect(pending.status).toBe(403);
    expect(pending.json.code).toBe('DOMAIN_NOT_VERIFIED');

    const claim = await repo.getDomainClaim('other.io');
    claim!.status = 'verified';
    claim!.verifiedAt = new Date().toISOString();
    claim!.verifiedBy = 'dns';
    await repo.updateDomainClaim(claim!);

    const joined = await as(OUTSIDER, 'POST', '/organizations/join-by-domain', { organizationId: 'acme' });
    expect(joined.status).toBe(200);
    expect(joined.json).toMatchObject({ alreadyMember: false, role: 'member' });
    expect((await repo.getMembership(OUTSIDER.id, 'acme'))?.role).toBe('member');
  });

  it('domain delete is owner-only and releases the global claim', async () => {
    await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });
    const byAdmin = await as(ADMIN, 'DELETE', '/organizations/acme/domains/acme.io');
    expect(byAdmin.status).toBe(403);
    const byOwner = await as(OWNER, 'DELETE', '/organizations/acme/domains/acme.io');
    expect(byOwner.status).toBe(200);
    expect(await repo.getDomainClaim('acme.io')).toBeNull();
    // claimable again after release
    const reclaim = await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.io' });
    expect(reclaim.status).toBe(201);
  });
});

// ---------- Soft-delete cascade ----------

describe('soft-delete cascade', () => {
  beforeEach(seedTeam);

  it('force delete detaches members, revokes invites, releases domains', async () => {
    await as(OWNER, 'POST', '/organizations/acme/invites', { email: 'new@acme.com', role: 'member' });
    await as(OWNER, 'POST', '/organizations/acme/domains', { domain: 'acme.com' });
    await repo.upsertUser({ id: MEMBER.id, email: MEMBER.email, currentOrganizationId: 'acme' });

    await repo.softDeleteOrganization('acme', 'op@ant.dev');

    expect(await repo.getMembership(OWNER.id, 'acme')).toBeNull();
    expect((await repo.getUser(MEMBER.id))?.currentOrganizationId).toBe('individual');
    const invites = await repo.listOrgInvites('acme');
    expect(invites.every((i) => i.status === 'revoked')).toBe(true);
    expect(await repo.getDomainClaim('acme.com')).toBeNull();
    expect((await repo.getOrganization('acme'))?.deletedAt).toBeTruthy();

    // deleted org is a 404 for every team route
    const { status } = await as(OWNER, 'GET', '/organizations/acme');
    expect(status).toBe(404);
  });
});
