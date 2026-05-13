/**
 * Regression — `JobCleanupManager.cleanupJobState` parallel-mode terminal
 * write MUST clear `state.runningTasks` after projecting in-flight tasks
 * onto `state.taskQueue` head with `interrupted:true`.
 *
 * Bug (job `ultra-fusing-scone`): after `/jobs/:id/stop`, the active task
 * stays stuck in the Kanban "In Progress" column with no Paused badge,
 * even after a page refresh. Root cause: JCM rewrote `state.taskQueue`
 * (projecting interrupted tasks at the head) but did NOT touch
 * `state.runningTasks`. `KanbanService.buildSessionKanbanData` reads
 * `state.runningTasks` to derive the "In Progress" column and splits by
 * `t.interrupted === true`. If the worker's handleInterruption snapshot
 * lost the race to JCM (typical, because the HTTP handler awaits finalize
 * immediately after publishing STOP), `state.runningTasks` carried a stale
 * pre-interrupt entry without the flag — rendered as live in-progress with
 * no badge. `runningIds` (built from `runningTasks`) also filtered the
 * JCM-projected interrupted copy out of the "To Do" column, so the task
 * vanished from where the user expected it.
 *
 * The fix enforces a single durable invariant: after a terminal-state
 * parallel-mode session write, `state.runningTasks` is always `[]`. Every
 * in-flight task that was alive at finalize time is in `state.taskQueue`
 * head with `interrupted:true`. This test exercises all three sub-branches
 * of JCM's parallel-mode cleanup to lock the invariant in place.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Module-level state captured by the spies below ────────────────────
let capturedSessionData: any = null;
let stateStoreStub: {
  getJobMapping: ReturnType<typeof vi.fn>;
  getTaskQueueCheckpoint: ReturnType<typeof vi.fn>;
  getTaskQueue: ReturnType<typeof vi.fn>;
};
let sessionState: any = null;

// ─── Mocks (must be declared BEFORE the lazy import below) ─────────────
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
  getSessionFilePathByJob: () => '/tmp/jcm-test-session.json',
}));

vi.mock('../../src/periphery/adapters/http/routes/helpers/sessionCleanup', () => ({
  appendJobSnapshotToSession: vi.fn(async () => {}),
  sealJobRedisState: vi.fn(async () => {}),
}));

vi.mock('../../src/infrastructure/state', () => ({
  getRealtimeBroadcastChannel: () => ({
    publish: vi.fn(async () => {}),
  }),
}));

// Lazy imports — must come AFTER the vi.mock calls above so module
// initialisation sees the stubbed factory/utility surfaces.
const jcmMod = await import(
  '../../src/periphery/adapters/http/express/managers/JobCleanupManager'
);
const { JobCleanupManager } = jcmMod;
const trackerMod = await import(
  '../../src/periphery/adapters/http/express/managers/JobStateTracker'
);
const { JobStateTracker } = trackerMod;

// ─── Helpers ───────────────────────────────────────────────────────────
function makeTask(id: string, name = id, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: `${name} description`,
    type: 'error',
    priority: 900,
    selfVerifyOnDone: true,
    ...extra,
  } as any;
}

function makeDeps() {
  return {
    workspaceResolver: {
      getFeaturePath: () => '/tmp/jcm-test-feature',
    },
    workflowStateService: {
      endJob: vi.fn(async () => {}),
    },
    sessionService: {
      readSessionData: vi.fn(async () => sessionState),
    },
    kanbanService: {
      getFinalSnapshotKanbanData: vi.fn(async () => ({ todo: [], inProgress: [], completed: [] })),
    },
    chatService: {
      clearAllTurnBuffers: vi.fn(async () => {}),
      appendChoicePresentedCancelled: vi.fn(async () => ({ ok: true })),
    },
    // Minimal stubs for fields touched indirectly.
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
  // Seed the tracker with a minimal `jobToProject` mapping so the
  // broadcastFinalUpdate path has the data it needs (it's still mocked-out
  // through the kanbanService stub but we keep the shape consistent).
  tracker.getState().jobToProject.set(jobId, {
    projectId: 'proj-test',
    featureName: 'feat-test',
    jobType: 'code',
  } as any);
  return tracker;
}

const INTERRUPTION = {
  reason: 'user_stopped' as const,
  message: 'Task stopped by user',
  timestamp: '2026-05-14T00:00:00Z',
  canResume: true,
  metadata: { stoppedBy: 'user_action' },
} as any;

// ─── Tests ─────────────────────────────────────────────────────────────
describe('JobCleanupManager — parallel-mode terminal write clears runningTasks (ultra-fusing-scone regression)', () => {
  beforeEach(() => {
    capturedSessionData = null;
    stateStoreStub = {
      getJobMapping: vi.fn(async () => ({
        projectId: 'proj-test',
        featureName: 'feat-test',
        jobType: 'code',
      })),
      getTaskQueueCheckpoint: vi.fn(async () => null),
      getTaskQueue: vi.fn(async () => null),
      // Belt-and-suspenders for `broadcastFinalUpdate` — it runs AFTER the
      // atomicWriteFile we care about, but throws here would clutter the
      // test output. Stubbed as a no-op publisher.
      publish: vi.fn(async () => undefined),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redisHasFullHistory branch: in-flight task projected to taskQueue with interrupted:true AND runningTasks cleared', async () => {
    // Periodic-checkpoint snapshot persisted before stop — task without
    // interrupted flag. This is the racing-loser case where JCM's terminal
    // write must STILL produce a correct final snapshot.
    const racingTask = makeTask('sv-tier2', 'apply task');
    sessionState = {
      state: {
        jobId: 'job-test',
        parallelMode: true,
        taskQueue: [],
        runningTasks: [racingTask],
        completedTasks: [],
        completedTasksDetails: [],
      },
    };

    // Redis checkpoint that DID see the interruption — has currentTasks
    // with the same task. Completed list >= session's, so we hit
    // `redisHasFullHistory === true`.
    stateStoreStub.getTaskQueueCheckpoint.mockResolvedValue({
      currentTasks: [racingTask],
      queue: [],
      completedTasks: [],
      currentTask: null,
      recursionCount: 0,
      recursionLimit: 200,
    } as any);

    const tracker = makeTracker('job-test');
    const jcm = new JobCleanupManager(tracker, makeDeps());
    await jcm.cleanupJobState('job-test', 'proj-test', 'feat-test', INTERRUPTION, 'code');

    expect(capturedSessionData).not.toBeNull();
    const state = capturedSessionData.state;
    // Invariant: runningTasks emptied post-terminal-write.
    expect(state.runningTasks).toEqual([]);
    // In-flight task projected onto taskQueue head with interrupted:true.
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].id).toBe('sv-tier2');
    expect(state.taskQueue[0].interrupted).toBe(true);
    // currentTask cleared (parallel mode has no single-task field).
    expect(state.currentTask).toBeUndefined();
  });

  it('redis-stale-completed branch: same projection invariant when Redis has fewer completed than session', async () => {
    const racingTask = makeTask('sv-tier2', 'apply task');
    const queuedTask = makeTask('q1', 'queued follow-up');
    const completedDetail = { id: 'done1', name: 'done', type: 'feature' };
    sessionState = {
      state: {
        jobId: 'job-test',
        parallelMode: true,
        taskQueue: [],
        runningTasks: [racingTask],
        // Session has 1 completed; Redis returns 0 → redisHasFullHistory:false.
        completedTasks: ['done1'],
        completedTasksDetails: [completedDetail],
      },
    };
    stateStoreStub.getTaskQueueCheckpoint.mockResolvedValue({
      currentTasks: [racingTask],
      queue: [queuedTask],
      completedTasks: [],
      currentTask: null,
      recursionCount: 0,
      recursionLimit: 200,
    } as any);

    const tracker = makeTracker('job-test');
    const jcm = new JobCleanupManager(tracker, makeDeps());
    await jcm.cleanupJobState('job-test', 'proj-test', 'feat-test', INTERRUPTION, 'code');

    expect(capturedSessionData).not.toBeNull();
    const state = capturedSessionData.state;
    expect(state.runningTasks).toEqual([]);
    // Projected running goes to head, then Redis queue follows.
    expect(state.taskQueue.map((t: any) => t.id)).toEqual(['sv-tier2', 'q1']);
    expect(state.taskQueue[0].interrupted).toBe(true);
    // Session's completed list preserved (no data loss when Redis is stale).
    expect(state.completedTasksDetails).toEqual([completedDetail]);
    expect(state.currentTask).toBeUndefined();
  });

  it('no-Redis-source branch: session.runningTasks projected into taskQueue head with interrupted:true AND runningTasks cleared', async () => {
    const racingTask = makeTask('sv-tier2', 'apply task');
    const queuedTask = makeTask('q1', 'queued follow-up');
    sessionState = {
      state: {
        jobId: 'job-test',
        parallelMode: true,
        taskQueue: [queuedTask],
        runningTasks: [racingTask],
        completedTasks: [],
        completedTasksDetails: [],
      },
    };
    // Redis fully drained — no checkpoint AND no live snapshot.
    stateStoreStub.getTaskQueueCheckpoint.mockResolvedValue(null);
    stateStoreStub.getTaskQueue.mockResolvedValue(null);

    const tracker = makeTracker('job-test');
    const jcm = new JobCleanupManager(tracker, makeDeps());
    await jcm.cleanupJobState('job-test', 'proj-test', 'feat-test', INTERRUPTION, 'code');

    expect(capturedSessionData).not.toBeNull();
    const state = capturedSessionData.state;
    expect(state.runningTasks).toEqual([]);
    // Projected running head + existing queue tail.
    expect(state.taskQueue.map((t: any) => t.id)).toEqual(['sv-tier2', 'q1']);
    expect(state.taskQueue[0].interrupted).toBe(true);
    // Existing queue task untouched.
    expect(state.taskQueue[1].interrupted).toBeUndefined();
    expect(state.currentTask).toBeUndefined();
  });

  it('no-Redis-source branch: defensive de-dup — if a runningTask id already exists in taskQueue (worker post-stop write that beat us), keep the queue copy', async () => {
    // Worker's onCheckpoint placed the interrupted task into taskQueue
    // before JCM's terminal write ran. JCM must not duplicate it.
    const interruptedInQueue = makeTask('sv-tier2', 'apply task', {
      interrupted: true,
      resumeState: { snapshotPayload: 'present' },
    });
    const racingTaskInRunning = makeTask('sv-tier2', 'apply task');
    sessionState = {
      state: {
        jobId: 'job-test',
        parallelMode: true,
        taskQueue: [interruptedInQueue],
        runningTasks: [racingTaskInRunning],
        completedTasks: [],
        completedTasksDetails: [],
      },
    };
    stateStoreStub.getTaskQueueCheckpoint.mockResolvedValue(null);
    stateStoreStub.getTaskQueue.mockResolvedValue(null);

    const tracker = makeTracker('job-test');
    const jcm = new JobCleanupManager(tracker, makeDeps());
    await jcm.cleanupJobState('job-test', 'proj-test', 'feat-test', INTERRUPTION, 'code');

    const state = capturedSessionData.state;
    expect(state.runningTasks).toEqual([]);
    // De-dup: queue keeps the worker-written copy (which carries resumeState).
    expect(state.taskQueue).toHaveLength(1);
    expect(state.taskQueue[0].id).toBe('sv-tier2');
    expect(state.taskQueue[0].resumeState).toEqual({ snapshotPayload: 'present' });
  });
});
