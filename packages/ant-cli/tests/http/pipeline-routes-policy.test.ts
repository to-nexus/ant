/**
 * Pipeline routes (`/api/definitions/pipelines`) — the scoped-definition + availability +
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
import { MEMBERSHIP_REQUIRED, DIRECTIVE_MAX_CHARS, type OrgMembershipRole } from '@ant/shared';
import { zipEntryNames } from './helpers/zipEntries';

let wsRoot: string;
let userDir: string;
let server: http.Server;
let baseUrl: string;
let liveJobs: Array<{ jobId: string; status: string; type?: string }> = [];
const cronUpserts: string[] = [];
const cronRemoved: string[] = [];

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}/api/definitions/pipelines${pathname}`, {
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

/**
 * Enable/activate hard-fail on catalog binding, so the DEF()'s
 * `research/collect` ref must resolve in the caller's agent catalog.
 * `triage` carries outcomes for the verdict-edge rows.
 */
function scaffoldAgentCatalog(agentsRoot: string): void {
  const jobDir = path.join(agentsRoot, 'research', 'jobs', 'collect');
  fs.mkdirSync(path.join(jobDir, 'intents', 'triage'), { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, 'research', 'agent.yaml'), 'id: research\nname: Research\nversion: 1\n');
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), 'id: collect\nname: Collect\n');
  fs.writeFileSync(
    path.join(jobDir, 'intents', 'triage', 'infer.md'),
    '---\noutcomes: [ok, needs-review]\n---\nTriage the collected sources.\n',
  );
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
    '/api/definitions/pipelines',
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
  scaffoldAgentCatalog(path.join(userDir, '.ant', 'agents'));
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

describe('catalog binding — enable/activate hard-fail, save is advisory', () => {
  const GHOST_DEF = {
    version: 2,
    name: 'Ghost',
    on: { schedule: { cron: '0 9 * * 1' } },
    steps: [{ id: 'collect', customJobRef: 'ghost/collect', directive: 'x' }],
  };

  it('save stays permissive and returns catalogWarnings for an unresolvable ref', async () => {
    const res = await api('', { method: 'POST', body: JSON.stringify({ id: 'ghosted', def: GHOST_DEF }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.catalogWarnings.join('\n')).toMatch(/agent "ghost" is not in your agent catalog/);
  });

  it('save of a fully resolvable def carries no catalogWarnings key', async () => {
    const res = await api('', { method: 'POST', body: JSON.stringify({ id: 'digest', def: DEF() }) });
    expect(res.status).toBe(201);
    expect('catalogWarnings' in (await res.json())).toBe(false);
  });

  it('enable hard-fails an unresolvable ref, naming the agent (the remedy path)', async () => {
    await api('', { method: 'POST', body: JSON.stringify({ id: 'ghosted', def: GHOST_DEF }) });
    const res = await api('/ghosted/enable', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid-pipeline-def');
    expect(body.errors.join('\n')).toMatch(/agent "ghost"/);
  });

  it('activate re-judges the activator catalog — an agent deleted after enable fails HERE, not at dispatch', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    fs.rmSync(path.join(userDir, '.ant/agents/research'), { recursive: true, force: true });
    const res = await activate('digest', 'proj-a');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid-pipeline-def');
  });

  it('a verdict edge naming an outcome the pinned intent does not declare fails enable', async () => {
    const def = {
      version: 2,
      name: 'Verdict typo',
      on: { schedule: { cron: '0 9 * * 1' } },
      steps: [
        { id: 'judge', customJobRef: 'research/collect', intent: 'triage' },
        { id: 'x', customJobRef: 'research/collect', needs: ['judge'], on: 'verdict:nope' },
      ],
    };
    const created = await api('', { method: 'POST', body: JSON.stringify({ id: 'typo', def }) });
    expect(created.status).toBe(201);
    const res = await api('/typo/enable', { method: 'POST' });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join('\n')).toMatch(/would always skip/);
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
      '/api/definitions/pipelines',
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
      url: `http://127.0.0.1:${port}/api/definitions/pipelines`,
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
      // Enable judges the enabler's catalog — the org root resolves for every member.
      scaffoldAgentCatalog(path.join(wsRoot, 'localorg', '.ant', 'agents'));
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
    scaffoldAgentCatalog(path.join(wsRoot, 'localorg', '.ant', 'agents'));
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

  it('runs-history refuses a target userId that is not a live org member (M-025)', async () => {
    const memberships = new Map<string, OrgMembershipRole>([['alice', 'admin']]);
    // Org-scope def on disk (member alice is authority over the PIPELINE, but
    // not over an arbitrary target userId's activation directory).
    const orgDefDir = path.join(wsRoot, 'localorg', '.ant/pipelines/shared');
    fs.mkdirSync(orgDefDir, { recursive: true });
    fs.writeFileSync(path.join(orgDefDir, 'pipeline.yaml'), `version: 2\nname: Shared\non:\n  schedule:\n    cron: '0 9 * * 1'\nsteps:\n  - id: collect\n    customJobRef: research/collect\n    directive: x\n`);
    fs.writeFileSync(path.join(orgDefDir, 'availability.json'), JSON.stringify({ enabled: true, changedAt: '2026-08-20T00:00:00.000Z' }));

    const alice = await teamApp(memberships, 'alice');
    try {
      const res = await fetch(`${alice.url}/shared/runs?projectId=proj-a&userId=${encodeURIComponent('stranger@evil.com')}`);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe(MEMBERSHIP_REQUIRED);
    } finally {
      await alice.close();
      process.env.ANT_LOCAL_ORG = 'localorg';
      process.env.ANT_LOCAL_USER = 'localuser';
      fs.rmSync(path.join(wsRoot, 'localorg', '.ant'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'localorg', 'alice'), { recursive: true, force: true });
      fs.rmSync(path.join(wsRoot, 'individual'), { recursive: true, force: true });
    }
  });
});

describe('folder download (export)', () => {
  it('ZIP carries pipeline.yaml + availability.json — never owner.json (the author account coordinates)', async () => {
    await createPipeline();
    expect(fs.existsSync(path.join(userDir, '.ant/pipelines/digest/owner.json'))).toBe(true);

    const res = await api('/digest/download');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="digest.zip"');

    const names = zipEntryNames(Buffer.from(await res.arrayBuffer())).sort();
    expect(names).toEqual(['digest/availability.json', 'digest/pipeline.yaml']);
  });

  it('an enabled pipeline is still exportable — export is a read, not a definition write', async () => {
    await createPipeline();
    await enable();
    const res = await api('/digest/download');
    expect(res.status).toBe(200);
  });

  it('unknown pipeline → 404; traversal id → 400', async () => {
    expect((await api('/nope/download')).status).toBe(404);
    expect((await api(`/${encodeURIComponent('../../etc')}/download`)).status).toBe(400);
  });
});

describe('path-traversal rejection on activation identifiers (H-016 / M-025)', () => {
  // Body/query identifiers reach the handler verbatim — every shape applies.
  const BAD = ['../victim', '..', 'a/b', 'a\\b', '/etc', 'proj\0'];
  // Path params: a bare `..`/`.` segment is collapsed by HTTP path
  // normalization before routing (it never arrives as the param), so the
  // reachable traversal shapes here are the ones carrying an ENCODED separator
  // or NUL that survive decoding into a single param value.
  const BAD_PATH = ['..%2Fvictim', 'a%2Fb', 'a%5Cb', 'proj%00'];

  for (const bad of BAD) {
    it(`deactivate rejects traversal projectId ${JSON.stringify(bad)} with 400`, async () => {
      const res = await api('/digest/deactivate', {
        method: 'POST',
        body: JSON.stringify({ projectId: bad }),
      });
      expect(res.status).toBe(400);
    });

    it(`run-now rejects traversal projectId ${JSON.stringify(bad)} with 400`, async () => {
      const res = await api('/digest/run-now', {
        method: 'POST',
        body: JSON.stringify({ projectId: bad }),
      });
      expect(res.status).toBe(400);
    });

    it(`runs-history rejects traversal projectId ${JSON.stringify(bad)} with 400`, async () => {
      const res = await api(`/digest/runs?projectId=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    });

    it(`runs-history rejects traversal target userId ${JSON.stringify(bad)} with 400`, async () => {
      const res = await api(`/digest/runs?projectId=proj-a&userId=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    });
  }

  for (const bad of BAD_PATH) {
    it(`run-detail rejects traversal runId ${JSON.stringify(bad)} with 400`, async () => {
      const res = await api(`/runs/${bad}`);
      expect(res.status).toBe(400);
    });
  }
});

/**
 * Directive ceiling on the pipeline ingresses (M-NEW-029, audit-10).
 *
 * The clarify answer is re-dispatched as the step's resume directive VERBATIM —
 * only the stored audit copy is truncated — so it reaches `appendUserTurn` and
 * the universal enqueue exactly like a job-start directive, and carries the
 * same ceiling. The check runs before the run lookup, so an over-cap answer is
 * refused without any state being touched.
 */
describe('clarify answer ceiling', () => {
  const over = 'x'.repeat(DIRECTIVE_MAX_CHARS + 1);

  it('refuses an over-cap clarify answer with a typed 413', async () => {
    const res = await api('/runs/run-1/steps/step-1/clarify', {
      method: 'POST',
      body: JSON.stringify({ answer: over }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('DIRECTIVE_TOO_LARGE');
  });

  it('still refuses an empty answer with 400 (the ceiling did not replace that)', async () => {
    const res = await api('/runs/run-1/steps/step-1/clarify', {
      method: 'POST',
      body: JSON.stringify({ answer: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
