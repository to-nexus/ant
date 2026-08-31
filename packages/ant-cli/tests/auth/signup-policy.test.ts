/**
 * Org-model signup-policy regression guard.
 *
 * Post-cutover model: every cloud signup joins the SHARED `individual` org
 * (id `'individual'`, kind `'individual'`), regardless of personal vs business
 * email. User identity is the FULL lowercased email (collision-free in the
 * shared org). The `userInput` branch is the dormant team seam.
 *
 * Second axis in this file: what the LOGIN grants beyond `individual` — a
 * verified email-domain claim whose auto-join is on. It is evaluated on every
 * login (not only the first), which is what backfills accounts whose domain
 * was claimed after they signed up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';

import {
  resolveOrgIdentity,
  resolveOrganizationId,
} from '../../src/core/auth/resolveOrganizationId';
import { slugify, InvalidOrganizationNameError, RESERVED_ORG_NAMES } from '../../src/core/auth/slugify';
import { AuthService, assertColonFreeUserId } from '../../src/core/auth/AuthService';
import { INDIVIDUAL_ORG_ID } from '@ant/shared';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

describe('Org-model signup policy', () => {
  it('contains no hardcoded `to.nexus` allowlist branch in AuthService or auth.routes', () => {
    const authSvc = fs.readFileSync(
      path.join(repoRoot, 'src/core/auth/AuthService.ts'),
      'utf-8',
    );
    const authRoutes = fs.readFileSync(
      path.join(repoRoot, 'src/periphery/adapters/http/routes/auth.routes.ts'),
      'utf-8',
    );
    const liveGuard = /['"]to\.nexus['"]/;
    expect(authSvc).not.toMatch(liveGuard);
    expect(authRoutes).not.toMatch(liveGuard);
  });

  it('every cloud signup resolves to the shared individual org (personal AND business)', () => {
    const consumer = resolveOrgIdentity('foo@gmail.com', undefined, 'user-1');
    const business = resolveOrgIdentity('alice@acme.io', undefined, 'user-a');
    expect(consumer).toEqual({ id: INDIVIDUAL_ORG_ID, kind: 'individual' });
    expect(business).toEqual({ id: INDIVIDUAL_ORG_ID, kind: 'individual' });
  });

  it('no more `personal-` per-user ids on the signup path', () => {
    expect(resolveOrganizationId('foo@gmail.com', undefined, 'user-1')).toBe(INDIVIDUAL_ORG_ID);
    expect(resolveOrganizationId('bar@gmail.com', undefined, 'user-2')).toBe(INDIVIDUAL_ORG_ID);
  });

  it('explicit org name input is the dormant team seam (kind=team)', () => {
    expect(resolveOrgIdentity('foo@gmail.com', 'Acme Team', 'user-1')).toEqual({
      id: 'acme-team',
      kind: 'team',
    });
  });

  it('`individual` is a reserved org name (cannot be a team slug)', () => {
    expect(RESERVED_ORG_NAMES.has('individual')).toBe(true);
    expect(() => slugify('individual')).toThrow(InvalidOrganizationNameError);
  });

  it('AuthService: user.id is the full lowercased email, org is individual', async () => {
    const svc = new AuthService();
    const a = await svc.authenticate({ email: 'Foo@Gmail.com', userId: 'oauth-sub-1' });
    expect(a.user.id).toBe('foo@gmail.com');
    expect(a.organization.id).toBe(INDIVIDUAL_ORG_ID);
    expect(a.organization.kind).toBe('individual');
  });

  it('collision fix: same local-part, different domains → DIFFERENT user.id', async () => {
    // The headline bug this refactor fixes: in a shared org, both would
    // otherwise collapse to `bob`.
    const svc = new AuthService();
    const gmail = await svc.authenticate({ email: 'bob@gmail.com', userId: 's1' });
    const naver = await svc.authenticate({ email: 'bob@naver.com', userId: 's2' });
    expect(gmail.user.id).toBe('bob@gmail.com');
    expect(naver.user.id).toBe('bob@naver.com');
    expect(gmail.user.id).not.toBe(naver.user.id);
    // Both share the one individual org.
    expect(gmail.organization.id).toBe(naver.organization.id);
  });

  it('assertColonFreeUserId rejects a colon (protects `:`-delimited keys)', () => {
    expect(() => assertColonFreeUserId('bob@gmail.com')).not.toThrow();
    expect(() => assertColonFreeUserId('bad:id@x.com')).toThrow();
  });
});

// ── Login-time domain auto-join ──────────────────────────────────────────────

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

const { createAuthRoutes } = await import('../../src/periphery/adapters/http/routes/auth.routes');
const { JwtService } = await import('../../src/infrastructure/auth/JwtService');
const { RedisOrganizationRepository } = await import(
  '../../src/infrastructure/auth/RedisOrganizationRepository'
);
const { REDIS_KEYS } = await import('../../src/infrastructure/state/redisConstants');

/** kv + set + hash in-memory ioredis stand-in (same shape as team-routes). */
class FakeRedis {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, string>>();
  async get(k: string) { return this.kv.get(k) ?? null; }
  async set(k: string, v: string, mode?: string) {
    if (mode === 'NX' && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return 'OK' as const;
  }
  async del(k: string) { const h = this.hashes.delete(k); return this.kv.delete(k) || h ? 1 : 0; }
  async smembers(k: string) { return Array.from(this.sets.get(k) ?? []); }
  async sadd(k: string, ...m: string[]) {
    const s = this.sets.get(k) ?? new Set<string>();
    m.forEach((x) => s.add(x));
    this.sets.set(k, s);
    return m.length;
  }
  async srem(k: string, m: string) { return this.sets.get(k)?.delete(m) ? 1 : 0; }
  async hset(k: string, f: string, v: string) {
    const h = this.hashes.get(k) ?? new Map<string, string>();
    const isNew = !h.has(f);
    h.set(f, v);
    this.hashes.set(k, h);
    return isNew ? 1 : 0;
  }
  async hget(k: string, f: string) { return this.hashes.get(k)?.get(f) ?? null; }
  async hgetall(k: string) { return Object.fromEntries(this.hashes.get(k) ?? new Map()); }
  async hdel(k: string, f: string) { return this.hashes.get(k)?.delete(f) ? 1 : 0; }
  multi() {
    const ops: Array<() => void> = [];
    const self = this;
    const pipe: any = {
      set(k: string, v: string, mode?: string) {
        ops.push(() => { if (!(mode === 'NX' && self.kv.has(k))) self.kv.set(k, v); });
        return pipe;
      },
      sadd(k: string, m: string) { ops.push(() => { void self.sadd(k, m); }); return pipe; },
      srem(k: string, m: string) { ops.push(() => { void self.srem(k, m); }); return pipe; },
      del(k: string) { ops.push(() => { void self.del(k); }); return pipe; },
      async exec() { ops.forEach((op) => op()); return []; },
    };
    return pipe;
  }
}

describe('login-time domain auto-join', () => {
  const originalMode = process.env.ANT_SERVER_MODE;
  const originalFrontend = process.env.FRONTEND_URL;

  let redis: FakeRedis;
  let repo: InstanceType<typeof RedisOrganizationRepository>;
  let server: http.Server | undefined;
  let baseUrl = '';
  let oidcEmail = 'bob@acme.com';
  const madeDirs: string[] = [];

  function makeJwtService() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return new JwtService({
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
  }

  async function startApp(): Promise<void> {
    const app = express();
    app.use(cookieParser());
    app.use(
      '/api',
      createAuthRoutes({
        authService: {} as any,
        // Workspace creation is a real mkdir — point it at a temp path.
        workspaceResolver: {
          getWorkspacePath: ({ organizationId, userId }: any) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-signup-'));
            madeDirs.push(root);
            return path.join(root, organizationId, userId);
          },
        } as any,
        jwtService: makeJwtService(),
        organizationRepository: repo,
        stateStore: {
          getKey: async () => '1',
          deleteKey: async () => undefined,
        } as any,
        oidcService: {
          authenticateWithCode: async () => ({
            email: oidcEmail,
            emailVerified: true,
            sub: 'oauth-sub',
            name: 'Bob',
          }),
        } as any,
      }),
    );
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server!.address();
    if (!address || typeof address === 'string') throw new Error('bind failed');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  /** Drive one OAuth callback (= one login) and return the resulting user row. */
  async function login(email: string) {
    oidcEmail = email;
    const res = await fetch(`${baseUrl}/api/auth/google/callback?code=c&state=s`, {
      redirect: 'manual',
    });
    expect(res.status).toBeGreaterThanOrEqual(300);
    return repo.getUser(email.toLowerCase());
  }

  /** An 'acme' team owning a VERIFIED claim on acme.com. */
  async function seedTeamWithVerifiedDomain(autoJoin?: boolean): Promise<void> {
    await repo.createOrganization({
      id: 'acme',
      name: 'Acme',
      kind: 'team',
      ownerId: 'kim@acme.com',
    });
    await repo.attachMembership({ userId: 'kim@acme.com', organizationId: 'acme', role: 'owner' });
    await repo.createDomainClaim({
      domain: 'acme.com',
      organizationId: 'acme',
      claimedBy: 'kim@acme.com',
      verificationToken: 't',
      status: 'verified',
      ...(autoJoin === undefined ? {} : { autoJoin }),
      autoJoinRole: 'member',
      createdAt: new Date().toISOString(),
    });
  }

  beforeEach(async () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.FRONTEND_URL = 'http://127.0.0.1:4200';
    redis = new FakeRedis();
    repo = new RedisOrganizationRepository(redis as any);
    await startApp();
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    while (madeDirs.length) fs.rmSync(madeDirs.pop()!, { recursive: true, force: true });
    if (originalMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = originalMode;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  it('a brand-new account joins the team AND lands in it as the active org', async () => {
    await seedTeamWithVerifiedDomain();
    const user = await login('bob@acme.com');
    expect((await repo.getMembership('bob@acme.com', 'acme'))?.role).toBe('member');
    expect(user?.currentOrganizationId).toBe('acme');
    // no backfill notice — the account is already sitting in the team
    expect(user?.lastDomainAutoJoin).toBeUndefined();
  });

  it('backfill: an EXISTING account gets the membership, keeps its active org, and is stamped', async () => {
    // First login predates the claim.
    const before = await login('bob@acme.com');
    expect(before?.currentOrganizationId).toBe('individual');
    expect(await repo.getMembership('bob@acme.com', 'acme')).toBeNull();

    await seedTeamWithVerifiedDomain();

    const after = await login('bob@acme.com');
    expect((await repo.getMembership('bob@acme.com', 'acme'))?.role).toBe('member');
    expect(after?.currentOrganizationId).toBe('individual');
    expect(after?.lastDomainAutoJoin).toMatchObject({ organizationId: 'acme', domain: 'acme.com' });
  });

  it('is idempotent across logins (no duplicate membership, role preserved)', async () => {
    await seedTeamWithVerifiedDomain();
    await login('bob@acme.com');
    await repo.setMembershipRole('bob@acme.com', 'acme', 'admin');
    await login('bob@acme.com');
    expect((await repo.getMembership('bob@acme.com', 'acme'))?.role).toBe('admin');
    expect(await repo.listMembershipsByUser('bob@acme.com')).toHaveLength(2);
  });

  it('autoJoin=false grants nothing (the banner is the offer instead)', async () => {
    await seedTeamWithVerifiedDomain(false);
    const user = await login('bob@acme.com');
    expect(await repo.getMembership('bob@acme.com', 'acme')).toBeNull();
    expect(user?.currentOrganizationId).toBe('individual');
  });

  it('an unverified claim grants nothing', async () => {
    await repo.createOrganization({ id: 'acme', name: 'Acme', kind: 'team', ownerId: 'kim@acme.com' });
    await repo.createDomainClaim({
      domain: 'acme.com',
      organizationId: 'acme',
      claimedBy: 'kim@acme.com',
      verificationToken: 't',
      status: 'pending',
      autoJoinRole: 'member',
      createdAt: new Date().toISOString(),
    });
    await login('bob@acme.com');
    expect(await repo.getMembership('bob@acme.com', 'acme')).toBeNull();
  });

  it('a removal row survives the next login (an admin removal is not undone)', async () => {
    await seedTeamWithVerifiedDomain();
    await login('bob@acme.com');
    await repo.removeMembership('bob@acme.com', 'acme', {
      record: { removedBy: 'kim@acme.com', reason: 'removed' },
    });

    const user = await login('bob@acme.com');
    expect(await repo.getMembership('bob@acme.com', 'acme')).toBeNull();
    expect(user?.currentOrganizationId).toBe('individual');
  });

  it('a soft-deleted org grants nothing', async () => {
    await seedTeamWithVerifiedDomain();
    await repo.softDeleteOrganization('acme', 'op@ant.dev');
    await login('bob@acme.com');
    expect(await repo.getMembership('bob@acme.com', 'acme')).toBeNull();
  });

  it('a non-matching email host grants nothing', async () => {
    await seedTeamWithVerifiedDomain();
    await login('sam@other.io');
    expect(await repo.getMembership('sam@other.io', 'acme')).toBeNull();
  });

  it('a repo failure in the domain check does NOT cost the user their login', async () => {
    await seedTeamWithVerifiedDomain();
    const spy = vi
      .spyOn(repo, 'getDomainClaim')
      .mockRejectedValue(new Error('redis down'));
    const user = await login('bob@acme.com');
    expect(user?.currentOrganizationId).toBe('individual');
    expect(await repo.getMembership('bob@acme.com', 'individual')).not.toBeNull();
    spy.mockRestore();
  });

  it('writes the removal row under the documented key prefix', async () => {
    await seedTeamWithVerifiedDomain();
    await login('bob@acme.com');
    await repo.removeMembership('bob@acme.com', 'acme', {
      record: { removedBy: 'kim@acme.com', reason: 'removed' },
    });
    expect(redis.hashes.has(`${REDIS_KEYS.AUTH.ORG_REMOVED}acme`)).toBe(true);
  });
});

// ── Tombstones: the org-onboarding flow is gone ──────────────────────────────

describe('retired onboarding seam', () => {
  const gone = [
    'src/periphery/adapters/http/middleware/requireOnboardedJwt.ts',
    '../ant-ui/src/presentation/components/auth/OrganizationOnboardingScreen.tsx',
    '../ant-ui/src/application/auth/onboardingRouter.ts',
  ];

  it('the deleted files stay deleted', () => {
    for (const rel of gone) {
      expect(fs.existsSync(path.join(repoRoot, rel))).toBe(false);
    }
  });

  it('no route mints or answers the `_pending` onboarding flow', () => {
    const authRoutes = fs.readFileSync(
      path.join(repoRoot, 'src/periphery/adapters/http/routes/auth.routes.ts'),
      'utf-8',
    );
    expect(authRoutes).not.toMatch(/auth\/onboarding\/organization/);
    // The sentinel survives ONLY as a read-side guard for legacy rows.
    expect(authRoutes).not.toMatch(/org:\s*PENDING_ORG_SENTINEL/);
  });
});
