/**
 * Phase 7 — `cancelScopedJobs` generic helper SSOT.
 *
 * Locks the 4-step cascade (markUserStopped + setKillReason → jobQueue.cancel
 * → sealJobRedisState → waitForJobChildExit) so both `cancelAllProjectJobs`
 * (project scope) and `ProjectService.cancelFeatureJobs` (feature scope) get
 * identical behavior — the only difference is the upstream `jobs[]` filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cancelScopedJobs } from '../../src/periphery/adapters/http/services/ProjectService/projectJobCascade';
import type { StateStorePort, JobStatusData } from '../../src/core/ports/stateStore';
import type { JobQueuePort } from '../../src/core/ports/queue';
import type { UserContext } from '../../src/core/types/user';

vi.mock('../../src/periphery/adapters/http/routes/helpers/sessionCleanup', () => ({
  sealJobRedisState: vi.fn(async () => undefined),
}));

import { sealJobRedisState } from '../../src/periphery/adapters/http/routes/helpers/sessionCleanup';

function makeStateStore(): StateStorePort & {
  marked: string[];
  killReasons: Array<{ jobId: string; reason: string }>;
} {
  const marked: string[] = [];
  const killReasons: Array<{ jobId: string; reason: string }> = [];
  return {
    marked,
    killReasons,
    markUserStopped: vi.fn(async (jobId: string) => { marked.push(jobId); }),
    setKillReason: vi.fn(async (jobId: string, reason: string) => { killReasons.push({ jobId, reason }); }),
    // After seal, getJobStatus returns null/undefined → treated as terminal,
    // so waitForJobChildExit returns immediately.
    getJobStatus: vi.fn(async () => null),
  } as unknown as StateStorePort & {
    marked: string[];
    killReasons: Array<{ jobId: string; reason: string }>;
  };
}

function makeJobQueue(): JobQueuePort & { cancelled: string[] } {
  const cancelled: string[] = [];
  return {
    cancelled,
    cancel: vi.fn(async (jobId: string) => { cancelled.push(jobId); }),
  } as unknown as JobQueuePort & { cancelled: string[] };
}

const ctx: UserContext = { userId: 'u1', organizationId: 'o1', email: 'u@example.com' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancelScopedJobs — 4-step cascade SSOT', () => {
  it('runs mark+killReason → cancel → seal → wait for every job', async () => {
    const stateStore = makeStateStore();
    const jobQueue = makeJobQueue();

    const jobs: JobStatusData[] = [
      { jobId: 'job-1', status: 'running' } as any,
      { jobId: 'job-2', status: 'paused' } as any,
    ];

    await cancelScopedJobs({
      stateStore,
      jobQueue,
      jobs,
      scope: 'feature: foo/bar',
      killReason: 'feature_delete_cascade',
      userContext: ctx,
      childExitTimeoutMs: 1000,
    });

    expect(stateStore.marked).toEqual(['job-1', 'job-2']);
    expect(stateStore.killReasons).toEqual([
      { jobId: 'job-1', reason: 'feature_delete_cascade' },
      { jobId: 'job-2', reason: 'feature_delete_cascade' },
    ]);
    expect(jobQueue.cancelled).toEqual(['job-1', 'job-2']);
    expect((sealJobRedisState as any).mock.calls.map((c: any) => c[2])).toEqual(['job-1', 'job-2']);
  });

  it('is a no-op when jobs[] is empty (idempotent)', async () => {
    const stateStore = makeStateStore();
    const jobQueue = makeJobQueue();

    await cancelScopedJobs({
      stateStore,
      jobQueue,
      jobs: [],
      scope: 'feature: foo/bar',
      killReason: 'feature_delete_cascade',
      userContext: ctx,
    });

    expect(stateStore.marked).toEqual([]);
    expect(jobQueue.cancelled).toEqual([]);
    expect(sealJobRedisState).not.toHaveBeenCalled();
  });

  it('swallows per-job errors so a single stuck job cannot block deletion', async () => {
    const stateStore = makeStateStore();
    (stateStore.markUserStopped as any) = vi.fn(async () => {
      throw new Error('redis blip');
    });
    const jobQueue = makeJobQueue();

    const jobs: JobStatusData[] = [{ jobId: 'job-x', status: 'running' } as any];

    await expect(
      cancelScopedJobs({
        stateStore,
        jobQueue,
        jobs,
        scope: 'project: p',
        killReason: 'project_delete_cascade',
        userContext: ctx,
      }),
    ).resolves.toBeUndefined();

    // Even though markUserStopped threw, cancel + seal still ran.
    expect(jobQueue.cancelled).toEqual(['job-x']);
  });

  it('uses caller-supplied killReason — distinct project vs feature labels', async () => {
    const stateStore = makeStateStore();
    const jobQueue = makeJobQueue();

    await cancelScopedJobs({
      stateStore,
      jobQueue,
      jobs: [{ jobId: 'j1', status: 'running' } as any],
      scope: 'project: foo',
      killReason: 'project_delete_cascade',
      userContext: ctx,
    });

    expect(stateStore.killReasons[0]?.reason).toBe('project_delete_cascade');

    stateStore.killReasons.length = 0;

    await cancelScopedJobs({
      stateStore,
      jobQueue,
      jobs: [{ jobId: 'j2', status: 'running' } as any],
      scope: 'feature: foo/bar',
      killReason: 'feature_delete_cascade',
      userContext: ctx,
    });

    expect(stateStore.killReasons[0]?.reason).toBe('feature_delete_cascade');
  });
});
