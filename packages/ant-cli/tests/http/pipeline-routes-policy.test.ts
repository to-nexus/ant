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
import { MEMBERSHIP_REQUIRED, DIRECTIVE_MAX_CHARS, PIPELINE_YAML_MAX_BYTES, type OrgMembershipRole } from '@ant/shared';
import { zipEntryNames } from './helpers/zipEntries';

let wsRoot: string;
let userDir: string;
let server: http.Server;
let baseUrl: string;
let liveJobs: Array<{ jobId: string; status: string; type?: string }> = [];
let liveRunIds: string[] = [];
const redisKeys = new Map<string, string>();
const cronUpserts: string[] = [];
const cronRemoved: string[] = [];
const everyUpserts: Array<{ id: string; everyMs: number }> = [];
const addedNow: any[] = [];

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
  // `jira` is the external connection the fetch-trigger rows poll; `allow` bounds it.
  fs.writeFileSync(path.join(jobDir, 'job.yaml'), 'id: collect\nname: Collect\napis:\n  jira:\n    baseUrl: https://jira.example.com\n    allow:\n      - GET /rest/**\n');
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
    listActiveRunIds: async () => liveRunIds,
    listLiveRuns: async () =>
      liveRunIds.map((runId) => ({ runId, status: 'running', startedAt: '2026-09-16T00:00:00.000Z', firedBy: 'manual', currentStepIds: [] })),
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
    upsertEvery: async (id: string, everyMs: number) => void everyUpserts.push({ id, everyMs }),
    removeCron: async (id: string) => void cronRemoved.push(id),
    listCronIds: async () => [],
    armDelayed: async () => {},
    cancelDelayed: async () => {},
    addNow: async (data: any) => void addedNow.push(data),
    close: async () => {},
  };
  const stateStore = {
    listJobsByFeature: async () => liveJobs,
    setKeyWithTTL: async (k: string, v: string) => void redisKeys.set(k, v),
    deleteKey: async (k: string) => void redisKeys.delete(k),
    getKey: async (k: string) => redisKeys.get(k) ?? null,
    exists: async (k: string) => redisKeys.has(k),
    tryAcquireLock: async (k: string, v: string) => {
      if (redisKeys.has(k)) return false;
      redisKeys.set(k, v);
      return true;
    },
    publish: async () => {},
  };

  const app = express();
  // Mirrors the AUTHENTICATED plane's parser (`ServerConfigurator`, 50mb). The
  // default 100kb would answer before any route's own field cap, so a cap test
  // would be asserting the parser rather than the route.
  app.use(express.json({ limit: '50mb' }));
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
  liveRunIds = [];
  cronUpserts.length = 0;
  cronRemoved.length = 0;
  everyUpserts.length = 0;
  addedNow.length = 0;
  redisKeys.clear();
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

describe('create — the id a non-Latin name cannot slug', () => {
  // solar-edging-bride: `id` is documented optional and defaults to a slug of
  // `def.name`. A Korean name has no [a-z0-9] run, so the slug was "" and the
  // caller got `Invalid pipeline id: ""` — blamed for an id it never sent, with
  // no hint the field belongs in the body. Two of six saves went to this.
  it('refuses with pipeline-id-required, naming the body, when the name has nothing to slug', async () => {
    const res = await api('', { method: 'POST', body: JSON.stringify({ def: DEF('약관 변경 고지 — 준비') }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('pipeline-id-required');
    expect(body.error).toMatch(/no \[a-z0-9\] characters to slug/);
    expect(body.error).toMatch(/request body/);
  });

  it('says where the field belongs when the id rode the query string instead', async () => {
    const res = await api('?id=terms-prep', { method: 'POST', body: JSON.stringify({ def: DEF('약관 변경 고지') }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/BODY/);
  });

  it('still slugs a Latin name, and an explicit id always wins', async () => {
    expect((await api('', { method: 'POST', body: JSON.stringify({ def: DEF('Weekly Digest') }) })).status).toBe(201);
    const named = await api('', { method: 'POST', body: JSON.stringify({ id: 'terms-prep', def: DEF('약관 변경 고지') }) });
    expect(named.status).toBe(201);
    expect((await named.json()).id).toBe('terms-prep');
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

  // Liveness is the slot SET, so the refusal names every live run; the singular
  // field stays one release for API callers.
  it('run-now refuses while the activation holds a live run, naming the live runs', async () => {
    await createPipeline();
    await enable();
    makeUniversalProject('proj-a');
    await activate('digest', 'proj-a');
    liveRunIds = ['sandy-mending-cabin'];
    const res = await api('/digest/run-now', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existingRunIds).toEqual(['sandy-mending-cabin']);
    expect(body.existingRunId).toBe('sandy-mending-cabin');
  });

  // The refusal is the definition's `concurrency` — a burst of Run now starts
  // N independent runs and only the (N+1)th is refused, naming the cap.
  it('run-now admits up to the definition\'s concurrency and refuses only at cap', async () => {
    const created = await api('', { method: 'POST', body: JSON.stringify({ id: 'burst', def: { ...DEF('Burst'), concurrency: 2 } }) });
    expect(created.status).toBe(201);
    await enable('burst');
    makeUniversalProject('proj-a');
    await activate('burst', 'proj-a');
    liveRunIds = ['sandy-mending-cabin'];
    expect((await api('/burst/run-now', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) })).status).toBe(202);
    liveRunIds = ['sandy-mending-cabin', 'brisk-folding-lamp'];
    const res = await api('/burst/run-now', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existingRunIds).toEqual(['sandy-mending-cabin', 'brisk-folding-lamp']);
    expect(body.concurrency).toBe(2);
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

describe('fetch trigger — poll-now, the every-poller, preview-fetch', () => {
  const FETCH_DEF = (request: Record<string, unknown> = {}) => ({
    version: 2,
    name: 'Tickets',
    on: {
      fetch: {
        customJobRef: 'research/collect',
        api: 'jira',
        request: { method: 'GET', path: '/rest/api/3/search', ...request },
        items: '$.issues',
        key: '$.key',
        every: '5m',
      },
    },
    steps: [{ id: 'collect', customJobRef: 'research/collect', directive: 'Handle {{trigger.item.key}}' }],
  });

  it('activate registers the every-poller (not a cron), the list carries `every`, and run-now is Poll-now (202 polled)', async () => {
    makeUniversalProject('proj-a');
    expect((await api('', { method: 'POST', body: JSON.stringify({ id: 'tickets', def: FETCH_DEF() }) })).status).toBe(201);
    await enable('tickets');
    const act = await activate('tickets', 'proj-a');
    expect(act.status).toBe(200);
    expect(cronUpserts).toEqual([]);
    expect(everyUpserts).toEqual([{ id: 'fetch|localorg|localuser|proj-a', everyMs: 5 * 60_000 }]);
    // The claim projection marker is set at activate (rebuilt from an empty ledger).
    expect(redisKeys.has('ant:pipe:items-built:localorg:localuser:proj-a')).toBe(true);

    const list = await (await api('')).json();
    const entry = list.pipelines.find((p: any) => p.id === 'tickets');
    expect(entry.every).toBe('5m');
    expect(entry.cron).toBeUndefined();
    // No poll yet → no nextFireAt, no lastPoll.
    expect(entry.activations[0].lastPoll).toBeUndefined();
    expect(entry.activations[0].nextFireAt).toBeUndefined();

    // A stored poll status becomes lastPoll and nextFireAt = polledAt + every.
    redisKeys.set('ant:pipe:fetch:localorg:localuser:proj-a', JSON.stringify({ polledAt: '2026-09-16T00:00:00.000Z', seen: 3, unclaimed: 1, enqueued: 1 }));
    const views = await (await api('/tickets/activations')).json();
    expect(views.activations[0].lastPoll).toMatchObject({ seen: 3, enqueued: 1 });
    expect(views.activations[0].nextFireAt).toBe('2026-09-16T00:05:00.000Z');

    // Run-now on a fetch activation polls — even at cap, the poll judges room itself.
    liveRunIds = ['run-1'];
    const res = await api('/tickets/run-now', { method: 'POST', body: JSON.stringify({ projectId: 'proj-a' }) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, polled: true });
    expect(addedNow).toEqual([expect.objectContaining({ kind: 'fetch-poll', pipelineId: 'tickets', projectId: 'proj-a', manual: true })]);
  });

  it('enable hard-fails a fetch request outside the connection\'s allow rules, with the executor\'s own verdict', async () => {
    expect((await api('', { method: 'POST', body: JSON.stringify({ id: 'tickets', def: FETCH_DEF({ path: '/admin/export' }) }) })).status).toBe(201);
    const res = await api('/tickets/enable', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.join('\n')).toMatch(/on\.fetch: GET \/admin\/export is not permitted by connection "jira" \(allow: GET \/rest\/\*\*\)/);
  });

  it('preview-fetch validates the block (400 invalid-fetch-trigger), refuses a traversal projectId, and answers 503 without a credential store', async () => {
    const bad = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: { customJobRef: 'research/collect' } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('invalid-fetch-trigger');
    const traversal = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: FETCH_DEF().on.fetch, projectId: '../x' }) });
    expect(traversal.status).toBe(400);
    // This harness mounts no credentialResolverFor — the route says so instead of polling with nothing.
    const noStore = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: FETCH_DEF().on.fetch }) });
    expect(noStore.status).toBe(503);
    expect((await noStore.json()).code).toBe('credentials-unavailable');
  });

  it('an inline connection needs no catalog api: save, enable and activate pass with no apis entry named', async () => {
    const def = FETCH_DEF();
    def.on.fetch = {
      connection: { baseUrl: 'https://queue.example.com', headers: { Authorization: '${secret:QUEUE_TOKEN}' } },
      request: { method: 'GET', path: '/items' },
      items: '$.items',
      key: '$.id',
      every: '5m',
    } as never;
    makeUniversalProject('proj-b');
    const saved = await api('', { method: 'POST', body: JSON.stringify({ id: 'inbox', def }) });
    expect(saved.status).toBe(201);
    expect((await saved.json()).catalogWarnings).toBeUndefined();
    await enable('inbox');
    expect((await activate('inbox', 'proj-b')).status).toBe(200);
    const list = await (await api('')).json();
    expect(list.pipelines.find((p: any) => p.id === 'inbox').every).toBe('5m');
  });

  it('preview-fetch accepts the inline form (the block validates; this harness then answers 503) and refuses both forms at once', async () => {
    const inline = { connection: { baseUrl: 'https://queue.example.com' }, request: { method: 'GET', path: '/items' }, items: '$.items', key: '$.id', every: '5m' };
    const ok = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: inline }) });
    expect(ok.status).toBe(503);
    const both = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: { ...FETCH_DEF().on.fetch, connection: inline.connection } }) });
    expect(both.status).toBe(400);
    expect((await both.json()).errors.join('\n')).toMatch(/exactly one connection form/);
  });

  it('preview-fetch validates the block as a PROBE: connection + request must hold, selection may still be blank (the sample is what fills it)', async () => {
    // No items/key/every yet — an author who has not read the response cannot have written them. The probe passes; this harness then answers 503 for the missing store.
    const probe = { connection: { baseUrl: 'https://queue.example.com' }, request: { method: 'GET', path: '/items' } };
    const res = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: probe }) });
    expect(res.status).toBe(503);
    // A broken REQUEST is still a 400 — there is no response to show without one.
    const badPath = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: { ...probe, request: { method: 'GET', path: 'items' } } }) });
    expect(badPath.status).toBe(400);
    expect((await badPath.json()).errors.join('\n')).toMatch(/request\.path/);
    // An unknown key is refused even in probe form — a misspelled `connection` must not read as "bound with nothing".
    const typo = await api('/preview-fetch', { method: 'POST', body: JSON.stringify({ fetch: { ...probe, conection: {} } }) });
    expect(typo.status).toBe(400);
  });

  it('preview-fetch is registered as a LITERAL — it never resolves as a pipeline id', async () => {
    const res = await api('/preview-fetch');
    expect([404, 405]).toContain(res.status);
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
          listLiveRuns: async () => [],
          listActiveRunIds: async () => [],
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

describe('folder import (upload)', () => {
  const YAML = (name = 'Digest') =>
    `version: 2\nname: ${name}\non:\n  schedule:\n    cron: '0 9 * * 1'\n    tz: Asia/Seoul\nsteps:\n  - id: collect\n    customJobRef: research/collect\n    directive: Collect sources\n`;

  const importYaml = (body: Record<string, unknown>) =>
    api('/import', { method: 'POST', body: JSON.stringify(body) });

  it('a new id lands as a DISABLED draft, exactly as POST / does', async () => {
    const res = await importYaml({ yaml: YAML(), id: 'digest' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'digest', created: true });
    expect(JSON.parse(fs.readFileSync(path.join(userDir, '.ant/pipelines/digest/availability.json'), 'utf-8')).enabled).toBe(false);
    expect(fs.existsSync(path.join(userDir, '.ant/pipelines/digest/owner.json'))).toBe(true);
  });

  it('with no id the server slugs def.name — a bare pipeline.yaml needs no folder', async () => {
    const res = await importYaml({ yaml: YAML('Weekly Digest') });
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe('weekly-digest');
  });

  it('an existing id answers 409 pipeline-exists and names the id the CLIENT must prompt about', async () => {
    await createPipeline();
    const res = await importYaml({ yaml: YAML('Renamed'), id: 'digest' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('pipeline-exists');
    expect(body.conflictId).toBe('digest');
    // Nothing was written: the refusal is not a half-replace.
    expect(fs.readFileSync(path.join(userDir, '.ant/pipelines/digest/pipeline.yaml'), 'utf-8')).toContain('Digest');
  });

  it('overwrite replaces the definition in place and keeps the availability sidecar', async () => {
    await createPipeline();
    const res = await importYaml({ yaml: YAML('Renamed'), id: 'digest', overwrite: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'digest', created: false });
    expect(fs.readFileSync(path.join(userDir, '.ant/pipelines/digest/pipeline.yaml'), 'utf-8')).toContain('Renamed');
    expect(fs.existsSync(path.join(userDir, '.ant/pipelines/digest/availability.json'))).toBe(true);
  });

  it('overwrite obeys the availability machine — an ENABLED pipeline refuses, like PUT', async () => {
    await createPipeline();
    await enable();
    const res = await importYaml({ yaml: YAML('Renamed'), id: 'digest', overwrite: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('pipeline-enabled');
    expect(fs.readFileSync(path.join(userDir, '.ant/pipelines/digest/pipeline.yaml'), 'utf-8')).toContain('Digest');
  });

  it('an invalid definition answers 400 invalid-pipeline-def with EVERY broken rule, like POST /', async () => {
    const res = await importYaml({ yaml: 'version: 1\n' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid-pipeline-def');
    // The builder prose promises `errors[]` naming every rule; one rule per
    // round trip is the guessing loop it exists to prevent.
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(1);
    expect(body.errors[0]).toBe(body.error);
  });

  it('unparseable yaml is the same typed refusal, not a crash', async () => {
    const res = await importYaml({ yaml: 'steps: [unclosed\n' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid-pipeline-def');
  });

  it('the route carries its own field cap — over-budget yaml is a typed 413', async () => {
    const padded = YAML() + '# ' + 'x'.repeat(PIPELINE_YAML_MAX_BYTES);
    const res = await importYaml({ yaml: padded, id: 'digest' });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PIPELINE_YAML_TOO_LARGE');
  });

  it('an empty body is a 400, not an empty definition', async () => {
    expect((await importYaml({ yaml: '' })).status).toBe(400);
  });

  it('import is registered as a LITERAL — it never resolves as a pipeline id', async () => {
    await importYaml({ yaml: YAML(), id: 'digest' });
    // `/import` did not create a pipeline called "import".
    expect(fs.existsSync(path.join(userDir, '.ant/pipelines/import'))).toBe(false);
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

/**
 * Gate resolve authority (doc 48 in-app approver, A2): the activation OWNER
 * decides everything; a NON-owner decides ONLY a gate-kind approval step they
 * are on the roster of — the roster re-read LIVE from the owner's
 * activation.json at resolve time. Tool approvals and clarify stay
 * activator-scoped. Approver rosters live on the ACTIVATION (activate body /
 * the approvers PUT), never the definition.
 */
describe('gate resolve authority — owner ∨ per-gate approver', () => {
  beforeEach(() => {
    for (const dir of ['localorg/alice', 'localorg/bob', 'individual/alice', 'individual/bob']) {
      fs.rmSync(path.join(wsRoot, dir), { recursive: true, force: true });
    }
  });

  const OWNER = { userId: 'alice', organizationId: 'localorg', organizationKind: 'team' as const };
  const HITL = (over: Partial<Record<string, unknown>> = {}) => ({
    gateId: 'gate-r1-budget-gate',
    cardId: 'pipe-gate-r1-budget-gate',
    runId: 'r1',
    stepId: 'budget-gate',
    pipelineId: 'digest',
    projectId: 'proj-a',
    owner: OWNER,
    onTimeout: 'reject',
    anchorJobId: 'job-1',
    prompt: 'Approve the March payout?',
    ...over,
  });
  const RUN = (gateOver: Partial<Record<string, unknown>> = {}) => ({
    runId: 'r1',
    pipelineId: 'digest',
    projectId: 'proj-a',
    firedBy: 'cron',
    fireEpoch: 1,
    status: 'awaiting_human',
    startedAt: '2026-09-06T00:00:00.000Z',
    steps: [
      {
        stepId: 'budget-gate',
        status: 'awaiting_gate',
        gate: { gateId: 'gate-r1-budget-gate', cardId: 'pipe-gate-r1-budget-gate', prompt: 'Approve?', armedAt: '2026-09-06T00:00:00.000Z', ...gateOver },
      },
    ],
  });

  function writeOwnerActivation(approvers?: Record<string, string[]>): void {
    const dir = path.join(wsRoot, 'localorg', 'alice', '.ant', 'pipeline-activations', 'proj-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'activation.json'),
      JSON.stringify({
        pipelineId: 'digest',
        pipelineScope: 'org',
        projectId: 'proj-a',
        activatedAt: '2026-09-06T00:00:00.000Z',
        activatedBy: 'alice',
        ...(approvers ? { approvers } : {}),
      }),
    );
  }

  async function approverApp(
    userId: string,
    opts: {
      hitl?: Record<string, unknown> | null;
      run?: Record<string, unknown> | null;
      resolved?: boolean;
      approverRows?: unknown[];
      /** Reassign leg: the coordinator's candidate set and whether the write lands. */
      candidates?: string[];
      reassignOk?: boolean;
    } = {},
  ) {
    process.env.ANT_LOCAL_ORG = 'localorg';
    process.env.ANT_LOCAL_USER = userId;
    const applied: unknown[][] = [];
    const choiceCalls: unknown[] = [];
    const republished: string[] = [];
    const reassigned: unknown[][] = [];
    const keys = new Map<string, string>();
    const resolver = {
      getPhysicalWorkspacesPath: () => wsRoot,
      getWorkspacePath: () => path.join(wsRoot, 'localorg', userId),
      getProjectPath: (_uc: unknown, projectId: string) => path.join(wsRoot, 'localorg', userId, projectId),
    };
    const app = express();
    app.use(express.json());
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
          listLiveRuns: async () => [],
          listActiveRunIds: async () => [],
          getRun: async () => opts.run ?? null,
          listPendingApprovals: async () => [],
          listApproverPendingApprovals: async () => opts.approverRows ?? [],
          approverRunAccess: async () => false,
          getHitlByGateId: async () => opts.hitl ?? null,
          applyResolvedGate: async (...args: unknown[]) => {
            applied.push(args);
            return true;
          },
          republishArmedGates: async (_owner: unknown, projectId: string) => void republished.push(projectId),
          gateCandidates: () => opts.candidates ?? ['alice', 'bob'],
          reassignGate: async (...args: unknown[]) => {
            reassigned.push(args);
            return opts.reassignOk ?? true;
          },
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
        stateStore: {
          listJobsByFeature: async () => [],
          setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
          deleteKey: async (k: string) => void keys.delete(k),
          getKey: async (k: string) => keys.get(k) ?? null,
          publish: async () => {},
        } as any,
        organizationRepository: fakeOrgRepo(
          new Map<string, OrgMembershipRole>([
            ['alice', 'member'],
            ['bob', 'member'],
          ]),
        ),
        chatService: {
          appendChoiceResolved: async (...args: unknown[]) => {
            choiceCalls.push(args);
            return { resolved: opts.resolved ?? true };
          },
        } as any,
      }),
    );
    const srv = http.createServer(app);
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    const port = (srv.address() as { port: number }).port;
    return {
      url: `http://127.0.0.1:${port}/api/definitions/pipelines`,
      applied,
      choiceCalls,
      republished,
      reassigned,
      keys,
      close: () => new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve()))),
    };
  }

  const reassign = (url: string, userId: string | null, stepId = 'budget-gate') =>
    fetch(`${url}/runs/r1/gates/${stepId}/assignee`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

  const resolveGate = (url: string, body: Record<string, unknown> = { decision: 'approve' }) =>
    fetch(`${url}/approvals/gate-r1-budget-gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('S2 — a rostered approver resolves ANOTHER member\'s gate; the chat leg runs as the OWNER, the decider is recorded separately', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const bob = await approverApp('bob', { hitl: HITL(), run: RUN() });
    try {
      const res = await resolveGate(bob.url, { decision: 'approve', note: 'checked the ledger' });
      expect(res.status).toBe(200);
      // Chat path context = the run owner's; label names the approver.
      const [, , choiceArgs] = bob.choiceCalls[0] as [string, string, any];
      expect(choiceArgs.userContext).toMatchObject({ userId: 'alice' });
      expect(choiceArgs.resolvedLabel).toBe('Approved by bob');
      // applyResolvedGate carries the approver as decidedBy + the note.
      expect(bob.applied[0]).toEqual(['pipe-gate-r1-budget-gate', 'approved', 'bob', 'api', { note: 'checked the ledger' }]);
    } finally {
      await bob.close();
    }
  });

  it('another gate\'s approver gets 404 — authority is PER GATE, never per pipeline', async () => {
    writeOwnerActivation({ 'publish-gate': ['bob'] });
    const bob = await approverApp('bob', { hitl: HITL(), run: RUN() });
    try {
      const res = await resolveGate(bob.url);
      expect(res.status).toBe(404);
      expect(bob.applied).toHaveLength(0);
    } finally {
      await bob.close();
    }
  });

  it('S6/S9 — a roster the owner has since edited is re-read LIVE: the dropped approver resolves to 404', async () => {
    writeOwnerActivation({}); // bob was removed from every roster
    const bob = await approverApp('bob', { hitl: HITL(), run: RUN() });
    try {
      expect((await resolveGate(bob.url)).status).toBe(404);
    } finally {
      await bob.close();
    }
  });

  it('kind:tool gates stay activator-scoped — a rostered approver still gets 404 (L3 is v1.5)', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const bob = await approverApp('bob', { hitl: HITL({ kind: 'tool', tool: 'run_command', jobId: 'job-1' }), run: RUN() });
    try {
      expect((await resolveGate(bob.url)).status).toBe(404);
    } finally {
      await bob.close();
    }
  });

  it('S7 — the NX loser gets 409 with who already decided', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const bob = await approverApp('bob', {
      hitl: HITL(),
      run: RUN({ decision: 'approved', decidedBy: 'carol' }),
      resolved: false,
    });
    try {
      const res = await resolveGate(bob.url);
      expect(res.status).toBe(409);
      expect((await res.json()).decidedBy).toBe('carol');
      expect(bob.applied).toHaveLength(0);
    } finally {
      await bob.close();
    }
  });

  it('S8 — the owner resolves regardless of rosters, with the unchanged label', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const alice = await approverApp('alice', { hitl: HITL(), run: RUN() });
    try {
      const res = await resolveGate(alice.url);
      expect(res.status).toBe(200);
      const [, , choiceArgs] = alice.choiceCalls[0] as [string, string, any];
      expect(choiceArgs.resolvedLabel).toBe('Approved');
      expect(alice.applied[0]).toEqual(['pipe-gate-r1-budget-gate', 'approved', 'alice', 'api', {}]);
    } finally {
      await alice.close();
    }
  });

  it('an over-cap decision note is refused with 400 before any state is touched', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const bob = await approverApp('bob', { hitl: HITL(), run: RUN() });
    try {
      const res = await resolveGate(bob.url, { decision: 'reject', note: 'x'.repeat(501) });
      expect(res.status).toBe(400);
      expect(bob.applied).toHaveLength(0);
    } finally {
      await bob.close();
    }
  });

  // ── Gate reassign — routing is a CANDIDATE's decision; authority never moves (doc 46 §5a-ii) ──
  it('reassign: the owner routes the gate to a rostered candidate; the coordinator write carries who did it', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const alice = await approverApp('alice', { hitl: HITL(), run: RUN() });
    try {
      const res = await reassign(alice.url, 'Bob');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, gateId: 'gate-r1-budget-gate', assignees: ['bob'] });
      expect(alice.reassigned).toEqual([['gate-r1-budget-gate', 'bob', 'alice']]);
    } finally {
      await alice.close();
    }
  });

  it('reassign: a candidate self-claims, and null hands the gate back to everyone', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const bob = await approverApp('bob', { hitl: HITL(), run: RUN() });
    try {
      expect((await reassign(bob.url, 'bob')).status).toBe(200);
      expect((await reassign(bob.url, null)).status).toBe(200);
      expect(bob.reassigned).toEqual([
        ['gate-r1-budget-gate', 'bob', 'bob'],
        ['gate-r1-budget-gate', null, 'bob'],
      ]);
    } finally {
      await bob.close();
    }
  });

  it('reassign: a non-candidate gets 404 (existence non-disclosure), a non-candidate TARGET gets 400 with the candidates', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const carol = await approverApp('carol', { hitl: HITL(), run: RUN() });
    const alice = await approverApp('alice', { hitl: HITL(), run: RUN() });
    try {
      expect((await reassign(carol.url, 'carol')).status).toBe(404);
      expect(carol.reassigned).toHaveLength(0);
      const res = await reassign(alice.url, 'dave');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'assignee-not-candidate', candidates: ['alice', 'bob'] });
      expect(alice.reassigned).toHaveLength(0);
    } finally {
      await carol.close();
      await alice.close();
    }
  });

  it('reassign: tool gates never route (404); a decided gate is 404; a lost write is 409', async () => {
    writeOwnerActivation({ 'budget-gate': ['bob'] });
    const tool = await approverApp('alice', { hitl: HITL({ kind: 'tool', tool: 'run_command', jobId: 'job-1' }), run: RUN() });
    const decided = await approverApp('alice', { hitl: HITL(), run: RUN({ decision: 'approved', decidedBy: 'bob' }) });
    const lost = await approverApp('alice', { hitl: HITL(), run: RUN(), reassignOk: false });
    try {
      expect((await reassign(tool.url, 'bob')).status).toBe(404);
      expect((await reassign(decided.url, 'bob')).status).toBe(404);
      expect((await reassign(lost.url, 'bob')).status).toBe(409);
    } finally {
      await tool.close();
      await decided.close();
      await lost.close();
    }
  });

  it('GET /approvals merges own rows with approver rows (role-stamped by the coordinator)', async () => {
    const row = { gateId: 'g', cardId: 'c', runId: 'r', pipelineId: 'p', pipelineName: 'P', projectId: 'proj-a', stepId: 's', prompt: '?', armedAt: 'now', role: 'approver', ownerUserId: 'alice' };
    const bob = await approverApp('bob', { approverRows: [row] });
    try {
      const res = await fetch(`${bob.url}/approvals`);
      expect(res.status).toBe(200);
      expect((await res.json()).approvals).toEqual([row]);
    } finally {
      await bob.close();
    }
  });
});

describe('activation approver rosters — activate body + the approvers PUT (activator-only)', () => {
  beforeEach(() => {
    for (const dir of ['localorg/alice', 'localorg/bob', 'individual/alice', 'individual/bob']) {
      fs.rmSync(path.join(wsRoot, dir), { recursive: true, force: true });
    }
  });

  const GATED_DEF = {
    version: 2,
    name: 'Gated',
    on: { schedule: { cron: '0 9 * * 1', tz: 'Asia/Seoul' } },
    steps: [
      { id: 'collect', customJobRef: 'research/collect', directive: 'Collect sources' },
      { id: 'budget-gate', type: 'approval', prompt: 'Approve the payout?' },
    ],
  };

  async function teamActivateApp(userId: string) {
    process.env.ANT_LOCAL_ORG = 'localorg';
    process.env.ANT_LOCAL_USER = userId;
    const republished: string[] = [];
    const keys = new Map<string, string>();
    const resolver = {
      getPhysicalWorkspacesPath: () => wsRoot,
      getWorkspacePath: () => path.join(wsRoot, 'localorg', userId),
      getProjectPath: (_uc: unknown, projectId: string) => path.join(wsRoot, 'localorg', userId, projectId),
    };
    const app = express();
    app.use(express.json());
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
          listLiveRuns: async () => [],
          listActiveRunIds: async () => [],
          getRun: async () => null,
          listPendingApprovals: async () => [],
          listApproverPendingApprovals: async () => [],
          approverRunAccess: async () => false,
          getHitlByGateId: async () => null,
          applyResolvedGate: async () => true,
          republishArmedGates: async (_owner: unknown, projectId: string) => void republished.push(projectId),
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
        stateStore: {
          listJobsByFeature: async () => [],
          setKeyWithTTL: async (k: string, v: string) => void keys.set(k, v),
          deleteKey: async (k: string) => void keys.delete(k),
          getKey: async (k: string) => keys.get(k) ?? null,
          publish: async () => {},
        } as any,
        organizationRepository: fakeOrgRepo(
          new Map<string, OrgMembershipRole>([
            ['alice', 'member'],
            ['bob', 'member'],
          ]),
        ),
      }),
    );
    const srv = http.createServer(app);
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    const port = (srv.address() as { port: number }).port;
    return {
      url: `http://127.0.0.1:${port}/api/definitions/pipelines`,
      keys,
      republished,
      close: () => new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve()))),
    };
  }

  async function scaffoldGatedActivatable(userId: string, appUrl: string): Promise<void> {
    // Personal defs of a team-kind caller anchor under the INDIVIDUAL org.
    scaffoldAgentCatalog(path.join(wsRoot, 'individual', userId, '.ant', 'agents'));
    const projDir = path.join(wsRoot, 'localorg', userId, 'proj-a');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'config.json'), JSON.stringify({ projectType: 'universal' }));
    const created = await fetch(appUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'gated', def: GATED_DEF }),
    });
    expect(created.status).toBe(201);
    expect((await fetch(`${appUrl}/gated/enable`, { method: 'POST' })).status).toBe(200);
  }

  const activationPath = (userId: string) =>
    path.join(wsRoot, 'localorg', userId, '.ant', 'pipeline-activations', 'proj-a', 'activation.json');

  it('activate accepts a per-gate roster: validated against the def\'s gates, membership-checked, indexed', async () => {
    const alice = await teamActivateApp('alice');
    try {
      await scaffoldGatedActivatable('alice', alice.url);
      // Unknown gate key → 400 naming the key.
      const badKey = await fetch(`${alice.url}/gated/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-a', approvers: { 'ghost-gate': ['bob'] } }),
      });
      expect(badKey.status).toBe(400);
      expect((await badKey.json()).code).toBe('invalid-approvers');
      // Non-member → 400 naming the member.
      const dead = await fetch(`${alice.url}/gated/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-a', approvers: { 'budget-gate': ['mallory'] } }),
      });
      expect(dead.status).toBe(400);
      expect((await dead.json()).invalidApprovers).toEqual(['mallory']);
      // Valid roster lands on the activation record + the discovery index.
      const ok = await fetch(`${alice.url}/gated/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-a', approvers: { 'budget-gate': ['bob'] } }),
      });
      expect(ok.status).toBe(200);
      const record = JSON.parse(fs.readFileSync(activationPath('alice'), 'utf-8'));
      expect(record.approvers).toEqual({ 'budget-gate': ['bob'] });
      expect(JSON.parse(alice.keys.get('ant:pipe:approver-of:localorg:bob') ?? '[]')).toEqual(['alice|proj-a']);
    } finally {
      await alice.close();
    }
  });

  it('the approvers PUT edits the live roster without deactivating and re-fires armed-gate notices (S9)', async () => {
    const alice = await teamActivateApp('alice');
    try {
      await scaffoldGatedActivatable('alice', alice.url);
      const activated = await fetch(`${alice.url}/gated/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-a', approvers: { 'budget-gate': ['bob'] } }),
      });
      expect(activated.status).toBe(200);
      const put = await fetch(`${alice.url}/activations/proj-a/approvers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvers: { 'budget-gate': ['alice'] } }),
      });
      expect(put.status).toBe(200);
      expect((await put.json()).approvers).toEqual({ 'budget-gate': ['alice'] });
      const record = JSON.parse(fs.readFileSync(activationPath('alice'), 'utf-8'));
      expect(record.approvers).toEqual({ 'budget-gate': ['alice'] });
      // Index followed the edit: bob out, alice in.
      expect(JSON.parse(alice.keys.get('ant:pipe:approver-of:localorg:bob') ?? '[]')).toEqual([]);
      expect(JSON.parse(alice.keys.get('ant:pipe:approver-of:localorg:alice') ?? '[]')).toEqual(['alice|proj-a']);
      // Armed gates re-fired to the CURRENT roster.
      expect(alice.republished).toEqual(['proj-a']);
      // Clearing the map entirely also works (activator-only again).
      const cleared = await fetch(`${alice.url}/activations/proj-a/approvers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvers: {} }),
      });
      expect(cleared.status).toBe(200);
      expect(JSON.parse(fs.readFileSync(activationPath('alice'), 'utf-8')).approvers).toBeUndefined();
    } finally {
      await alice.close();
    }
  });

  it('the approvers PUT answers 404 on a project with no activation; unknown gate keys 400', async () => {
    const alice = await teamActivateApp('alice');
    try {
      const missing = await fetch(`${alice.url}/activations/ghost/approvers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvers: {} }),
      });
      expect(missing.status).toBe(404);
      await scaffoldGatedActivatable('alice', alice.url);
      await fetch(`${alice.url}/gated/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-a' }),
      });
      const badKey = await fetch(`${alice.url}/activations/proj-a/approvers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvers: { 'ghost-gate': ['bob'] } }),
      });
      expect(badKey.status).toBe(400);
      expect((await badKey.json()).code).toBe('invalid-approvers');
    } finally {
      await alice.close();
    }
  });
});

describe('advisory lifecycle — recomputed on save and read, acknowledged in the definition', () => {
  const GATED_DEF = (extra: object = {}) => ({
    version: 2,
    name: 'Gated',
    on: { schedule: { cron: '0 9 * * 1' } },
    steps: [
      { id: 'collect', customJobRef: 'research/collect', directive: 'x' },
      { id: 'sign', type: 'approval', prompt: 'ok?' },
      { id: 'notify', customJobRef: 'research/collect', directive: 'y' },
    ],
    ...extra,
  });
  const ACK = [{ code: 'gate-waits-forever', step: 'sign', reason: 'The owner checks the inbox daily.' }];
  // Earlier groups re-point the local identity and leave org-scope state behind; this axis is the personal root of `localuser`.
  beforeEach(() => {
    process.env.ANT_LOCAL_ORG = 'localorg';
    process.env.ANT_LOCAL_USER = 'localuser';
    fs.rmSync(path.join(wsRoot, 'localorg', '.ant'), { recursive: true, force: true });
    fs.rmSync(path.join(wsRoot, 'individual'), { recursive: true, force: true });
  });

  it('a save answers the open advisory structured, apart from catalogWarnings (which it has none of)', async () => {
    const res = await api('', { method: 'POST', body: JSON.stringify({ id: 'gated', def: GATED_DEF() }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect('catalogWarnings' in body).toBe(false);
    expect(body.advisories.open.map((a: any) => [a.code, a.stepId, a.field])).toEqual([['gate-waits-forever', 'sign', 'timeout']]);
    expect(body.advisories.acknowledged).toEqual([]);
    expect(body.entry.openAdvisoryCount).toBe(1);
  });

  it('GET re-judges on read — the same advisories come back without a save', async () => {
    await api('', { method: 'POST', body: JSON.stringify({ id: 'gated', def: GATED_DEF() }) });
    const res = await api('/gated');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advisories.open.map((a: any) => a.code)).toEqual(['gate-waits-forever']);
    const list = await (await api('')).json();
    expect(list.pipelines.find((p: any) => p.id === 'gated').openAdvisoryCount).toBe(1);
  });

  it('acknowledging through PUT moves the finding out of open, into acknowledged with the reason, and the list count drops to zero', async () => {
    await api('', { method: 'POST', body: JSON.stringify({ id: 'gated', def: GATED_DEF() }) });
    const res = await api('/gated', { method: 'PUT', body: JSON.stringify({ def: GATED_DEF({ acknowledged: ACK }) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advisories.open).toEqual([]);
    expect(body.advisories.acknowledged.map((a: any) => [a.code, a.stepId, a.reason])).toEqual([['gate-waits-forever', 'sign', ACK[0].reason]]);
    expect(body.entry.openAdvisoryCount).toBe(0);
    const yaml = fs.readFileSync(path.join(userDir, '.ant/pipelines/gated/pipeline.yaml'), 'utf-8');
    expect(yaml).toMatch(/acknowledged:\n\s+- code: gate-waits-forever/);
  });

  it('a malformed acknowledgement is a 400 like any other definition error', async () => {
    const res = await api('', {
      method: 'POST',
      body: JSON.stringify({ id: 'gated', def: GATED_DEF({ acknowledged: [{ code: 'gate-waits-forever', step: 'sign', reason: '' }] }) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('invalid-pipeline-def');
    expect(body.errors.join('\n')).toMatch(/acknowledged\[0\]\.reason/);
  });

  it('fixing the shape underneath an acknowledgement reports it stale — never silently kept, never a gate', async () => {
    const fixed = GATED_DEF({
      steps: [
        { id: 'collect', customJobRef: 'research/collect', directive: 'x' },
        { id: 'sign', type: 'approval', prompt: 'ok?', remindAfter: '4h' },
        { id: 'notify', customJobRef: 'research/collect', directive: 'y' },
      ],
      acknowledged: ACK,
    });
    const res = await api('', { method: 'POST', body: JSON.stringify({ id: 'gated', def: fixed }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.advisories.open).toEqual([]);
    expect(body.advisories.stale).toEqual(ACK);
    expect((await api('/gated/enable', { method: 'POST' })).status).toBe(200);
  });

  it('a clean definition answers neither catalogWarnings nor advisories', async () => {
    const res = await api('', { method: 'POST', body: JSON.stringify({ id: 'clean', def: DEF() }) });
    const body = await res.json();
    expect('catalogWarnings' in body).toBe(false);
    expect('advisories' in body).toBe(false);
    expect(body.entry.openAdvisoryCount).toBe(0);
  });
});
