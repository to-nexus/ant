/**
 * Feature-wide job list — `GET /projects/:id/features/:feature/jobs`.
 *
 * The endpoint used to filter by `?type=`; the dropdown is now cross-type, so
 * the route returns every sessionable job of the feature
 * (code/design/learn/plan/visual) in one list, each entry tagged with its own
 * `type`. Locks:
 *   - no `?type=` → mixed-type entries (code + design) merged from Redis (live)
 *     and the per-type session files.
 *   - `?type=code` → still narrows to that type (back-compat).
 *   - plan/visual session files ARE surfaced — they persist a `runs[]` history
 *     and must survive as selectable rows even though they render no board.
 *
 * No supertest: a real Express app + node:http server on port 0, called via fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';

// DELETE /jobs/:jobId clears BullMQ residue via the real InfrastructureFactory.
// CI runs the suite with no Redis service, so an unmocked `getJobQueue()` opens
// an ioredis socket that retries past the 30s test timeout and keeps the
// in-flight request alive (the afterEach `server.close()` then hangs too).
const jobQueueCancel = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/infrastructure/adapters/InfrastructureFactory')>()),
  getInfrastructureFactory: () => ({ getJobQueue: () => ({ cancel: jobQueueCancel }) }),
}));

import { createFeaturesRoutes } from '../../src/periphery/adapters/http/routes/features.routes';
import { getSessionFilePathByJob } from '../../src/core/utils/sessionPaths';
import type { StateStorePort } from '../../src/core/ports/stateStore';

class FakeStateStore implements Partial<StateStorePort> {
  jobs: any[] = [];
  async listJobsByFeature(): Promise<any[]> {
    return this.jobs;
  }
}

async function writeSession(featurePath: string, jobType: string, runs: any[]): Promise<void> {
  const file = getSessionFilePathByJob(featurePath, jobType);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ runs }), 'utf-8');
}

describe('GET /projects/:id/features/:feature/jobs — feature-wide', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let stateStore: FakeStateStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-jobs-route-'));
    stateStore = new FakeStateStore();

    const app = express();
    app.use(express.json());
    app.use(
      createFeaturesRoutes({
        projectService: {} as any,
        stateStore: stateStore as unknown as StateStorePort,
        workspaceResolver: { getFeaturePath: () => tmpDir },
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns mixed-type entries (code + design) when no type is given', async () => {
    await writeSession(tmpDir, 'code', [
      { jobId: 'code-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    await writeSession(tmpDir, 'design', [
      { jobId: 'design-1', timestamp: '2026-06-11T00:00:00.000Z', status: 'completed' },
    ]);

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.jobs.map((j: any) => [j.jobId, j.type]));
    expect(byId['code-1']).toBe('code');
    expect(byId['design-1']).toBe('design');
  });

  it('includes a LIVE Redis job tagged with its own type', async () => {
    stateStore.jobs = [
      { jobId: 'code-live', type: 'code', status: 'running', timestamp: '2026-06-12T00:00:00.000Z' },
    ];
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    const body = await res.json();
    const live = body.jobs.find((j: any) => j.jobId === 'code-live');
    expect(live).toBeTruthy();
    expect(live.type).toBe('code');
    expect(live.live).toBe(true);
  });

  it('narrows to a single type when ?type= is given (back-compat)', async () => {
    await writeSession(tmpDir, 'code', [
      { jobId: 'code-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    await writeSession(tmpDir, 'design', [
      { jobId: 'design-1', timestamp: '2026-06-11T00:00:00.000Z', status: 'completed' },
    ]);

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs?type=code`);
    const body = await res.json();
    const ids = body.jobs.map((j: any) => j.jobId);
    expect(ids).toContain('code-1');
    expect(ids).not.toContain('design-1');
  });

  it('surfaces plan/visual session runs (persisted history, no kanban board)', async () => {
    await writeSession(tmpDir, 'plan', [
      { jobId: 'plan-1', timestamp: '2026-06-10T00:00:00.000Z', status: 'completed' },
    ]);
    await writeSession(tmpDir, 'visual', [
      { jobId: 'visual-1', timestamp: '2026-06-11T00:00:00.000Z', status: 'completed' },
    ]);
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    const body = await res.json();
    const byId = Object.fromEntries(body.jobs.map((j: any) => [j.jobId, j.type]));
    expect(byId['plan-1']).toBe('plan');
    expect(byId['visual-1']).toBe('visual');
  });

  it('surfaces a LIVE plan Redis job and validates ?type=plan (200, not 400)', async () => {
    stateStore.jobs = [
      { jobId: 'plan-live', type: 'plan', status: 'running', timestamp: '2026-06-12T00:00:00.000Z' },
    ];
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs?type=plan`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const live = body.jobs.find((j: any) => j.jobId === 'plan-live');
    expect(live).toBeTruthy();
    expect(live.type).toBe('plan');
    expect(live.live).toBe(true);
  });
});

/**
 * DELETE parity — the run-removal rule is one rule, so the canonical plane must
 * show the same three outcomes the universal block asserts. The two planes differ
 * only in how the session file is located.
 */
describe('DELETE /jobs/:jobId — canonical plane parity', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;

  const codeSessionPath = () => getSessionFilePathByJob(tmpDir, 'code');

  const writeCodeSession = async (runs: any[], state: Record<string, unknown>) => {
    const file = codeSessionPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      sessionId: 's-1',
      project: 'p1',
      feature: 'f1',
      createdAt: '2026-06-10T00:00:00.000Z',
      updatedAt: '2026-06-10T00:00:00.000Z',
      runs,
      artifacts: {},
      state,
    }), 'utf-8');
  };
  const run = (jobId: string) => ({
    runId: 1,
    job: 'code',
    timestamp: '2026-06-10T00:00:00.000Z',
    input: { type: 'text', summary: '' },
    output: {},
    jobId,
    status: 'completed',
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-jobs-del-'));
    const stateStore = Object.assign(new FakeStateStore(), {
      getJobStatus: async () => null,
      deleteJobStatus: async () => undefined,
      deleteTaskQueue: async () => undefined,
      deleteWorkflowState: async () => undefined,
      clearUserStopped: async () => undefined,
      deleteJobMapping: async () => undefined,
      deleteKillReason: async () => undefined,
    });

    const app = express();
    app.use(express.json());
    app.use(
      createFeaturesRoutes({
        projectService: {} as any,
        stateStore: stateStore as unknown as StateStorePort,
        workspaceResolver: { getFeaturePath: () => tmpDir },
      }),
    );
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('drops the pinned run\'s checkpoint whole — canonical carries nothing across runs', async () => {
    await writeCodeSession([run('code-1'), run('code-2')], {
      jobId: 'code-1',
      taskQueue: [{ id: 't1' }],
      completedTasks: ['t0'],
      planText: 'plan',
      conversations: { 'session:main': [{ role: 'user', content: 'hi' }] },
    });

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs/code-1?type=code`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const session = JSON.parse(await fs.readFile(codeSessionPath(), 'utf-8'));
    expect(session.runs.map((r: any) => r.jobId)).toEqual(['code-2']);
    // A fresh canonical run overwrites the slot anyway — nothing is thread-owned.
    expect(session.state).toEqual({});
  });

  it('unlinks the session file once no run is left', async () => {
    await writeCodeSession([run('code-1')], { jobId: 'code-1', taskQueue: [] });

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs/code-1?type=code`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    await expect(fs.stat(codeSessionPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('collapses the run\'s chat.jsonl lines', async () => {
    await writeCodeSession([run('code-1'), run('code-2')], {});
    const chat = path.join(tmpDir, 'sessions', 'chat.jsonl');
    await fs.writeFile(
      chat,
      ['code-1', 'code-2']
        .map((id) => JSON.stringify({ ts: '2026-06-10T00:00:00.000Z', jobId: id, turnId: 't', jobType: 'code', type: 'user_turn' }))
        .join('\n') + '\n',
      'utf-8',
    );

    await fetch(`${baseUrl}/projects/p1/features/f1/jobs/code-1?type=code`, { method: 'DELETE' });

    const lines = (await fs.readFile(chat, 'utf-8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.find((l) => l.jobId === 'code-1').collapsed).toBe(true);
    expect(lines.find((l) => l.jobId === 'code-2').collapsed).toBeUndefined();
  });
});

/**
 * Universal rows — history/restore/DELETE must resolve the CONTAINER
 * (`{project}/universal`), never the phantom `{project}/features/universal`
 * the canonical resolver fabricates, and must read/write the
 * per-(agentId, customJobId) session file.
 */
describe('feature routes — universal container (phantom-path regression)', () => {
  let projectDir: string;
  let server: http.Server;
  let baseUrl: string;
  let stateStore: FakeStateStore & Record<string, any>;

  const containerDir = () => path.join(projectDir, 'universal');
  const uniSessionPath = () => path.join(containerDir(), 'sessions', 'assistant', 'chat.json');
  const phantomDir = () => path.join(projectDir, 'features', 'universal');

  const seedUniversalSession = async (runs: any[], extraState: Record<string, unknown> = {}) => {
    await fs.mkdir(path.dirname(uniSessionPath()), { recursive: true });
    await fs.writeFile(uniSessionPath(), JSON.stringify({
      sessionId: 's-1',
      project: 'p1',
      feature: 'universal',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      runs,
      artifacts: {},
      state: {
        customJobRef: 'assistant/chat',
        conversations: { 'session:main': [{ role: 'user', content: 'hi' }] },
        ...extraState,
      },
    }), 'utf-8');
  };
  const seedChatLog = async (jobIds: string[]) => {
    const chat = path.join(containerDir(), 'sessions', 'chat.jsonl');
    await fs.mkdir(path.dirname(chat), { recursive: true });
    await fs.writeFile(
      chat,
      jobIds
        .map((id) => JSON.stringify({ ts: '2026-08-15T00:00:00.000Z', jobId: id, turnId: 't', jobType: 'universal', type: 'user_turn' }))
        .join('\n') + '\n',
      'utf-8',
    );
    return chat;
  };
  const sealedRun = (jobId: string) => ({
    runId: 1,
    job: 'universal',
    timestamp: '2026-08-15T13:48:00.000Z',
    input: { type: 'text', summary: '' },
    output: {},
    jobId,
    status: 'completed',
    completedAt: '2026-08-15T13:48:42.000Z',
    customJobRef: 'assistant/chat',
    kanbanSnapshot: { jobId, todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session', status: 'completed' },
  });

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-uni-route-'));
    await fs.writeFile(path.join(projectDir, 'config.json'), JSON.stringify({ projectType: 'universal' }), 'utf-8');

    stateStore = Object.assign(new FakeStateStore(), {
      getJobStatus: async () => null,
      deleteJobStatus: async () => undefined,
      deleteTaskQueue: async () => undefined,
      deleteWorkflowState: async () => undefined,
      clearUserStopped: async () => undefined,
      deleteJobMapping: async () => undefined,
      deleteKillReason: async () => undefined,
    });

    const app = express();
    app.use(express.json());
    app.use(
      createFeaturesRoutes({
        projectService: {} as any,
        stateStore: stateStore as unknown as StateStorePort,
        workspaceResolver: {
          getProjectPath: () => projectDir,
          // The universal-unaware canonical resolution — the pre-fix bug read
          // this phantom path and found nothing.
          getFeaturePath: () => phantomDir(),
        },
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('lists a sealed universal run (type + customJobRef) without touching the phantom path', async () => {
    await seedUniversalSession([sealedRun('uni-1')]);

    const res = await fetch(`${baseUrl}/projects/p1/features/universal/jobs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.jobs.find((j: any) => j.jobId === 'uni-1');
    expect(row).toMatchObject({ type: 'universal', status: 'completed', customJobRef: 'assistant/chat', live: false });

    // Phantom-path regression: nothing may create `{project}/features/universal`.
    await expect(fs.stat(phantomDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('merges a LIVE universal Redis job with sealed rows for other jobIds', async () => {
    await seedUniversalSession([sealedRun('uni-old')]);
    stateStore.jobs = [
      { jobId: 'uni-live', type: 'universal', status: 'running', timestamp: '2026-08-16T00:00:00.000Z' },
    ];

    const body = await (await fetch(`${baseUrl}/projects/p1/features/universal/jobs`)).json();
    const byId = Object.fromEntries(body.jobs.map((j: any) => [j.jobId, j]));
    expect(byId['uni-live'].live).toBe(true);
    expect(byId['uni-old'].live).toBe(false);
    expect(byId['uni-old'].customJobRef).toBe('assistant/chat');
  });

  it('canonical features never probe universal rows (no container ⇒ no universal probe)', async () => {
    // A canonical feature on this project resolves through getFeaturePath;
    // the universal branch must skip instead of probing sessions/universal/.
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/jobs`);
    expect(res.status).toBe(200);
    expect((await res.json()).jobs).toEqual([]);
  });

  it('restores a sealed universal kanban snapshot by jobId from the container file', async () => {
    await seedUniversalSession([sealedRun('uni-1')]);

    const res = await fetch(`${baseUrl}/projects/p1/features/universal/kanban?jobId=uni-1&type=universal`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toBe('uni-1');
    expect(body.status).toBe('completed');
  });

  it('DELETE ?type=universal removes only the run from the container file (conversations intact)', async () => {
    await seedUniversalSession([sealedRun('uni-1'), sealedRun('uni-2')]);

    const res = await fetch(`${baseUrl}/projects/p1/features/universal/jobs/uni-1?type=universal`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(jobQueueCancel).toHaveBeenCalledWith('uni-1');

    const session = JSON.parse(await fs.readFile(uniSessionPath(), 'utf-8'));
    expect(session.runs.map((r: any) => r.jobId)).toEqual(['uni-2']);
    // Universal invariant: no canonical task-state keys injected, memory intact.
    expect(session.state.conversations['session:main']).toHaveLength(1);
    expect('taskQueue' in session.state).toBe(false);
    expect('completedTasks' in session.state).toBe(false);
    // Phantom plane still absent after the full DELETE pipeline.
    await expect(fs.stat(phantomDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('DELETE drops the pinned run\'s checkpoint — the thread keeps only its memory', async () => {
    await seedUniversalSession([sealedRun('uni-1'), sealedRun('uni-2')], {
      jobId: 'uni-1',
      checklist: { items: [{ id: 'item-1', text: 'x', state: 'done' }] },
      tokenUsage: { totalTokens: 42 },
      lastTurnHooks: [{ intentId: 'build', hook: 'artifact', met: true }],
    });

    const res = await fetch(`${baseUrl}/projects/p1/features/universal/jobs/uni-1?type=universal`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const session = JSON.parse(await fs.readFile(uniSessionPath(), 'utf-8'));
    expect(session.runs.map((r: any) => r.jobId)).toEqual(['uni-2']);
    // Exactly the cross-run keys survive — the board no longer shows a
    // checklist the disk still held.
    expect(Object.keys(session.state).sort()).toEqual(['conversations', 'customJobRef']);
  });

  it('DELETE of the LAST run unlinks the session file and prunes the agent dir', async () => {
    await seedUniversalSession([sealedRun('uni-1')], { jobId: 'uni-1' });

    const res = await fetch(`${baseUrl}/projects/p1/features/universal/jobs/uni-1?type=universal`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    await expect(fs.stat(uniSessionPath())).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.dirname(uniSessionPath()))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('DELETE collapses the run\'s chat.jsonl lines and leaves other runs alone', async () => {
    await seedUniversalSession([sealedRun('uni-1'), sealedRun('uni-2')]);
    const chat = await seedChatLog(['uni-1', 'uni-2']);

    await fetch(`${baseUrl}/projects/p1/features/universal/jobs/uni-1?type=universal`, { method: 'DELETE' });

    const lines = (await fs.readFile(chat, 'utf-8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.find((l) => l.jobId === 'uni-1').collapsed).toBe(true);
    expect(lines.find((l) => l.jobId === 'uni-2').collapsed).toBeUndefined();
  });
});
