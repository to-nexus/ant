/**
 * Tenant scoping — a resource keyed by user-chosen identifiers must also be
 * keyed by its owner, and a cross-tenant setting must not be honoured.
 *
 * One axis, three rules:
 *
 *   - `jobsByFeature` index (report H-006): `projectId` / `featureName` are
 *     user-chosen and collide across tenants. A tenantless key surfaced one
 *     tenant's running job in another's duplicate check — leaking the job id
 *     and blocking the second tenant from starting their own job.
 *   - `assertJobAccess` (report H-006): a `jobId`-addressed route may only be
 *     served to the job's owner.
 *   - `repoType: 'local'` (report C-004): a caller-chosen absolute codebase
 *     path is the local-mode workflow, never a cloud one — refused on write
 *     AND ignored on read, so a config predating the gate stays inert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ALICE = { organizationId: 'acme', userId: 'alice' };
const BOB = { organizationId: 'acme', userId: 'bob' };

// ────────────────────────────────────────────────────────────────────────────
// jobsByFeature index
// ────────────────────────────────────────────────────────────────────────────

/**
 * Minimal in-memory Redis. Only the commands the job-index paths use — enough
 * that the REAL RedisStateStore key construction is what's under test.
 */
class FakeRedis {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();

  async set(key: string, value: string) { this.strings.set(key, value); return 'OK'; }
  async get(key: string) { return this.strings.get(key) ?? null; }
  async mget(...keys: string[]) { return keys.map(k => this.strings.get(k) ?? null); }
  async del(key: string) { this.strings.delete(key); this.sets.delete(key); return 1; }
  async sadd(key: string, member: string) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key)!.add(member);
    return 1;
  }
  async srem(key: string, member: string) { this.sets.get(key)?.delete(member); return 1; }
  async smembers(key: string) { return Array.from(this.sets.get(key) ?? []); }
  async expire() { return 1; }
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: any = {
      set: (k: string, v: string) => { ops.push(() => this.set(k, v)); return chain; },
      sadd: (k: string, m: string) => { ops.push(() => this.sadd(k, m)); return chain; },
      srem: (k: string, m: string) => { ops.push(() => this.srem(k, m)); return chain; },
      del: (k: string) => { ops.push(() => this.del(k)); return chain; },
      expire: () => { ops.push(() => this.expire()); return chain; },
      exec: async () => { for (const op of ops) await op(); return []; },
    };
    return chain;
  }
}

async function makeStore() {
  const { RedisStateStore } = await import('../../src/infrastructure/state/RedisStateStore.js');
  const store = Object.create(RedisStateStore.prototype) as any;
  const redis = new FakeRedis();
  store.redis = redis;
  return { store, redis };
}

const job = (jobId: string, userContext: typeof ALICE) => ({
  jobId,
  status: 'running' as const,
  projectId: 'shared-name',   // deliberately identical across tenants
  featureName: 'main',        // deliberately identical across tenants
  type: 'code' as const,
  userContext,
});

describe('jobsByFeature index is tenant-scoped (H-006)', () => {
  it("one tenant's running job is invisible to another's lookup", async () => {
    const { store } = await makeStore();
    await store.setJobStatus('alice-job', job('alice-job', ALICE));
    await store.setJobStatus('bob-job', job('bob-job', BOB));

    const aliceJobs = await store.listJobsByFeature(ALICE, 'shared-name', 'main');
    const bobJobs = await store.listJobsByFeature(BOB, 'shared-name', 'main');

    expect(aliceJobs.map((j: any) => j.jobId)).toEqual(['alice-job']);
    expect(bobJobs.map((j: any) => j.jobId)).toEqual(['bob-job']);
  });

  it('the owner still sees their own job (no over-scoping)', async () => {
    const { store } = await makeStore();
    await store.setJobStatus('alice-job', job('alice-job', ALICE));
    expect(await store.listJobsByFeature(ALICE, 'shared-name', 'main')).toHaveLength(1);
  });

  it('the index key carries organization and user', async () => {
    const { store, redis } = await makeStore();
    await store.setJobStatus('alice-job', job('alice-job', ALICE));
    const indexKeys = Array.from(redis.sets.keys());
    expect(indexKeys).toHaveLength(1);
    expect(indexKeys[0]).toContain('acme:alice:shared-name:main');
  });

  it('a job with no userContext resolves to the local tenant', async () => {
    const { store } = await makeStore();
    await store.setJobStatus('local-job', { ...job('local-job', ALICE), userContext: undefined });
    const local = await store.listJobsByFeature({ organizationId: 'local', userId: 'local' }, 'shared-name', 'main');
    expect(local.map((j: any) => j.jobId)).toEqual(['local-job']);
    expect(await store.listJobsByFeature(ALICE, 'shared-name', 'main')).toHaveLength(0);
  });

  it('deleting a job removes it from its own tenant index only', async () => {
    const { store } = await makeStore();
    await store.setJobStatus('alice-job', job('alice-job', ALICE));
    await store.setJobStatus('bob-job', job('bob-job', BOB));
    await store.deleteJobStatus('alice-job');

    expect(await store.listJobsByFeature(ALICE, 'shared-name', 'main')).toHaveLength(0);
    expect(await store.listJobsByFeature(BOB, 'shared-name', 'main')).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// jobId-addressed route ownership
// ────────────────────────────────────────────────────────────────────────────

describe('assertJobAccess gates jobId-addressed routes (H-006)', () => {
  /**
   * Two owner records with independent lifetimes: job status expires on its own
   * TTL, the mapping is refreshed alongside every workflow-state write. Either
   * one identifies the owner; only the absence of BOTH means "untracked".
   */
  const store = (records: { status?: typeof ALICE; mapping?: typeof ALICE }) => ({
    getJobStatus: async () =>
      records.status ? { jobId: 'j1', userContext: records.status } : null,
    getJobMapping: async () =>
      records.mapping
        ? { projectId: 'p', featureName: 'main', jobType: 'code', userContext: records.mapping }
        : null,
  });
  const stateStore = (owner: typeof ALICE | undefined) =>
    store(owner ? { status: owner, mapping: owner } : {});

  const withMode = async (mode: 'cloud' | 'local', run: () => Promise<void>) => {
    vi.stubEnv('ANT_SERVER_MODE', mode);
    vi.resetModules();
    try { await run(); } finally { vi.unstubAllEnvs(); }
  };

  it('cloud: denies a caller who does not own the job', async () => {
    await withMode('cloud', async () => {
      const { assertJobAccess } = await import('../../src/periphery/adapters/http/routes/helpers/jobAccess.js');
      const denial = await assertJobAccess(stateStore(ALICE) as any, 'j1', BOB);
      expect(denial?.code).toBe(403);
    });
  });

  it('cloud: allows the owner', async () => {
    await withMode('cloud', async () => {
      const { assertJobAccess } = await import('../../src/periphery/adapters/http/routes/helpers/jobAccess.js');
      expect(await assertJobAccess(stateStore(ALICE) as any, 'j1', ALICE)).toBeNull();
    });
  });

  it('cloud: allows an untracked job (no Redis record)', async () => {
    await withMode('cloud', async () => {
      const { assertJobAccess } = await import('../../src/periphery/adapters/http/routes/helpers/jobAccess.js');
      expect(await assertJobAccess(stateStore(undefined) as any, 'j1', BOB)).toBeNull();
    });
  });

  it('cloud: the mapping still identifies the owner after the status expires', async () => {
    await withMode('cloud', async () => {
      const { assertJobAccess } = await import('../../src/periphery/adapters/http/routes/helpers/jobAccess.js');
      const outlived = store({ mapping: ALICE });
      expect((await assertJobAccess(outlived as any, 'j1', BOB))?.code).toBe(403);
      expect(await assertJobAccess(outlived as any, 'j1', ALICE)).toBeNull();
    });
  });

  it('local: single tenant, always allowed', async () => {
    await withMode('local', async () => {
      const { assertJobAccess } = await import('../../src/periphery/adapters/http/routes/helpers/jobAccess.js');
      expect(await assertJobAccess(stateStore(ALICE) as any, 'j1', BOB)).toBeNull();
    });
  });

  it('cloud: the workflow REST route applies the gate before reading state', async () => {
    await withMode('cloud', async () => {
      const { createWorkflowRoutes } = await import('../../src/periphery/adapters/http/routes/workflow.routes.js');
      const workflowStateService = { getState: vi.fn(async () => ({ activeNodes: ['plan'] })) };
      const router: any = createWorkflowRoutes({
        graphMetadataService: {} as any,
        workflowStateService: workflowStateService as any,
        stateStore: store({ status: ALICE, mapping: ALICE }) as any,
      });

      const handler = router.stack
        .find((l: any) => l.route?.path === '/jobs/:jobId/workflow/state')
        .route.stack[0].handle;

      const call = async (caller: typeof ALICE) => {
        const res: any = { statusCode: 200, body: undefined,
          status(code: number) { this.statusCode = code; return this; },
          json(payload: unknown) { this.body = payload; return this; } };
        await handler(
          {
            params: { jobId: 'j1' },
            headers: {},
            user: { id: caller.userId },
            organization: { id: caller.organizationId },
          } as any,
          res,
        );
        return res;
      };

      const denied = await call(BOB);
      expect(denied.statusCode).toBe(403);
      expect(workflowStateService.getState).not.toHaveBeenCalled();

      const allowed = await call(ALICE);
      expect(allowed.statusCode).toBe(200);
      expect(allowed.body).toEqual({ activeNodes: ['plan'] });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// repoType: 'local'
// ────────────────────────────────────────────────────────────────────────────

describe("repoType 'local' is honoured in local mode only (C-004)", () => {
  let projectPath: string;
  let featurePath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-repotype-'));
    featurePath = path.join(projectPath, 'features', 'main');
    fs.mkdirSync(featurePath, { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ repoType: 'local', localPath: '/somewhere/else' }),
    );
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('local mode: the configured localPath is used', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'local');
    vi.resetModules();
    const { resolveCodebasePathFromConfig } = await import('../../src/core/config/WorkspacePathResolver.js');
    expect(resolveCodebasePathFromConfig(projectPath, featurePath)).toBe('/somewhere/else');
  });

  it('cloud mode: a stored localPath is ignored, the feature worktree wins', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    vi.resetModules();
    const { resolveCodebasePathFromConfig } = await import('../../src/core/config/WorkspacePathResolver.js');
    expect(resolveCodebasePathFromConfig(projectPath, featurePath)).toBe(path.join(featurePath, 'codebase'));
  });

  it('cloud mode: writing repoType local is refused', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    vi.resetModules();
    const { ProjectCrudService } = await import('../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService.js');
    const svc = Object.create(ProjectCrudService.prototype) as any;
    await expect(
      svc.updateProjectConfig('p1', { repoType: 'local', localPath: '/etc' }, ALICE),
    ).rejects.toThrow(/Invalid config/);
    await expect(
      svc.updateProjectConfig('p1', { localPath: '/etc' }, ALICE),
    ).rejects.toThrow(/Invalid config/);
  });

  it('cloud mode: an ordinary config update is unaffected', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    vi.resetModules();
    const { ProjectCrudService } = await import('../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService.js');
    const svc = Object.create(ProjectCrudService.prototype) as any;
    svc.workspaceResolver = { getProjectPath: () => projectPath, getGitAnchorPath: () => projectPath };
    await expect(
      svc.updateProjectConfig('p1', { repoType: 'cloud', description: 'ok' }, ALICE),
    ).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Vector memory collections (M-006)
// ────────────────────────────────────────────────────────────────────────────

describe('vector memory collections are tenant-scoped in a shared deployment (M-006)', () => {
  // `projectId` is unique per tenant, not globally, so two orgs picking the
  // same project name shared one Chroma collection — readable and poisonable
  // across the boundary.
  const BOB_SCOPE = { organizationId: 'globex', userId: 'bob' };
  const ALICE_SCOPE = { organizationId: 'acme', userId: 'alice' };

  it('separates two tenants that chose the same project name', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    expect(getCollectionName('codebase', 'shop', ALICE_SCOPE))
      .not.toBe(getCollectionName('codebase', 'shop', BOB_SCOPE));
  });

  it('is stable for the same tenant and project', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    expect(getCollectionName('codebase', 'shop', ALICE_SCOPE))
      .toBe(getCollectionName('codebase', 'shop', { ...ALICE_SCOPE }));
  });

  it('still separates collection types within one tenant', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    expect(getCollectionName('codebase', 'shop', ALICE_SCOPE))
      .not.toBe(getCollectionName('lessons', 'shop', ALICE_SCOPE));
  });

  it('produces a Chroma-legal name from an email userId', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    const name = getCollectionName('codebase', 'shop', { organizationId: 'acme', userId: 'alice@corp.com' });
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('stays within 63 chars for a long project name', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    expect(getCollectionName('codebase', 'p'.repeat(120), ALICE_SCOPE).length).toBeLessThanOrEqual(63);
  });

  it('local mode keeps the legacy unscoped name (one tenant, no reindex)', async () => {
    const { getCollectionName } = await import('../../src/core/types/agent.js');
    expect(getCollectionName('codebase', 'shop')).toBe('codebase-shop');
    expect(getCollectionName('codebase', 'shop', null)).toBe('codebase-shop');
  });

  it('the factory scopes in cloud mode and does not in local mode', async () => {
    for (const [mode, expectScoped] of [['cloud', true], ['local', false]] as const) {
      vi.stubEnv('ANT_SERVER_MODE', mode);
      vi.stubEnv('ANT_VECTOR_DB_ENABLED', '1');
      vi.resetModules();
      const { AdapterFactory } = await import('../../src/infrastructure/adapters/AdapterFactory.js');
      const adapter = AdapterFactory.createMemoryAdapter(ALICE) as any;
      expect(Boolean(adapter.tenantScope), mode).toBe(expectScoped);
      vi.unstubAllEnvs();
    }
  });
});
