/**
 * Account purge — the engine's step order and the three hazards it exists for.
 *
 * 1. A purged identity must NOT read as `approved`. `getUserApproval` defaults
 *    a MISSING record to `approved` (legacy backfill), and JWTs are stateless
 *    with no denylist — without the tombstone a purged account's cookie keeps
 *    working for days and its desktop token for 90.
 * 2. `upsertUser` must not resurrect an admin-purged identity at the next
 *    OAuth callback (it would restore the email/name/picture just removed).
 * 3. A team member's PERSONAL data anchors under `individual/`, not under the
 *    team org — `resolveTenantUserDir`. Sweeping only the membership orgs
 *    leaves the encrypted credential store on disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Redis from 'ioredis';
import {
  RedisOrganizationRepository,
  PurgedAccountError,
} from '../../src/infrastructure/auth/RedisOrganizationRepository';
import { purgeAccount, resolvePurgeScopes } from '../../src/core/account/purgeAccount';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';
import type { UserContext } from '../../src/core/types/user';

class FakeRedis {
  kv = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, string>>();
  async get(key: string) {
    return this.kv.get(key) ?? null;
  }
  async set(key: string, value: string, mode?: string) {
    if (mode === 'NX' && this.kv.has(key)) return null;
    this.kv.set(key, value);
    return 'OK' as const;
  }
  async del(key: string) {
    return this.kv.delete(key) ? 1 : 0;
  }
  async smembers(key: string) {
    return Array.from(this.sets.get(key) ?? []);
  }
  async sadd(key: string, ...members: string[]) {
    const s = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hset(key: string, field: string, value: string) {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    h.set(field, value);
    this.hashes.set(key, h);
    return 1;
  }
  async hdel(key: string, field: string) {
    return this.hashes.get(key)?.delete(field) ? 1 : 0;
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async scan(): Promise<[string, string[]]> {
    return ['0', []];
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
      sadd: (k: string, m: string) => (ops.push(() => void self.sadd(k, m)), p),
      srem: (k: string, m: string) => (ops.push(() => void self.srem(k, m)), p),
      del: (k: string) => (ops.push(() => void self.del(k)), p),
      exec: async () => (ops.forEach((o) => o()), ops.map(() => [null, 'OK'])),
    };
    return p;
  }
}

const USER = { id: 'lee@acme.com', email: 'lee@acme.com' };
const ADMIN = 'root@ant.dev';

let repo: RedisOrganizationRepository;
let workspacesPath = '';
/** Every (orgId, projectId) the fake project service was asked to delete. */
let deleted: Array<{ orgId: string; projectId: string; force?: boolean }> = [];

/** The purge only ever asks the ledger for scopes; nothing else is exercised. */
const ledger = { listAccountScopes: async () => [] } as unknown as CreditLedgerPort;

function projectService(fail?: string) {
  return {
    async listProjects(ctx: UserContext): Promise<string[]> {
      const dir = path.join(workspacesPath, ctx.organizationId, ctx.userId);
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== '.ant')
        .map((d) => d.name);
    },
    async deleteProject(id: string, ctx: UserContext, opts?: { force?: boolean }) {
      if (id === fail) throw new Error('IDE pod still holding handles');
      deleted.push({ orgId: ctx.organizationId, projectId: id, force: opts?.force });
      await fs.promises.rm(path.join(workspacesPath, ctx.organizationId, ctx.userId, id), {
        recursive: true,
        force: true,
      });
    },
  };
}

function deps(ps = projectService()) {
  return {
    organizationRepository: repo,
    creditLedger: ledger,
    workspacesPath,
    projectService: ps,
  };
}

/** `lee` in individual + team-a, with a project in each and personal files. */
async function seed(): Promise<void> {
  await repo.upsertUser({ ...USER, currentOrganizationId: 'team-a' });
  for (const [orgId, kind] of [
    ['individual', 'individual'],
    ['team-a', 'team'],
  ] as const) {
    await repo.createOrganization({ id: orgId, name: orgId, kind, ownerId: 'other@acme.com' });
    await repo.attachMembership({ userId: USER.id, organizationId: orgId, role: 'member' });
  }
  for (const orgId of ['individual', 'team-a']) {
    fs.mkdirSync(path.join(workspacesPath, orgId, USER.id, `proj-${orgId}`), { recursive: true });
  }
  // Personal data anchors under individual/ even for the team membership.
  const antDir = path.join(workspacesPath, 'individual', USER.id, '.ant');
  fs.mkdirSync(path.join(antDir, 'agents', 'my-agent'), { recursive: true });
  fs.writeFileSync(path.join(antDir, 'credentials.json'), '{"GITHUB_PAT":"ghp_secret"}');
  fs.writeFileSync(path.join(antDir, 'encryption.key'), 'key');
  fs.writeFileSync(path.join(workspacesPath, 'individual', USER.id, 'user-config.json'), '{}');
}

beforeEach(async () => {
  vi.stubEnv('ANT_SUPER_ADMIN_EMAILS', ADMIN);
  repo = new RedisOrganizationRepository(new FakeRedis() as unknown as Redis);
  workspacesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-purge-'));
  deleted = [];
});

afterEach(() => {
  fs.rmSync(workspacesPath, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

// ---------- Scope resolution ----------

describe('resolvePurgeScopes', () => {
  it('always includes individual — a team member anchors personal data there', async () => {
    await repo.upsertUser({ ...USER, currentOrganizationId: 'team-a' });
    await repo.createOrganization({ id: 'team-a', name: 'A', kind: 'team', ownerId: USER.id });
    await repo.attachMembership({ userId: USER.id, organizationId: 'team-a', role: 'member' });

    expect(
      (await resolvePurgeScopes({ organizationRepository: repo, creditLedger: ledger }, USER.id)).sort(),
    ).toEqual(['individual', 'team-a']);
  });

  it('picks up a ledger scope whose membership is already gone', async () => {
    await repo.upsertUser({ ...USER, currentOrganizationId: 'individual' });
    const withLedger = { listAccountScopes: async () => ['dead-org'] } as unknown as CreditLedgerPort;

    expect(
      (await resolvePurgeScopes({ organizationRepository: repo, creditLedger: withLedger }, USER.id)).sort(),
    ).toEqual(['dead-org', 'individual']);
  });
});

// ---------- The cascade ----------

describe('purgeAccount — full', () => {
  it('deletes every project through the lifecycle cascade, with force', async () => {
    await seed();
    const report = await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    expect(report.ok).toBe(true);
    expect(deleted.map((d) => `${d.orgId}/${d.projectId}`).sort()).toEqual([
      'individual/proj-individual',
      'team-a/proj-team-a',
    ]);
    // force: a stuck IDE pod must not strand the purge halfway.
    expect(deleted.every((d) => d.force === true)).toBe(true);
  });

  it('removes the credential store anchored under individual/ for a team member', async () => {
    await seed();
    const credentials = path.join(workspacesPath, 'individual', USER.id, '.ant', 'credentials.json');
    expect(fs.existsSync(credentials)).toBe(true);

    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    expect(fs.existsSync(credentials)).toBe(false);
    expect(fs.existsSync(path.join(workspacesPath, 'individual', USER.id))).toBe(false);
  });

  it('detaches every membership and tombstones the identity', async () => {
    await seed();
    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    expect(await repo.listMembershipsByUser(USER.id)).toEqual([]);
    expect(await repo.getUser(USER.id)).toBeNull();
    expect(await repo.getUserByEmail(USER.email)).toBeNull();
    expect(await repo.getUserPurge(USER.id)).toMatchObject({
      reason: 'admin-purge',
      purgedBy: ADMIN,
    });
  });

  it('reports a failed step instead of throwing, so the rest still runs', async () => {
    await seed();
    const report = await purgeAccount(deps(projectService('proj-team-a')), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.step === 'projects')).toMatchObject({ ok: false });
    // The identity step still ran — a partial purge must still be locked out.
    expect(report.steps.find((s) => s.step === 'identity')?.ok).toBe(true);
    expect(await repo.getUserPurge(USER.id)).not.toBeNull();
  });

  it('prunes org ACL rows naming the purged user', async () => {
    await seed();
    const aclDir = path.join(workspacesPath, 'team-a', '.ant');
    fs.mkdirSync(aclDir, { recursive: true });
    fs.writeFileSync(
      path.join(aclDir, 'agent-acl.json'),
      JSON.stringify({
        mine: { owner: USER.id, editors: [USER.id, 'keep@acme.com'] },
        theirs: { owner: 'keep@acme.com', editors: ['keep@acme.com'] },
      }),
    );

    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    const acl = JSON.parse(fs.readFileSync(path.join(aclDir, 'agent-acl.json'), 'utf-8'));
    expect(acl.mine.owner).toBeUndefined();
    expect(acl.mine.editors).toEqual(['keep@acme.com']);
    expect(acl.theirs).toEqual({ owner: 'keep@acme.com', editors: ['keep@acme.com'] });
  });
});

describe('purgeAccount — data-only (POST /user/reset)', () => {
  it('deletes the data but keeps the account working', async () => {
    await seed();
    const report = await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: USER.id,
      reason: 'self-withdrawal',
      mode: 'data-only',
    });

    expect(report.ok).toBe(true);
    expect(deleted).toHaveLength(2);
    expect(report.steps.map((s) => s.step)).toEqual(['projects', 'userFiles', 'redisState']);
    // Identity and memberships are untouched — this is a reset, not a withdrawal.
    expect(await repo.getUser(USER.id)).not.toBeNull();
    expect(await repo.getUserPurge(USER.id)).toBeNull();
    expect(await repo.listMembershipsByUser(USER.id)).toHaveLength(2);
  });
});

// ---------- Hazard (a): the approval default ----------

describe('a purged identity is denied, not approved-by-default', () => {
  it('an unknown id still defaults to approved (legacy accounts were never pended)', async () => {
    expect(await repo.getUserApproval('never-seen@acme.com')).toBe('approved');
  });

  it('a purged id reads denied, which is what invalidates a live cookie or desktop token', async () => {
    await seed();
    expect(await repo.getUserApproval(USER.id)).toBe('approved');

    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    expect(await repo.getUser(USER.id)).toBeNull();
    expect(await repo.getUserApproval(USER.id)).toBe('denied');
  });

  it('lifting the tombstone re-opens the identity', async () => {
    await seed();
    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    await repo.clearUserPurge(USER.id);
    expect(await repo.getUserApproval(USER.id)).toBe('approved');
  });
});

// ---------- Hazard (b): login must not resurrect ----------

describe('upsertUser honours the tombstone', () => {
  it('refuses an admin-purged identity rather than restoring its PII', async () => {
    await seed();
    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: ADMIN,
      reason: 'admin-purge',
      mode: 'full',
    });

    await expect(
      repo.upsertUser({ ...USER, name: 'Lee', currentOrganizationId: 'individual' }),
    ).rejects.toBeInstanceOf(PurgedAccountError);
    expect(await repo.getUser(USER.id)).toBeNull();
  });

  it('lets a self-withdrawn person sign up again as a fresh account', async () => {
    await seed();
    await purgeAccount(deps(), {
      userId: USER.id,
      purgedBy: USER.id,
      reason: 'self-withdrawal',
      mode: 'full',
    });

    const fresh = await repo.upsertUser({ ...USER, currentOrganizationId: 'individual' });
    expect(fresh.id).toBe(USER.id);
    expect(await repo.getUserPurge(USER.id)).toBeNull();
    expect(await repo.getUserApproval(USER.id)).toBe('approved');
  });
});
