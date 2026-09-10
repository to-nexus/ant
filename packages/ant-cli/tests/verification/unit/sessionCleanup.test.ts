import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  sealJobRedisState,
  scrubJobDebugArtifacts,
} from '../../../src/periphery/adapters/http/routes/helpers/sessionCleanup';
import {
  removeRunFromSessionFile,
  CROSS_RUN_STATE_KEYS,
} from '../../../src/core/session/runRemoval';
import { SESSIONABLE_JOB_TYPES } from '@ant/shared';

describe('sessionCleanup debug artifact policy', () => {
  let featurePath: string;
  const jobId = 'clean-handing-dream';

  beforeEach(async () => {
    featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-session-cleanup-'));
    await fs.mkdir(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs'), { recursive: true });
    await fs.mkdir(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens'), { recursive: true });

    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`),
      '{"events":[]}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`),
      '{"tokens":[]}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', 'log-another-job.json'),
      '{"events":[]}',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(featurePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('sealJobRedisState seals redis/in-memory state but keeps debug files on disk', async () => {
    const stateStore = {
      deleteJobStatus: vi.fn().mockResolvedValue(undefined),
      deleteTaskQueue: vi.fn().mockResolvedValue(undefined),
      deleteWorkflowState: vi.fn().mockResolvedValue(undefined),
      clearUserStopped: vi.fn().mockResolvedValue(undefined),
      deleteJobMapping: vi.fn().mockResolvedValue(undefined),
      deleteKillReason: vi.fn().mockResolvedValue(undefined),
    } as any;
    const kanbanService = {
      clearJobMemory: vi.fn().mockResolvedValue(undefined),
    } as any;

    await sealJobRedisState(stateStore, kanbanService, jobId);

    expect(stateStore.deleteJobStatus).toHaveBeenCalledWith(jobId);
    expect(kanbanService.clearJobMemory).toHaveBeenCalledWith(jobId);

    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`)),
    ).resolves.toBeUndefined();
  });

  it('scrubJobDebugArtifacts removes only files tied to the target jobId', async () => {
    await scrubJobDebugArtifacts(featurePath, 'design', jobId);

    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', `log-${jobId}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens', `token-${jobId}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(featurePath, 'sessions', 'architect', 'debug', 'logs', 'log-another-job.json')),
    ).resolves.toBeUndefined();
  });
});

/**
 * The run-removal rule is ONE rule for every job type — the axis this table
 * pins. Two hand-maintained erase lists (canonical / universal) is the shape
 * that let universal clear 1 of the 19 keys its seal writes, so the assertion
 * is on the SURVIVING key set, not on a list of keys that went.
 */
describe('removeRunFromSessionFile — one rule across job types', () => {
  let root: string;
  const jobId = 'muted-judging-globe';
  const otherJob = 'brisk-waiting-otter';

  /** Every key a seal might leave behind, so "what survives" is falsifiable. */
  const RUN_OWNED = {
    jobId,
    checklist: { items: [{ id: 'item-1', text: 'x', state: 'done' }] },
    tokenUsage: { totalTokens: 42 },
    lastTurnHooks: [{ intentId: 'build', hook: 'artifact', met: true }],
    awaitingClarify: true,
    taskQueue: [{ id: 't1' }],
    completedTasks: ['t0'],
    planText: 'plan',
    resolvedAction: { intent: 'build' },
  };
  const THREAD_OWNED = {
    conversations: { 'session:main': [{ role: 'user', content: 'hi' }] },
    conversationChannel: 'session:main',
    customJobRef: 'pipeline-builder/author',
  };

  const sessionAt = (p: string, runIds: string[], state: Record<string, unknown>) =>
    JSON.stringify({
      sessionId: '11111111-1111-4111-8111-111111111111',
      project: 'p1',
      feature: 'f1',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      runs: runIds.map((id, i) => ({
        runId: i + 1,
        job: 'universal',
        timestamp: '2026-09-08T00:00:00.000Z',
        input: { type: 'text', summary: '' },
        output: {},
        jobId: id,
        status: 'completed',
      })),
      artifacts: {},
      state,
    });

  async function seed(runIds: string[], state: Record<string, unknown>): Promise<string> {
    const p = path.join(root, 'sessions', 'agent', 'job.json');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, sessionAt(p, runIds, state), 'utf-8');
    return p;
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-run-removal-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(SESSIONABLE_JOB_TYPES)(
    '%s: deleting the pinned run leaves exactly the cross-run keys',
    async (jobType) => {
      // Another run keeps the file alive so the surviving state is observable.
      const p = await seed([jobId, otherJob], { ...RUN_OWNED, ...THREAD_OWNED });

      const res = await removeRunFromSessionFile(p, jobId, jobType);

      expect(res).toEqual({ mutated: true, unlinked: false });
      const after = JSON.parse(await fs.readFile(p, 'utf-8'));
      expect(after.runs.map((r: any) => r.jobId)).toEqual([otherJob]);
      expect(Object.keys(after.state).sort()).toEqual([...CROSS_RUN_STATE_KEYS[jobType]].sort());
    },
  );

  it('unlinks the file — and prunes the agent dir — once no run is left', async () => {
    const p = await seed([jobId], { ...RUN_OWNED, ...THREAD_OWNED });

    const res = await removeRunFromSessionFile(p, jobId, 'universal');

    expect(res).toEqual({ mutated: true, unlinked: true });
    await expect(fs.access(p)).rejects.toThrow();
    await expect(fs.access(path.dirname(p))).rejects.toThrow();
  });

  it('keeps a runless file whose state is pinned to ANOTHER (unsealed) run', async () => {
    const p = await seed([jobId], { ...THREAD_OWNED, jobId: otherJob });

    const res = await removeRunFromSessionFile(p, jobId, 'universal');

    expect(res).toEqual({ mutated: true, unlinked: false });
    const after = JSON.parse(await fs.readFile(p, 'utf-8'));
    expect(after.runs).toEqual([]);
    // The other run still owns the slot — its checkpoint is untouched.
    expect(after.state.jobId).toBe(otherJob);
  });

  it('is a no-op for a jobId the file does not carry', async () => {
    const p = await seed([otherJob], { ...THREAD_OWNED, jobId: otherJob });
    const before = await fs.readFile(p, 'utf-8');

    expect(await removeRunFromSessionFile(p, jobId, 'universal')).toEqual({
      mutated: false,
      unlinked: false,
    });
    expect(await fs.readFile(p, 'utf-8')).toBe(before);
  });

  it('is a no-op for a missing file', async () => {
    expect(
      await removeRunFromSessionFile(path.join(root, 'nope.json'), jobId, 'code'),
    ).toEqual({ mutated: false, unlinked: false });
  });
});
