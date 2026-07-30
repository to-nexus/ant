/**
 * `prime-nesting-grate` regression — repair-mode re-card must not mask
 * the recorded interruption reason.
 *
 * StaleJobRecovery Phase 1b re-drives `pauseJob` for a paused job whose
 * cancelled/resume card was never emitted. Pre-fix it passed a hardcoded
 * `buildInfrastructureInterruption('server_crash')`, and cleanupJobState
 * unconditionally overwrote the session's recorded interruption — a real
 * `tasks_failed` pause was re-labeled "Server was terminated unexpectedly",
 * misleading the user (and the RCA) into a crash investigation.
 *
 * Fix: `pauseJob({ preferSessionInterruption: true })` → cleanupJobState
 * treats the session's recorded interruption for THIS job as the truth;
 * the caller's interruption is only a fallback when nothing was recorded.
 * Event-mode callers (SIGTERM / stalled / worker RESULT) omit the flag so
 * their fresh reason still wins.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { InterruptionDetails } from '@ant/shared';

/**
 * Real shape of `ChatService.appendChoicePresentedCancelled` (see
 * JobCleanupManager). The spy MUST carry it: the assertions below read
 * `calls[0][3]`, and an untyped `vi.fn(async () => …)` infers a zero-arg
 * signature, so the 4th argument is not merely unchecked — it is out of bounds.
 */
type AppendChoicePresentedCancelled = (
  projectId: string,
  featureName: string,
  jobId: string,
  opts: {
    reason: string;
    message: string;
    jobType?: string;
    designErrorType?: string;
    userContext?: unknown;
  },
) => Promise<{ emitted: boolean; cardId: string }>;

let capturedSessionData: any = null;
let stateStoreStub: any;
let sessionState: any = null;

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getStateStore: () => stateStoreStub,
  }),
}));

vi.mock('../../src/core/utils/atomicWriteFile', () => ({
  atomicWriteFile: vi.fn(async (_path: string, content: string) => {
    capturedSessionData = JSON.parse(content);
  }),
}));

vi.mock('../../src/core/utils/sessionPaths', () => ({
  getSessionFilePathByJob: () => '/tmp/recard-preserve-session.json',
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/sessionCleanup', () => ({
  appendJobSnapshotToSession: vi.fn(async () => {}),
  sealJobRedisState: vi.fn(async () => {}),
}));

vi.mock('../../src/infrastructure/state', () => ({
  getRealtimeBroadcastChannel: () => 'rt:test:channel',
}));

const jcmMod = await import(
  '../../src/periphery/adapters/http/express/managers/JobCleanupManager'
);
const { JobCleanupManager } = jcmMod;
const trackerMod = await import(
  '../../src/periphery/adapters/http/express/managers/JobStateTracker'
);
const { JobStateTracker } = trackerMod;

const JOB_ID = 'prime-nesting-grate';

const TASKS_FAILED: InterruptionDetails = {
  reason: 'tasks_failed',
  message: '1 task(s) failed — job paused',
  timestamp: '2026-07-13T10:01:48.958Z',
  canResume: true,
};

const SERVER_CRASH: InterruptionDetails = {
  reason: 'server_crash',
  message: 'Server was terminated unexpectedly. You can resume this job.',
  timestamp: '2026-07-13T10:04:41.833Z',
  canResume: true,
};

function makeDeps(appendCancelledSpy: Mock<AppendChoicePresentedCancelled>) {
  return {
    workspaceResolver: {
      getFeaturePath: () => '/tmp/recard-preserve-feature',
    },
    workflowStateService: { endJob: vi.fn(async () => {}) },
    sessionService: { readSessionData: vi.fn(async () => sessionState) },
    kanbanService: {
      getFinalSnapshotKanbanData: vi.fn(async (_p: string, _f: string, _jt: string, jobId: string) => ({
        jobId,
        todo: [],
        inProgress: [],
        completed: [],
        isEstimating: false,
        dataSource: 'session' as const,
      })),
    },
    chatService: {
      clearAllTurnBuffers: vi.fn(async () => {}),
      appendChoicePresentedCancelled: appendCancelledSpy,
    },
    workspaceService: {},
    portManager: {},
    portRegistry: {},
    ideService: {},
    gitWatcherService: {},
    projectService: {},
    graphMetadataService: {},
    githubAuthService: {},
    jobPrerequisitesAdapter: {},
  } as any;
}

function makeTracker(jobId: string) {
  const tracker = new JobStateTracker();
  tracker.getState().jobToProject.set(jobId, {
    projectId: 'proj-test',
    featureName: 'feat-test',
    jobType: 'code',
  } as any);
  return tracker;
}

async function runCleanup(opts: {
  preferSessionInterruption?: boolean;
  provided?: typeof SERVER_CRASH;
}) {
  const appendCancelledSpy = vi.fn<AppendChoicePresentedCancelled>(async () => ({
    emitted: true,
    cardId: 'card-1',
  }));
  const manager = new JobCleanupManager(makeTracker(JOB_ID), makeDeps(appendCancelledSpy));
  await manager.cleanupJobState(
    JOB_ID,
    'proj-test',
    'feat-test',
    opts.provided ?? SERVER_CRASH,
    'code',
    { userId: 'probe@to.nexus', organizationId: 'individual' },
    'paused',
    opts.preferSessionInterruption ? { preferSessionInterruption: true } : undefined,
  );
  return appendCancelledSpy;
}

describe('cleanupJobState — preferSessionInterruption (prime-nesting-grate regression)', () => {
  beforeEach(() => {
    capturedSessionData = null;
    sessionState = {
      state: {
        jobId: JOB_ID,
        parallelMode: false,
        taskQueue: [],
        runningTasks: [],
        completedTasks: [],
        completedTasksDetails: [],
        interruption: { ...TASKS_FAILED },
      },
    };
    stateStoreStub = {
      getJobMapping: vi.fn(async () => ({
        projectId: 'proj-test',
        featureName: 'feat-test',
        jobType: 'code',
        userContext: { userId: 'probe@to.nexus', organizationId: 'individual' },
      })),
      getTaskQueueCheckpoint: vi.fn(async () => null),
      getTaskQueue: vi.fn(async () => null),
      publish: vi.fn(async () => undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('repair mode: recorded tasks_failed wins over caller server_crash (session + card)', async () => {
    const cardSpy = await runCleanup({ preferSessionInterruption: true });

    // Session keeps the recorded reason — not overwritten to server_crash.
    expect(capturedSessionData?.state?.interruption?.reason).toBe('tasks_failed');
    // The re-driven card carries the true reason too.
    expect(cardSpy).toHaveBeenCalledTimes(1);
    const args = cardSpy.mock.calls[0][3];
    expect(args.reason).toBe('tasks_failed');
    expect(args.message).toBe(TASKS_FAILED.message);
  });

  it('event mode (no flag): caller interruption still wins', async () => {
    const cardSpy = await runCleanup({});

    expect(capturedSessionData?.state?.interruption?.reason).toBe('server_crash');
    const args = cardSpy.mock.calls[0][3];
    expect(args.reason).toBe('server_crash');
  });

  it('repair mode with a STALE recorded interruption (different jobId) falls back to caller', async () => {
    sessionState.state.jobId = 'some-older-job';
    const cardSpy = await runCleanup({ preferSessionInterruption: true });

    expect(capturedSessionData?.state?.interruption?.reason).toBe('server_crash');
    const args = cardSpy.mock.calls[0][3];
    expect(args.reason).toBe('server_crash');
  });

  it('repair mode with NO recorded interruption falls back to caller', async () => {
    sessionState.state.interruption = undefined;
    const cardSpy = await runCleanup({ preferSessionInterruption: true });

    expect(capturedSessionData?.state?.interruption?.reason).toBe('server_crash');
    const args = cardSpy.mock.calls[0][3];
    expect(args.reason).toBe('server_crash');
  });
});
