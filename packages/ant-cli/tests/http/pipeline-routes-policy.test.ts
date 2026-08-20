/**
 * Pipeline routes (`/api/pipelines`) — the scoped-definition + availability +
 * multi-activation contract: create lands DISABLED in the personal root,
 * enable requires a valid def, PUT/DELETE/promote refuse while enabled,
 * disable refuses while ANY activation exists (never cascades), activate
 * gates in order (disabled / non-universal project / project taken / live
 * job), a pipeline activates onto MANY projects, org promote MOVEs the dir
 * with ACL-first bookkeeping, and per-caller readonly decoration.
 *
 * No supertest: real Express app + node:http on port 0, called via fetch
 * (account-agent-routes precedent). Coordinator/queue/stateStore are minimal
 * fakes — this file tests the ROUTE policy, not the scheduler.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import http from 'node:http';
import express from 'express';
import { createPipelinesRoutes } from '../../src/periphery/adapters/http/routes/pipelines.routes';
import type { OrganizationRepositoryPort } from '../../src/core/ports/organizationRepository';
import type { OrgMembershipRole } from '@ant/shared';

let wsRoot: string;
let userDir: string;
let server: http.Server;
let baseUrl: string;
let liveJobs: Array<{ jobId: string; status: string; type?: string }> = [];
const cronUpserts: string[] = [];
const cronRemoved: string[] = [];

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/pipelines${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const DEF = (name = 'Digest') => ({
  version: 2,
  name,
  on: { schedule: { cron: '0 9 * * 1', tz: 'Asia/Seoul' } },
  steps: [{ id: 'collect', customJobRef: 'research/collect', directive: 'Collect sources' }],
});

function fakeOrgRepo(memberships: Map<string, OrgMembershipRole>, orgId = 'localorg'): OrganizationRepositoryPort {
  return {
    getOrganization: async (id: string) =>
      id === orgId ? ({ id, name: 'Org', kind: 'team', ownerId: null, createdAt: new Date().toISOString() } as any) : null,
    getMembership: async (userId: string, org: string) =>
      org === orgId && memberships.has(userId)
        ? ({ userId, organizationId: org, role: memberships.get(userId)!, createdAt: new Date().toISOString() } as any)
        : null,
  } as unknown as OrganizationRepositoryPort;
}

function makeUniversalProject(id: string): void {
  const dir = path.join(userDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ projectType: 'universal' }));
}

beforeAll(async () => {
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-pipeline-routes-'));
  process.env.ANT_LOCAL_ORG = 'localorg';
  process.env.ANT_LOCAL_USER = 'localuser';
  userDir = path.join(wsRoot, 'localorg', 'localuser');
  fs.mkdirSync(userDir, { recursive: true });

  const resolver = {
    getPhysicalWorkspacesPath: () => wsRoot,
    getWorkspacePath: () => userDir,
    getProjectPath: (_uc: unknown, projectId: string) => path.join(userDir, projectId),
  };
  const coordinator = {
    getActiveRunId: async () => null,
    getRun: async () => null,
    listPendingApprovals: async () => [],
    getHitlByGateId: async () => null,
    applyResolvedGate: async () => true,
    cancelRun: async () => false,
    readRunFromDisk: () => null,
    deactivate: async () => {},
  };
  const scheduleQueue = {
    upsertCron: async (id: string) => void cronUpserts.push(id),
    removeCron: async (id: string) => void cronRemoved.push(id),
    listCronIds: async () => [],
    armDelayed: async () => {},
    cancelDelayed: async () => {},
    addNow: async () => {},
    close: async () => {},
  };
  const stateStore = {
    listJobsByFeature: async () => liveJobs,
    setKeyWithTTL: async () => {},
    deleteKey: async () => {},
    getKey: async () => null,
    publish: async () => {},
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/pipelines',
    createPipelinesRoutes({
      workspaceResolver: resolver as any,
      coordinator: coordinator as any,
      scheduleQueue: scheduleQueue as any,
      stateStore: stateStore as any,
      organizationRepository: fakeOrgRepo(new Map()),
    }),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(wsRoot, { recursive: true, force: true });
  delete process.env.ANT_LOCAL_ORG;
  delete process.env.ANT_LOCAL_USER;
});

beforeEach(() => {
  liveJobs = [];
  cronUpserts.length = 0;
  cronRemoved.length = 0;
  fs.rmSync(path.join(userDir, '.ant'), { recursive: true, force: true });
  for (const entry of fs.readdirSync(userDir)) {
    if (entry !== '.ant') fs.rmSync(path.join(userDir, entry), { recursive: true, force: true });
  }
});

async function createPipeline(id = 'digest'): Promise<void> {
  const res = await api('', { method: 'POST', body: JSON.stringify({ id, def: DEF() }) });
  expect(res.status).toBe(201);
}

async function enable(id = 'digest'): Promise<void> {
  const res = await api(`/${id}/enable`, { method: 'POST' });
  expect(res.status).toBe(200);
}

async function activate(id: string, projectId: string): Promise<Response> {
  return api(`/${id}/activate`, { method: 'POST', body: JSON.stringify({ projectId }) });
}

describe('availability state machine', () => {
  it('create lands DISABLED (draft) in the personal root with the availability sidecar', async () => {
    await createPipeline();
    const sidecar = path.join(userDir, '.ant/pipelines/digest/availability.json');
    expect(JSON.parse(fs.readFileSync(sidecar, 'utf-8')).enabled).toBe(false);
    const list = await (await api('')).json();
    expect(list.pipelines[0]).toMatchObject({ id: 'digest', scope: 'user', readonly: false, enabled: false, activations: [] });
  });

  it('enable requires a valid definition (broken draft answers 400 invalid-pipeline-def)', async () => {
    await createPipeline();
    fs.writeFileSync(path.join(userDir, '.ant/pipelines/digest/pipeline.yaml'), 'version: 1\n');
    const res = await api('/digest/enable', { method: 'POST' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid-pipeline-def');
  });

  it('PUT and DELETE answer 409 pipeline-enabled while enabled; disabled edits succeed', async () => {
    await createPipeline();
    await enable();
    const put = await api('/digest', { method: 'PUT', body: JSON.stringify({ def: DEF('Renamed') }) });
    expect(put.status).toBe(409);
    expect((await put.json()).code).toBe('pipeline-enabled');
    const del = await api('/digest', { method: 'DELETE' });
    expect(del.status).toBe(409);

    const disable = await api('/digest/disable', { method: 'POST' });
    expect(disable.status).toBe(200);
    const put2 = await api('/digest', { method: 'PUT', body: JSON.stringify({ def: DEF('Renamed') }) });
    expect(put2.status).toBe(200);
    const del2 = await api('/digest', { method: 'DELETE' });
    expect(del2.status).toBe(200);
  });

  it('disable answers 409 pipeline-has-activations and lists the holders (never cascades)', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    expect((await activate('digest', 'proj-a')).status).toBe(200);

    const res = await api('/digest/disable', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('pipeline-has-activations');
    expect(body.activations).toEqual([{ userId: 'localuser', projectId: 'proj-a' }]);
    // The activation survives — nothing was force-deactivated.
    expect(fs.existsSync(path.join(userDir, '.ant/pipeline-activations/proj-a/activation.json'))).toBe(true);
  });
});

describe('activation — one per project, many per pipeline', () => {
  it('activate gates in order: disabled → non-universal → project taken → live job', async () => {
    await createPipeline();
    makeUniversalProject('proj-a');

    // Gate 0: disabled.
    const disabled = await activate('digest', 'proj-a');
    expect(disabled.status).toBe(409);
    expect((await disabled.json()).code).toBe('pipeline-disabled');

    await enable();

    // Gate 1: not a universal project.
    fs.mkdirSync(path.join(userDir, 'code-proj'), { recursive: true });
    const nonUniversal = await activate('digest', 'code-proj');
    expect(nonUniversal.status).toBe(400);
    expect((await nonUniversal.json()).code).toBe('project-not-universal');

    // Gate 3: live job.
    liveJobs = [{ jobId: 'job-1', status: 'running', type: 'universal' }];
    const busy = await activate('digest', 'proj-a');
    expect(busy.status).toBe(409);
    expect((await busy.json()).code).toBe('project-has-live-job');
    liveJobs = [];

    expect((await activate('digest', 'proj-a')).status).toBe(200);
    expect(cronUpserts).toContain('pipe|localorg|localuser|proj-a');

    // Gate 2: the project is taken — by ANOTHER pipeline.
    await createPipeline('other');
    await enable('other');
    const taken = await activate('other', 'proj-a');
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe('project-has-active-pipeline');
  });

  it('the same pipeline activates onto a SECOND project (pipeline-side 1:1 is gone)', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    makeUniversalProject('proj-b');
    expect((await activate('digest', 'proj-a')).status).toBe(200);
    expect((await activate('digest', 'proj-b')).status).toBe(200);
    const list = await (await api('')).json();
    expect(list.pipelines[0].activations.map((a: any) => a.projectId).sort()).toEqual(['proj-a', 'proj-b']);
    expect(list.pipelines[0].activations.every((a: any) => a.mine)).toBe(true);
  });

  it('deactivate removes only that project binding; runs survive; the record self-describes', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    await activate('digest', 'proj-a');
    const record = JSON.parse(fs.readFileSync(path.join(userDir, '.ant/pipeline-activations/proj-a/activation.json'), 'utf-8'));
    expect(record).toMatchObject({ pipelineId: 'digest', pipelineScope: 'user', projectId: 'proj-a' });
    fs.mkdirSync(path.join(userDir, '.ant/pipeline-activations/proj-a/runs'), { recursive: true });
    fs.writeFileSync(path.join(userDir, '.ant/pipeline-activations/proj-a/runs/index.jsonl'), '');

    const res = await api('/digest/deactivate', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) });
    expect(res.status).toBe(200);
    expect(cronRemoved).toContain('pipe|localorg|localuser|proj-a');
    expect(fs.existsSync(path.join(userDir, '.ant/pipeline-activations/proj-a/activation.json'))).toBe(false);
    expect(fs.existsSync(path.join(userDir, '.ant/pipeline-activations/proj-a/runs/index.jsonl'))).toBe(true);
  });

  it('run-now requires the caller\'s own activation on that project', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    const res = await api('/digest/run-now', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('pipeline-not-activated');
  });

  it('an orphan activation (deleted def) is surfaced in the list, never auto-deleted', async () => {
    const orphanDir = path.join(userDir, '.ant/pipeline-activations/proj-x');
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(
      path.join(orphanDir, 'activation.json'),
      JSON.stringify({ pipelineId: 'ghost', pipelineScope: 'user', projectId: 'proj-x', activatedAt: '2026-08-20T00:00:00.000Z' }),
    );
    const list = await (await api('')).json();
    expect(list.orphanActivations).toHaveLength(1);
    expect(list.orphanActivations[0]).toMatchObject({ pipelineId: 'ghost', projectId: 'proj-x', state: 'broken', mine: true });
    expect(fs.existsSync(path.join(orphanDir, 'activation.json'))).toBe(true);
  });
});

describe('org scoping (team-kind server, promote/ACL — separate app per role)', () => {
  async function teamApp(memberships: Map<string, OrgMembershipRole>, userId: string) {
    // A team-kind caller: declared tenant + team org repo. Personal defs anchor
    // under the INDIVIDUAL org; org defs under {ws}/localorg/.ant/pipelines.
    process.env.ANT_LOCAL_ORG = 'localorg';
    process.env.ANT_LOCAL_USER = userId;
    const resolver = {
      getPhysicalWorkspacesPath: () => wsRoot,
      getWorkspacePath: () => path.join(wsRoot, 'localorg', userId),
      getProjectPath: (_uc: unknown, projectId: string) => path.join(wsRoot, 'localorg', userId, projectId),
    };
    const app = express();
    app.use(express.json());
    // Team kind rides the request: extractUserContext in local mode always says
    // 'local' — so drive kind through the JWT-shaped request fields instead.
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      (req as any).organization = { id: 'localorg', kind: 'team' };
      next();
    });
    app.use(
      '/api/pipelines',
      createPipelinesRoutes({
        workspaceResolver: resolver as any,
        coordinator: {
          getActiveRunId: async () => null,
          getRun: async () => null,
          listPendingApprovals: async () => [],
          getHitlByGateId: async () => null,
          applyResolvedGate: async () => true,
          cancelRun: async () => false,
          readRunFromDisk: () => null,
          deactivate: async () => {},
        } as any,
        scheduleQueue: {
          upsertCron: async () => {},
          removeCron: async () => {},
          listCronIds: async () => [],
          armDelayed: async () => {},
          cancelDelayed: async () => {},
          addNow: async () => {},
          close: async () => {},
        } as any,
        stateStore: { listJobsByFeature: async () => [], setKeyWithTTL: async () => {}, deleteKey: async () => {}, getKey: async () => null, publish: async () => {} } as any,
        organizationRepository: fakeOrgRepo(memberships),
      }),
    );
    const srv = http.createServer(app);
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    const port = (srv.address() as { port: number }).port;
    return {
      url: `http://127.0.0.1:${port}/api/pipelines`,
      close: () => new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve()))),
    };
  }

  it('promote MOVEs a disabled personal pipeline into the org root and records the ACL owner; members see it readonly', async () => {
    const memberships = new Map<string, OrgMembershipRole>([
      ['alice', 'member'],
      ['bob', 'member'],
    ]);
    const alice = await teamApp(memberships, 'alice');
    try {
      const created = await fetch(alice.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'shared', def: DEF('Shared') }),
      });
      expect(created.status).toBe(201);
      // Personal defs of a team-kind caller anchor under the INDIVIDUAL org.
      expect(fs.existsSync(path.join(wsRoot, 'individual', 'alice', '.ant/pipelines/shared/pipeline.yaml'))).toBe(true);

      // Enabled pipelines refuse promote (disabled-only write surface).
      await fetch(`${alice.url}/shared/enable`, { method: 'POST' });
      const refused = await fetch(`${alice.url}/shared/promote`, { method: 'POST' });
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe('pipeline-enabled');
      await fetch(`${alice.url}/shared/disable`, { method: 'POST' });

      const promoted = await fetch(`${alice.url}/shared/promote`, { method: 'POST' });
      expect(promoted.status).toBe(201);
      expect(fs.existsSync(path.join(wsRoot, 'localorg', '.ant/pipelines/shared/pipeline.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(wsRoot, 'individual', 'alice', '.ant/pipelines/shared'))).toBe(false);
      const acl = JSON.parse(fs.readFileSync(path.join(wsRoot, 'localorg', '.ant/pipeline-acl.json'), 'utf-8'));
      expect(acl.pipelines.shared).toEqual({ owner: 'alice', editors: [] });

      // The owner still edits it; a plain member sees readonly + a 403 on write.
      const aliceList = await (await fetch(alice.url)).json();
      const aliceEntry = aliceList.pipelines.find((p: any) => p.id === 'shared');
      expect(aliceEntry).toMatchObject({ scope: 'org', readonly: false });

      const bob = await teamApp(memberships, 'bob');
      try {
        const bobList = await (await fetch(bob.url)).json();
        const bobEntry = bobList.pipelines.find((p: any) => p.id === 'shared');
        expect(bobEntry).toMatchObject({ scope: 'org', readonly: true });
        const bobPut = await fetch(`${bob.url}/shared`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ def: DEF('Hijack') }),
        });
        expect(bobPut.status).toBe(403);
        expect((await bobPut.json()).code).toBe('org-pipeline-forbidden');
      } finally {
        await bob.close();
      }
    } finally {
      await alice.close();
      process.env.ANT_LOCAL_ORG = 'localorg';
      process.env.ANT_LOCAL_USER = 'localuser';
      fs.rmSync(path.join(wsRoot, 'individual'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', '.ant'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', 'alice'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', 'bob'), { recursive: true, force: true });
    }
  });

  it('org members see each other\'s activations of an org pipeline (mine flag flips per caller)', async () => {
    const memberships = new Map<string, OrgMembershipRole>([
      ['alice', 'admin'],
      ['bob', 'member'],
    ]);
    // Org-scope def on disk directly (promote is covered above).
    const orgDefDir = path.join(wsRoot, 'localorg', '.ant/pipelines/shared');
    fs.mkdirSync(orgDefDir, { recursive: true });
    fs.writeFileSync(path.join(orgDefDir, 'pipeline.yaml'), `version: 2\nname: Shared\non:\n  schedule:\n    cron: '0 9 * * 1'\nsteps:\n  - id: collect\n    customJobRef: research/collect\n    directive: x\n`);
    fs.writeFileSync(path.join(orgDefDir, 'availability.json'), JSON.stringify({ enabled: true, changedAt: '2026-08-20T00:00:00.000Z' }));

    const alice = await teamApp(memberships, 'alice');
    const bob = await teamApp(memberships, 'bob');
    try {
      // Bob activates it on his project.
      fs.mkdirSync(path.join(wsRoot, 'localorg', 'bob', 'proj-b'), { recursive: true });
      fs.writeFileSync(path.join(wsRoot, 'localorg', 'bob', 'proj-b', 'config.json'), JSON.stringify({ projectType: 'universal' }));
      const activated = await fetch(`${bob.url}/shared/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-b' }),
      });
      expect(activated.status).toBe(200);

      const aliceViews = await (await fetch(`${alice.url}/shared/activations`)).json();
      expect(aliceViews.activations).toHaveLength(1);
      expect(aliceViews.activations[0]).toMatchObject({ projectId: 'proj-b', activatedBy: 'bob', mine: false });

      const bobViews = await (await fetch(`${bob.url}/shared/activations`)).json();
      expect(bobViews.activations[0]).toMatchObject({ projectId: 'proj-b', mine: true });

      // Alice cannot deactivate Bob's activation (no own binding on proj-b).
      const steal = await fetch(`${alice.url}/shared/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-b' }),
      });
      expect(steal.status).toBe(404);

      // Owner disable is blocked while Bob holds an activation.
      const disable = await fetch(`${alice.url}/shared/disable`, { method: 'POST' });
      expect(disable.status).toBe(409);
      expect((await disable.json()).code).toBe('pipeline-has-activations');
    } finally {
      await alice.close();
      await bob.close();
      process.env.ANT_LOCAL_ORG = 'localorg';
      process.env.ANT_LOCAL_USER = 'localuser';
      fs.rmSync(path.join(wsRoot, 'localorg', '.ant'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', 'alice'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', 'bob'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'individual'), { recursive: true, force: true });
    }
  });
});
