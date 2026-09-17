/**
 * Regression guard: `activeJobs` must never outlive a job's terminal
 * transition within a session.
 *
 * The deploy CTA (and now the preview Start CTA) gate on
 * `selectHasActiveCodeJob` = `Boolean(activeJobs.code)`. Before this fix,
 * `activeJobs.code` was only cleared by the terminal *kanban* broadcast — which
 * `JobCleanupManager.broadcastFinalUpdate` can legitimately skip (shared
 * session slot) — while `isRunning` was cleared locally by `setRunning(false)`.
 * The two SOTs diverged and deploy stayed blocked ("A code job is running…")
 * until a page reload rebuilt the snapshot.
 *
 * The fix converges `activeJobs` pruning onto the SAME transition that clears
 * `isRunning`: the local `setRunning(false)` path prunes the terminating job,
 * plus `clearActiveJobByJobId` for defense-in-depth. Both prune BY jobId so
 * concurrent jobs of other types survive (N-concurrent semantics).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    connectWorkflow: () => {},
    disconnectWorkflow: () => {},
    updateJobParam: () => {},
  },
}));

vi.mock('../../src/domain/store/storage', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, saveToStorage: () => {}, removeFromStorage: () => {} };
});

import { createJobSlice, selectActiveJobByType, selectHasActiveCodeJob, type JobSlice } from '../../src/domain/store/slices/jobSlice';

function makeStore() {
  return create<any>()((set, get, store) => ({
    // Minimal ambient state the jobSlice reads on setRunning(false).
    selectedProject: 'proj',
    selectedFeature: 'main',
    runningJobsByFeature: {},
    kanban: undefined,
    ...createJobSlice(set, get, store as any),
  })) as ReturnType<typeof create<JobSlice>>;
}

describe('selectHasActiveCodeJob', () => {
  it('is true only when a code job is active', () => {
    expect(selectHasActiveCodeJob({ activeJobs: { j1: { jobType: 'code', jobId: 'j1', status: 'running' } } })).toBe(true);
    expect(selectHasActiveCodeJob({ activeJobs: { j2: { jobType: 'plan', jobId: 'j2', status: 'running' } } })).toBe(false);
    expect(selectHasActiveCodeJob({ activeJobs: {} })).toBe(false);
    expect(selectHasActiveCodeJob({})).toBe(false);
  });
});

/**
 * The map is keyed by JOB ID: N universal jobs of one project (N pipeline
 * runs) coexist instead of collapsing onto one `activeJobs.universal` slot.
 * Per-type surfaces read through ONE selector.
 */
describe('activeJobs is keyed by jobId', () => {
  let s: ReturnType<typeof makeStore>;
  beforeEach(() => { s = makeStore(); });

  it('two live universal jobs coexist, each with its own run attribution', () => {
    s.getState().setActiveJob('universal', { jobId: 'j1', status: 'running', pipelineRunId: 'run-a' });
    s.getState().setActiveJob('universal', { jobId: 'j2', status: 'running', pipelineRunId: 'run-b' });
    const map = s.getState().activeJobs;
    expect(Object.keys(map).sort()).toEqual(['j1', 'j2']);
    expect(map.j1).toMatchObject({ jobType: 'universal', pipelineRunId: 'run-a' });
    expect(map.j2).toMatchObject({ jobType: 'universal', pipelineRunId: 'run-b' });
    expect(map.ghost).toBeUndefined();
  });

  it('a kanban frame keeps bootstrap attribution (pipelineRunId/customJobRef survive a setActiveJob with only jobId+status)', () => {
    s.setState({
      activeJobs: { j1: { jobType: 'universal', jobId: 'j1', status: 'queued', agent: 'ops', pipelineRunId: 'run-a', customJobRef: 'ops-team/triage' } },
    });
    s.getState().setActiveJob('universal', { jobId: 'j1', status: 'running' });
    expect(s.getState().activeJobs.j1).toEqual({
      jobType: 'universal', jobId: 'j1', status: 'running', agent: 'ops', pipelineRunId: 'run-a', customJobRef: 'ops-team/triage',
    });
  });

  it('selectActiveJobByType ranks running > paused > queued and ignores other types', () => {
    const state = {
      activeJobs: {
        q: { jobType: 'universal', jobId: 'q', status: 'queued' },
        p: { jobType: 'universal', jobId: 'p', status: 'paused' },
        r: { jobType: 'universal', jobId: 'r', status: 'running' },
        c: { jobType: 'code', jobId: 'c', status: 'running' },
      },
    };
    expect(selectActiveJobByType(state, 'universal')?.jobId).toBe('r');
    expect(selectActiveJobByType(state, 'code')?.jobId).toBe('c');
    expect(selectActiveJobByType(state, 'plan')).toBeUndefined();
    expect(selectActiveJobByType({}, 'code')).toBeUndefined();
  });

  it('clearActiveJob(type) removes every entry of that type and nothing else', () => {
    s.setState({
      activeJobs: {
        j1: { jobType: 'universal', jobId: 'j1', status: 'running' },
        j2: { jobType: 'universal', jobId: 'j2', status: 'running' },
        j3: { jobType: 'code', jobId: 'j3', status: 'running' },
      },
    });
    s.getState().clearActiveJob('universal');
    expect(Object.keys(s.getState().activeJobs)).toEqual(['j3']);
  });
});

describe('activeJobs terminal owner', () => {
  let s: ReturnType<typeof makeStore>;
  beforeEach(() => { s = makeStore(); });

  it('setRunning(false) prunes the terminating (current) job but keeps concurrent jobs', () => {
    s.setState({
      currentJobId: 'j1',
      isRunning: true,
      activeJobs: {
        j1: { jobType: 'code', jobId: 'j1', status: 'running' },
        j2: { jobType: 'plan', jobId: 'j2', status: 'running' },
      },
    });

    s.getState().setRunning(false);

    expect(s.getState().isRunning).toBe(false);
    expect(s.getState().activeJobs.j1).toBeUndefined(); // deploy/preview unblock
    expect(s.getState().activeJobs.j2).toBeDefined();    // concurrent plan survives
    expect(selectHasActiveCodeJob(s.getState())).toBe(false);
  });

  it('setRunning(false) is a no-op on activeJobs when no entry owns the current jobId', () => {
    s.setState({
      currentJobId: 'jX',
      isRunning: true,
      activeJobs: { j1: { jobType: 'code', jobId: 'j1', status: 'running' } },
    });
    s.getState().setRunning(false);
    expect(s.getState().activeJobs.j1).toBeDefined();
  });

  it('clearActiveJobByJobId removes only the matching entry, any type', () => {
    s.setState({
      activeJobs: {
        j1: { jobType: 'code', jobId: 'j1', status: 'running' },
        j2: { jobType: 'plan', jobId: 'j2', status: 'running' },
      },
    });

    s.getState().clearActiveJobByJobId('j2');
    expect(s.getState().activeJobs.j2).toBeUndefined();
    expect(s.getState().activeJobs.j1).toBeDefined();

    s.getState().clearActiveJobByJobId(''); // guard: empty is a no-op
    expect(s.getState().activeJobs.j1).toBeDefined();

    s.getState().clearActiveJobByJobId('nope'); // no match is a no-op
    expect(s.getState().activeJobs.j1).toBeDefined();
  });
});

/**
 * Same axis, other direction: state that outlives the SESSION RECORD it was
 * rendered from. Deleting the record behind the viewed job (per-job trash, or
 * the feature-wide Hard Reset) must blank the work tab in the same tick —
 * before this owner existed, the Hard Reset relied on the BE's kanban reset
 * broadcast, which carries a board only for the job types KanbanService
 * serves, so a workspace project's checklist stayed on screen until a reload.
 */
describe('clearJobTabView', () => {
  let s: ReturnType<typeof makeStore>;
  beforeEach(() => { s = makeStore(); });

  it('blanks the board, the job identity, and the run-state chrome', () => {
    s.setState({
      currentJobId: 'j1',
      isRunning: true,
      jobStartPending: true,
      isQueued: true,
      queuePosition: { position: 2, total: 3 },
      kanban: {
        jobId: 'j1',
        todo: [{ id: 't1' }],
        inProgress: [],
        completed: [],
        isEstimating: false,
        dataSource: 'live',
        checklist: { items: [{ id: 'c1', state: 'done' }] },
        tokenUsage: { totalTokens: 42 },
      },
    });

    s.getState().clearJobTabView();

    const st = s.getState();
    expect(st.currentJobId).toBeUndefined();
    expect(st.kanban.jobId).toBeUndefined();
    expect(st.kanban.todo).toEqual([]);
    expect(st.kanban.dataSource).toBe('session');
    // Per-job fields ride the replaced object — never re-listed field by field.
    expect((st.kanban as any).checklist).toBeUndefined();
    expect((st.kanban as any).tokenUsage).toBeUndefined();
    expect(st.isRunning).toBe(false);
    expect(st.jobStartPending).toBe(false);
    expect(st.isQueued).toBe(false);
    expect(st.queuePosition).toBeNull();
  });

  it('prunes the cleared job from activeJobs and leaves concurrent jobs alone', () => {
    s.setState({
      currentJobId: 'j1',
      activeJobs: {
        j1: { jobType: 'code', jobId: 'j1', status: 'completed' },
        j2: { jobType: 'plan', jobId: 'j2', status: 'running' },
      },
    });

    s.getState().clearJobTabView();

    expect(s.getState().activeJobs.j1).toBeUndefined();
    expect(s.getState().activeJobs.j2).toBeDefined();
  });

  it('is a no-op-safe when no job is being viewed', () => {
    s.setState({ currentJobId: undefined, activeJobs: { j2: { jobType: 'plan', jobId: 'j2', status: 'running' } } });
    s.getState().clearJobTabView();
    expect(s.getState().currentJobId).toBeUndefined();
    expect(s.getState().activeJobs.j2).toBeDefined();
  });
});
