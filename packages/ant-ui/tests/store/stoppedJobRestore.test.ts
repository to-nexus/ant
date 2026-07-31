/**
 * Regression guards for the user-stopped-job restore path.
 *
 * A user stop seals the job out of Redis (activeJobs empties) while the
 * session file keeps the resumable kanban snapshot. The FE must therefore
 * never let "no live job" / "empty board" signals erase the selected jobId:
 *
 *  - F2: `syncViewToJobType` used to null `currentJobId` whenever no live job
 *    of the type existed (degenerate ternary) — the whole job-tab dropdown
 *    unmounts on `currentJobId === undefined`, so the chip vanished on stop.
 *    It now falls back to the last known same-type board's jobId.
 *  - F4: `handleKanbanUpdate`'s else-branch used to adopt `undefined` from an
 *    identity-less empty board (e.g. the transport-fallback board), wiping the
 *    selection. Empty + no jobId now preserves the current selection.
 *  - F3: `handleInitialActiveJobs([])` (post-refresh, sealed job) gains the
 *    history fallback that auto-selects the latest same-type run.
 *  - F5: the same identity guard on the job-COMPLETED branch. `isStaleJobUpdate`
 *    above it requires BOTH ids truthy, so it does not fire for an incoming
 *    `undefined` — the branch wrote `currentJobId` unconditionally. Both
 *    branches now share `frameCarriesJobIdentity`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create } from 'zustand';

vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    connectWorkflow: () => {},
    disconnectWorkflow: () => {},
    isWorkflowConnected: () => false,
    updateJobParam: () => {},
  },
}));

vi.mock('../../src/domain/store/storage', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, saveToStorage: () => {}, removeFromStorage: () => {} };
});

const fetchJobHistory = vi.fn();
vi.mock('@/infrastructure/http/api', () => ({
  fetchJobHistory: (...args: any[]) => fetchJobHistory(...args),
}));

import { createJobSlice, type JobSlice } from '../../src/domain/store/slices/jobSlice';
import { handleInitialActiveJobs } from '../../src/domain/store/slices/sse/activeJobsBootstrap';

function makeStore(extra: Record<string, any> = {}) {
  return create<any>()((set, get, store) => ({
    selectedProject: 'proj',
    selectedFeature: 'main',
    selectedJobType: 'design',
    runningJobsByFeature: {},
    kanban: undefined,
    pendingAutoSelect: false,
    ...createJobSlice(set, get, store as any),
    ...extra,
  })) as ReturnType<typeof create<JobSlice>>;
}

describe('F2 — syncViewToJobType keeps the last known same-type jobId', () => {
  let s: ReturnType<typeof makeStore>;
  beforeEach(() => { s = makeStore(); });

  it('falls back to the kanban board jobId when no live job exists', () => {
    s.setState({
      currentJobId: 'design-old',
      activeJobs: {},
      kanban: { jobId: 'design-old', jobType: 'design', todo: [], inProgress: [], completed: [] },
    });
    s.getState().syncViewToJobType('design' as any);
    expect(s.getState().currentJobId).toBe('design-old');
    expect(s.getState().isRunning).toBe(false);
  });

  it('does not leak a board belonging to another jobType', () => {
    s.setState({
      currentJobId: 'design-old',
      activeJobs: {},
      kanban: { jobId: 'design-old', jobType: 'design', todo: [], inProgress: [], completed: [] },
    });
    s.getState().syncViewToJobType('code' as any);
    expect(s.getState().currentJobId).toBeUndefined();
  });

  it('adopts the live job when one exists', () => {
    s.setState({
      currentJobId: undefined,
      activeJobs: { design: { jobId: 'design-live', status: 'running' } },
      kanban: { jobId: 'design-old', jobType: 'design', todo: [], inProgress: [], completed: [] },
    });
    s.getState().syncViewToJobType('design' as any);
    expect(s.getState().currentJobId).toBe('design-live');
    expect(s.getState().isRunning).toBe(true);
  });
});

describe('F4 — empty identity-less board must not erase currentJobId', () => {
  it('preserves the selection when an empty board with no jobId arrives', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const state: any = {
      currentJobId: 'design-old',
      isRunning: false,
      selectedProject: 'proj',
      selectedFeature: 'main',
      runningJobsByFeature: {},
      userStoppedJobId: undefined,
      jobStartPending: false,
    };
    let applied: any = {};
    const set = (patch: any) => { applied = { ...applied, ...patch }; };
    const get = () => ({ ...state, ...applied });

    handleKanbanUpdate(
      { todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' } as any,
      set as any,
      get as any,
    );
    expect('currentJobId' in applied ? applied.currentJobId : state.currentJobId).toBe('design-old');
  });

  it('adopts a defined jobId from an incoming board', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const state: any = {
      currentJobId: 'design-old',
      isRunning: false,
      selectedProject: 'proj',
      selectedFeature: 'main',
      runningJobsByFeature: {},
      userStoppedJobId: undefined,
      jobStartPending: false,
    };
    let applied: any = {};
    const set = (patch: any) => { applied = { ...applied, ...patch }; };
    const get = () => ({ ...state, ...applied });

    handleKanbanUpdate(
      { jobId: 'design-new', todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' } as any,
      set as any,
      get as any,
    );
    expect(applied.currentJobId).toBe('design-new');
  });
});

describe('F3 — bootstrap history fallback when activeJobs is empty', () => {
  // Real timers: the deferred fallback awaits a dynamic import(), which does
  // not settle under fake timers.
  const flush = () => new Promise((r) => setTimeout(r, 25));

  beforeEach(() => {
    fetchJobHistory.mockReset();
  });

  it('auto-selects the latest same-type run from history', async () => {
    const selectJobId = vi.fn(async () => {});
    const s = makeStore({ selectJobId });
    s.setState({ currentJobId: undefined, activeJobs: {}, jobStartPending: false });
    fetchJobHistory.mockResolvedValue({
      jobs: [
        { jobId: 'design-old', type: 'design', live: false },
        { jobId: 'code-old', type: 'code', live: false },
      ],
    });

    handleInitialActiveJobs([], s.setState.bind(s), s.getState.bind(s));
    await flush();

    expect(fetchJobHistory).toHaveBeenCalledWith('proj', 'main');
    expect(selectJobId).toHaveBeenCalledWith('design-old', { live: false, jobType: 'design' });
  });

  it('is a no-op when the selection is backed by a same-type board (initial board won)', async () => {
    const selectJobId = vi.fn(async () => {});
    const s = makeStore({ selectJobId });
    // The initial session board already restored the stopped job — F2's
    // fallback keeps currentJobId through syncViewToJobType, so the deferred
    // history fetch must skip.
    s.setState({
      currentJobId: 'design-old',
      activeJobs: {},
      kanban: { jobId: 'design-old', jobType: 'design', todo: [], inProgress: [], completed: [] } as any,
    });

    handleInitialActiveJobs([], s.setState.bind(s), s.getState.bind(s));
    await flush();

    expect(fetchJobHistory).not.toHaveBeenCalled();
    expect(selectJobId).not.toHaveBeenCalled();
  });

  it('is a no-op while a job start is pending', async () => {
    const selectJobId = vi.fn(async () => {});
    const s = makeStore({ selectJobId });
    s.setState({ currentJobId: undefined, activeJobs: {}, jobStartPending: true });

    handleInitialActiveJobs([], s.setState.bind(s), s.getState.bind(s));
    await flush();

    expect(selectJobId).not.toHaveBeenCalled();
  });
});

describe('F5 — completion branch shares the identity guard', () => {
  // The completion branch fires on `!isJobRunning && state.isRunning`, i.e. a
  // session frame arriving while the run is still marked active.
  function completingState(overrides: Record<string, any> = {}) {
    return {
      currentJobId: 'code-old',
      isRunning: true,
      selectedProject: 'proj',
      selectedFeature: 'main',
      runningJobsByFeature: { 'proj/main': 'code-old' },
      userStoppedJobId: undefined,
      jobStartPending: false,
      dismissedInterruptTimestamp: null,
      activeJobs: {},
      refreshFileTree: () => {},
      refreshBalance: () => {},
      refreshUsage: () => {},
      ...overrides,
    } as any;
  }

  it('preserves the selection when the completing frame carries no identity', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const state = completingState();
    let applied: any = {};
    const set = (patch: any) => { applied = { ...applied, ...patch }; };
    const get = () => ({ ...state, ...applied });

    handleKanbanUpdate(
      { todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' } as any,
      set as any,
      get as any,
    );

    expect('currentJobId' in applied).toBe(false);
    expect(applied.isRunning).toBe(false);
  });

  it('adopts the jobId of a real terminal board', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const state = completingState();
    let applied: any = {};
    const set = (patch: any) => { applied = { ...applied, ...patch }; };
    const get = () => ({ ...state, ...applied });

    handleKanbanUpdate(
      {
        jobId: 'code-old',
        todo: [],
        inProgress: [],
        completed: [{ id: 't1' }],
        isEstimating: false,
        dataSource: 'session',
      } as any,
      set as any,
      get as any,
    );

    expect(applied.currentJobId).toBe('code-old');
    expect(applied.isRunning).toBe(false);
    expect(applied.kanban.completed).toHaveLength(1);
  });

  it('adopts a task-carrying board even when the frame omits jobId', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const state = completingState();
    let applied: any = {};
    const set = (patch: any) => { applied = { ...applied, ...patch }; };
    const get = () => ({ ...state, ...applied });

    handleKanbanUpdate(
      { todo: [], inProgress: [], completed: [{ id: 't1' }], isEstimating: false, dataSource: 'session' } as any,
      set as any,
      get as any,
    );

    expect(applied.currentJobId).toBeUndefined();
    expect('currentJobId' in applied).toBe(true);
  });
});
