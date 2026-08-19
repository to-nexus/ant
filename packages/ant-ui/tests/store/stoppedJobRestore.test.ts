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
 *  - F6: universal (a NON_TASK job type) must ALSO be restorable from history:
 *    a workspace project has no other job type, and the jobId chip is the only
 *    affordance that reaches run history — `restoresLatestRunFromHistory` owns
 *    that rule, and the restored run's `customJobRef` re-converges the custom
 *    (agent, job) pair. plan / visual stay excluded (Invariant I4).
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
const fetchKanbanByJobId = vi.fn();
vi.mock('@/infrastructure/http/api', () => ({
  fetchJobHistory: (...args: any[]) => fetchJobHistory(...args),
  fetchKanbanByJobId: (...args: any[]) => fetchKanbanByJobId(...args),
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

describe('F6 — universal is restorable from history; plan/visual are not', () => {
  const flush = () => new Promise((r) => setTimeout(r, 25));

  beforeEach(() => {
    fetchJobHistory.mockReset();
    fetchKanbanByJobId.mockReset();
  });

  it.each([
    ['universal', true],
    ['plan', false],
    ['visual', false],
  ])('bootstrap fallback for %s → restored=%s', async (jobType, restored) => {
    const selectJobId = vi.fn(async () => {});
    const s = makeStore({ selectJobId, selectedJobType: jobType });
    s.setState({ currentJobId: undefined, activeJobs: {}, jobStartPending: false });
    fetchJobHistory.mockResolvedValue({
      jobs: [{ jobId: `${jobType}-old`, type: jobType, live: false, customJobRef: 'ops/weekly' }],
    });

    handleInitialActiveJobs([], s.setState.bind(s), s.getState.bind(s));
    await flush();

    expect(selectJobId).toHaveBeenCalledTimes(restored ? 1 : 0);
    if (restored) {
      expect(selectJobId).toHaveBeenCalledWith(`${jobType}-old`, {
        live: false,
        jobType,
        customJobRef: 'ops/weekly',
      });
    }
  });

  it('selectJobId adopts the run\'s custom (agent, job) pair', async () => {
    const selectCustomJob = vi.fn();
    const s = makeStore({
      selectedJobType: 'universal',
      selectedFeature: 'universal',
      selectCustomJob,
      updateKanban: () => {},
      applyJobIdentity: () => {},
    });
    fetchKanbanByJobId.mockResolvedValue({
      jobId: 'u1', jobType: 'universal', todo: [], inProgress: [], completed: [],
      isEstimating: false, dataSource: 'session',
      checklist: { items: [{ id: 'c1', text: 'a', state: 'done' }] },
    });

    await s.getState().selectJobId('u1', { live: false, jobType: 'universal', customJobRef: 'ops/weekly' });

    expect(s.getState().currentJobId).toBe('u1');
    expect(selectCustomJob).toHaveBeenCalledWith('ops', 'weekly');
  });

  it('leaves the pair alone for a canonical row (no customJobRef)', async () => {
    const selectCustomJob = vi.fn();
    const s = makeStore({
      selectCustomJob,
      updateKanban: () => {},
      applyJobIdentity: () => {},
    });
    fetchKanbanByJobId.mockResolvedValue({
      jobId: 'd1', jobType: 'design', todo: [], inProgress: [], completed: [],
      isEstimating: false, dataSource: 'session',
    });

    await s.getState().selectJobId('d1', { live: false, jobType: 'design' });

    expect(selectCustomJob).not.toHaveBeenCalled();
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
