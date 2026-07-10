/**
 * Regression — StaleJobRecovery Phase 1b re-cards paused jobs whose
 * cancel/resume chat card was never successfully emitted (slow-earning-heron).
 *
 * Bug: a code job crashed, was resumed (which wiped the Redis turnId anchor),
 * then crashed again. The second interruption's `appendChoicePresentedCancelled`
 * hit `no turn anchor` and silently skipped emission, so the job sat `paused`
 * and resumable but with NO chat card — the read-side KanbanService self-heal
 * healed the board forever while the chat card stayed absent.
 *
 * Fix: the reconciliation owner (runs on boot + every 90s) sweeps `paused` jobs
 * and re-drives `pauseJob(server_crash)` for any that is (a) a resumable jobType
 * (code/design/learn — the buildInfrastructureInterruption gate) and (b) uncarded
 * (the `ant:chat:cancelled-emitted:job:{id}` NX flag is absent). Idempotent via
 * the pause lock + card NX guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted so the vi.mock factories (also hoisted) can reference them safely.
const h = vi.hoisted(() => {
  const cardedKeys = new Set<string>();
  const pausedJobs: any[] = [];
  const fakeStateStore: any = {
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => {}),
    findJobsByStatus: vi.fn(async (status: string) => (status === 'paused' ? pausedJobs : [])),
    getJobMapping: vi.fn(async (jobId: string) => {
      const j = pausedJobs.find((p) => p.jobId === jobId);
      return j ? { jobType: j.type, projectId: j.projectId, featureName: j.featureName, userContext: j.userContext } : null;
    }),
    exists: vi.fn(async (key: string) => cardedKeys.has(key)),
    getJobStatus: vi.fn(async () => null),
    scanJobsByFeatureIndex: vi.fn(async () => []),
  };
  const fakeJobQueue: any = {
    getJobsByState: vi.fn(async () => []),
    getStatus: vi.fn(async () => 'unknown'),
    isJobLockFresh: vi.fn(async () => false),
    getJob: vi.fn(async () => null),
  };
  return {
    pauseJobMock: vi.fn(async () => {}),
    finalizeMock: vi.fn(async () => {}),
    cardedKeys,
    pausedJobs,
    fakeStateStore,
    fakeJobQueue,
  };
});

vi.mock('../../src/periphery/adapters/http/express/lifecycle/pauseJob', () => ({
  pauseJob: h.pauseJobMock,
}));
vi.mock('../../src/periphery/adapters/http/express/lifecycle/finalizeTerminalJob', () => ({
  finalizeTerminalJob: h.finalizeMock,
}));
vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getStateStore: () => h.fakeStateStore,
    getJobQueue: () => h.fakeJobQueue,
  }),
}));

const { pauseJobMock, cardedKeys, pausedJobs, fakeStateStore } = h;

import { recoverStaleJobs } from '../../src/periphery/adapters/http/express/lifecycle/StaleJobRecovery';

const deps: any = {
  cleanupJobState: vi.fn(async () => {}),
  stateTracker: { activeJobs: new Map() },
};

function seedPaused(jobs: any[], carded: string[] = []) {
  pausedJobs.length = 0;
  pausedJobs.push(...jobs);
  cardedKeys.clear();
  carded.forEach((id) => cardedKeys.add(`ant:chat:cancelled-emitted:job:${id}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  pausedJobs.length = 0;
  cardedKeys.clear();
});

const codeJob = { jobId: 'slow-earning-heron', status: 'paused', type: 'code', projectId: 'p', featureName: 'f', userContext: { userId: 'u', organizationId: 'o' } };

describe('StaleJobRecovery Phase 1b — re-card uncarded paused jobs', () => {
  it('re-drives pauseJob(server_crash) for an uncarded resumable code job', async () => {
    seedPaused([codeJob]);
    await recoverStaleJobs(deps);
    expect(pauseJobMock).toHaveBeenCalledTimes(1);
    const [, args] = pauseJobMock.mock.calls[0] as any[];
    expect(args.jobId).toBe('slow-earning-heron');
    expect(args.jobType).toBe('code');
    expect(args.interruption.reason).toBe('server_crash');
    expect(args.interruption.canResume).toBe(true);
  });

  it('skips a paused job that is already carded (NX flag present)', async () => {
    seedPaused([codeJob], ['slow-earning-heron']);
    await recoverStaleJobs(deps);
    expect(pauseJobMock).not.toHaveBeenCalled();
  });

  it('skips plan/visual paused jobs (not mid-graph resumable — no resume card)', async () => {
    seedPaused([{ ...codeJob, jobId: 'plan-job', type: 'plan' }]);
    await recoverStaleJobs(deps);
    expect(pauseJobMock).not.toHaveBeenCalled();
  });

  it('skips when the per-job recovery lock is held by another pod', async () => {
    seedPaused([codeJob]);
    // First acquireLock (global RECOVERY_LOCK) succeeds; the per-job lock fails.
    fakeStateStore.acquireLock.mockImplementation(async (key: string) =>
      key.startsWith('ant:recovery:job:') ? false : true,
    );
    await recoverStaleJobs(deps);
    expect(pauseJobMock).not.toHaveBeenCalled();
  });
});
