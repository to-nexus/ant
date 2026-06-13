/**
 * `such-pinning-milky` regression — `finalStatus='failed'` propagation.
 *
 * When the BullMQ "completed" event delivers a child result with
 * `outputStatus='failed'` and `hasInterruption=false` (the orchestrator
 * deadlock signature — child exits without raising an interruption),
 * `finalizeTerminalJob` calls `cleanupJobState` with
 * `finalStatus='failed'` and no interruption. Pre-fix:
 *
 *   1. `broadcastFinalUpdate` derived `SessionRun.status` purely from
 *      `interruptionReason` and fell back to `'completed'` — the session
 *      file recorded the run as completed even though 11 tasks remained
 *      in the kanbanSnapshot.
 *   2. Phase B (`appendChoicePresentedCancelled`) was gated on
 *      `interruptionReason` truthiness, so no cancelled card emitted —
 *      the chat panel showed no visual signal that the job failed.
 *
 * This test locks the two-arm fix:
 *   - `kanbanData.status` AND the SessionRun status passed to
 *     `appendJobSnapshotToSession` must be `'failed'`.
 *   - `chatService.appendChoicePresentedCancelled` must fire with a
 *     synthesised `reason='unknown'` (canResume:false) so the chat
 *     surface renders a CancelledVariant card.
 *
 * The 'completed' control case verifies we do NOT spuriously emit a
 * cancelled card on a clean completion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let capturedSessionData: any = null;
let capturedAppendArgs: { kanban?: any; status?: string } | null = null;
let stateStoreStub: {
  getJobMapping: ReturnType<typeof vi.fn>;
  getTaskQueueCheckpoint: ReturnType<typeof vi.fn>;
  getTaskQueue: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
};
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
  getSessionFilePathByJob: () => '/tmp/finalize-failed-status-session.json',
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/sessionCleanup', () => ({
  appendJobSnapshotToSession: vi.fn(async (_featurePath, _jobType, _jobId, kanban, status) => {
    capturedAppendArgs = { kanban, status };
  }),
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

function makeDeps(appendCancelledSpy: ReturnType<typeof vi.fn>) {
  return {
    workspaceResolver: {
      getFeaturePath: () => '/tmp/finalize-failed-status-feature',
    },
    workflowStateService: {
      endJob: vi.fn(async () => {}),
    },
    sessionService: {
      readSessionData: vi.fn(async () => sessionState),
    },
    kanbanService: {
      // Mirrors the real getFinalSnapshotKanbanData(.., jobId, ..) contract:
      // the built board is stamped with the TARGET jobId (Fix B), so the
      // broadcast/persist identity guard always lines up.
      getFinalSnapshotKanbanData: vi.fn(async (_p: string, _f: string, _jt: string, jobId: string) => ({
        // Mirror the such-pinning-milky shape: tasks remain in todo,
        // none in progress, some done, no interruption field.
        jobId,
        todo: Array.from({ length: 11 }, (_, i) => ({ id: `t${i}`, name: `t${i}`, type: 'ui', priority: 650 + i, description: '' })),
        inProgress: [],
        completed: Array.from({ length: 5 }, (_, i) => ({ id: `done-${i}`, name: `done-${i}`, type: 'setup', priority: 100 + i, description: '', completed: true, status: 'completed' })),
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

describe('JobCleanupManager — finalStatus propagation (such-pinning-milky regression)', () => {
  beforeEach(() => {
    capturedSessionData = null;
    capturedAppendArgs = null;
    sessionState = {
      state: {
        jobId: 'such-pinning-milky',
        parallelMode: true,
        taskQueue: [],
        runningTasks: [],
        completedTasks: [],
        completedTasksDetails: [],
      },
    };
    stateStoreStub = {
      getJobMapping: vi.fn(async () => ({
        projectId: 'proj-test',
        featureName: 'feat-test',
        jobType: 'code',
      })),
      getTaskQueueCheckpoint: vi.fn(async () => null),
      getTaskQueue: vi.fn(async () => null),
      publish: vi.fn(async () => undefined),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('finalStatus="failed" + no interruption → SessionRun.status="failed" AND kanbanData.status="failed" AND cancelled card emits', async () => {
    const appendCancelledSpy = vi.fn(async () => ({ emitted: true, cardId: 'card-1' }));
    const tracker = makeTracker('such-pinning-milky');
    const jcm = new JobCleanupManager(tracker, makeDeps(appendCancelledSpy));

    await jcm.cleanupJobState(
      'such-pinning-milky',
      'proj-test',
      'feat-test',
      undefined,        // no interruptionReason — orchestrator deadlock exit
      'code',
      undefined,
      'failed',         // finalStatus from finalizeTerminalJob
    );

    // 1. SessionRun.status persisted as 'failed'.
    expect(capturedAppendArgs).not.toBeNull();
    expect(capturedAppendArgs!.status).toBe('failed');
    // 2. kanbanData.status injected so the FE replay endpoint and
    //    JobIdDropdown both see the terminal status.
    expect(capturedAppendArgs!.kanban?.status).toBe('failed');
    // 3. Cancelled card emitted with synthesised reason — chat surface
    //    gets a CancelledVariant card despite no original interruption.
    expect(appendCancelledSpy).toHaveBeenCalledTimes(1);
    const cardPayload = appendCancelledSpy.mock.calls[0][3];
    expect(cardPayload.reason).toBe('unknown');
  });

  it('finalStatus="completed" + no interruption → SessionRun.status="completed" AND NO cancelled card', async () => {
    const appendCancelledSpy = vi.fn(async () => ({ emitted: true, cardId: 'card-2' }));
    const tracker = makeTracker('clean-job');
    tracker.getState().jobToProject.set('clean-job', {
      projectId: 'proj-test',
      featureName: 'feat-test',
      jobType: 'code',
    } as any);
    const jcm = new JobCleanupManager(tracker, makeDeps(appendCancelledSpy));

    await jcm.cleanupJobState(
      'clean-job',
      'proj-test',
      'feat-test',
      undefined,
      'code',
      undefined,
      'completed',
    );

    expect(capturedAppendArgs!.status).toBe('completed');
    expect(capturedAppendArgs!.kanban?.status).toBe('completed');
    // No cancelled card on a clean completion.
    expect(appendCancelledSpy).not.toHaveBeenCalled();
  });

  it('interruption present (user_stopped) → SessionRun.status="canceled" regardless of finalStatus', async () => {
    const appendCancelledSpy = vi.fn(async () => ({ emitted: true, cardId: 'card-3' }));
    const tracker = makeTracker('canceled-job');
    tracker.getState().jobToProject.set('canceled-job', {
      projectId: 'proj-test',
      featureName: 'feat-test',
      jobType: 'code',
    } as any);
    const jcm = new JobCleanupManager(tracker, makeDeps(appendCancelledSpy));

    await jcm.cleanupJobState(
      'canceled-job',
      'proj-test',
      'feat-test',
      {
        reason: 'user_stopped',
        message: 'User pressed Stop',
        timestamp: '2026-05-21T00:00:00Z',
        canResume: false,
      },
      'code',
      undefined,
      'failed',
    );

    expect(capturedAppendArgs!.status).toBe('canceled');
    expect(capturedAppendArgs!.kanban?.status).toBe('canceled');
    expect(appendCancelledSpy).toHaveBeenCalledTimes(1);
    const cardPayload = appendCancelledSpy.mock.calls[0][3];
    expect(cardPayload.reason).toBe('user_stopped');
  });
});
