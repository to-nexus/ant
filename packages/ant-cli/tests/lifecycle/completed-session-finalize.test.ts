/**
 * Regression — StaleJobRecovery Phase 1 finalizes an already-completed
 * session instead of pausing it into limbo (idempotent-kazoo / rich-icing-mirth).
 *
 * Bug: a design/code job's graph finished (durable `jobTiming.completedAt`
 * written by the terminal `learn` node) but was SIGTERM'd during its trailing
 * best-effort `distillAssistantTurn` LLM call — before the post-graph
 * `reportResult(true)` → `finalizeTerminalJob` seal. Redis was stranded on
 * `running`, so Phase 1 saw an orphaned-running job and called
 * `pauseJob(server_crash)`, which stamped an `interruption` onto the completed
 * session. That flipped the durable `isJobCompleted=true` verdict to false
 * while the queue was drained → `canResume=false` (404 on /resume) AND no
 * finalizer path → permanent paused limbo, dismissable only to `failed`.
 *
 * Fix: before pausing, Phase 1 consults the SAME `deriveResumableState` verdict
 * the resume route / KanbanService use (read via KanbanService's single
 * file-access owner). If the session already reads `isJobCompleted`, this is a
 * missed seal — finalize it `completed` (no interruption, no poison flag),
 * exactly like Phase 2/3 reconcile other missed seals.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const runningJobs: any[] = [];
  const sessionStateByKey = new Map<string, any>();
  const acquiredLocks: string[] = [];

  const fakeStateStore: any = {
    acquireLock: vi.fn(async (key: string) => { acquiredLocks.push(key); return true; }),
    releaseLock: vi.fn(async () => {}),
    findJobsByStatus: vi.fn(async (status: string) => (status === 'running' ? runningJobs : [])),
    getJobStatus: vi.fn(async (jobId: string) => {
      const j = runningJobs.find((p) => p.jobId === jobId);
      return j ? { status: 'running' } : null;
    }),
    getJobMapping: vi.fn(async (jobId: string) => {
      const j = runningJobs.find((p) => p.jobId === jobId);
      return j ? { jobType: j.type, projectId: j.projectId, featureName: j.featureName, userContext: j.userContext } : null;
    }),
    exists: vi.fn(async () => false),
    scanJobsByFeatureIndex: vi.fn(async () => []),
  };
  const fakeJobQueue: any = {
    getStatus: vi.fn(async () => 'unknown'),
    isJobLockFresh: vi.fn(async () => false),
    getJob: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
    getJobsByState: vi.fn(async () => []),
  };
  return {
    pauseJobMock: vi.fn(async () => {}),
    finalizeMock: vi.fn(async () => {}),
    runningJobs,
    sessionStateByKey,
    acquiredLocks,
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

const { pauseJobMock, finalizeMock, runningJobs, sessionStateByKey, acquiredLocks } = h;

import { recoverStaleJobs } from '../../src/periphery/adapters/http/express/lifecycle/StaleJobRecovery';

const kanbanService: any = {
  readSessionState: vi.fn(async (projectId: string, featureName: string, jobType: string) =>
    sessionStateByKey.get(`${projectId}/${featureName}/${jobType}`),
  ),
};

const deps: any = {
  cleanupJobState: vi.fn(async () => {}),
  stateTracker: { activeJobs: new Map() },
  kanbanService,
};

const baseJob = {
  jobId: 'rich-icing-mirth',
  status: 'running',
  type: 'design',
  projectId: 'p',
  featureName: 'f',
  userContext: { userId: 'u', organizationId: 'o' },
};

function seed(job: any, sessionState: any) {
  runningJobs.length = 0;
  runningJobs.push(job);
  sessionStateByKey.clear();
  if (sessionState !== undefined) {
    sessionStateByKey.set(`${job.projectId}/${job.featureName}/${job.type}`, sessionState);
  }
  acquiredLocks.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  runningJobs.length = 0;
  sessionStateByKey.clear();
  acquiredLocks.length = 0;
});

describe('StaleJobRecovery Phase 1 — finalize already-completed sessions', () => {
  it('finalizes a graph-completed orphaned-running job as completed (not paused)', async () => {
    // The incident state: completedAt written, queue drained, no interruption.
    seed(baseJob, {
      jobId: 'rich-icing-mirth',
      taskQueue: [],
      currentTask: undefined,
      runningTasks: [],
      completedTasks: ['spec-boss-artifact-1'],
      interruption: undefined,
      jobTiming: { completedAt: '2026-07-21T15:17:59.355Z' },
    });

    await recoverStaleJobs(deps);

    expect(finalizeMock).toHaveBeenCalledTimes(1);
    const [, args] = finalizeMock.mock.calls[0] as any[];
    expect(args.jobId).toBe('rich-icing-mirth');
    expect(args.finalStatus).toBe('completed');
    expect(args.interruption).toBeUndefined();

    // Must NOT pause and must NOT acquire the poison flag (pause-path only).
    expect(pauseJobMock).not.toHaveBeenCalled();
    expect(acquiredLocks.some((k) => k.startsWith('ant:job-poisoned:'))).toBe(false);
  });

  it('still pauses (server_crash) when the queue has leftover work', async () => {
    seed(baseJob, {
      jobId: 'rich-icing-mirth',
      taskQueue: [{ id: 't2' }],
      completedTasks: ['t1'],
      jobTiming: { completedAt: undefined },
    });

    await recoverStaleJobs(deps);

    expect(finalizeMock).not.toHaveBeenCalled();
    expect(pauseJobMock).toHaveBeenCalledTimes(1);
    const [, args] = pauseJobMock.mock.calls[0] as any[];
    expect(args.interruption.reason).toBe('server_crash');
  });

  it('does NOT finalize-completed when an explicit failure interruption is persisted', async () => {
    // Drained queue + completedAt but a real failure interruption → not
    // isJobCompleted (hasExplicit). Must keep the pause path, preserving the reason.
    seed(baseJob, {
      jobId: 'rich-icing-mirth',
      taskQueue: [],
      completedTasks: ['t1'],
      interruption: { reason: 'tasks_failed', message: 'm', timestamp: 't', canResume: true },
      jobTiming: { completedAt: '2026-07-21T15:17:59.355Z' },
    });

    await recoverStaleJobs(deps);

    expect(finalizeMock).not.toHaveBeenCalled();
    expect(pauseJobMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the pause path when the session state is unreadable', async () => {
    seed(baseJob, undefined); // readSessionState → undefined
    await recoverStaleJobs(deps);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(pauseJobMock).toHaveBeenCalledTimes(1);
  });
});
