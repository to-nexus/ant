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

import { createJobSlice, selectHasActiveCodeJob, type JobSlice } from '../../src/domain/store/slices/jobSlice';

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
    expect(selectHasActiveCodeJob({ activeJobs: { code: { jobId: 'j1', status: 'running' } } })).toBe(true);
    expect(selectHasActiveCodeJob({ activeJobs: { plan: { jobId: 'j2', status: 'running' } } })).toBe(false);
    expect(selectHasActiveCodeJob({ activeJobs: {} })).toBe(false);
    expect(selectHasActiveCodeJob({})).toBe(false);
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
        code: { jobId: 'j1', status: 'running' },
        plan: { jobId: 'j2', status: 'running' },
      },
    });

    s.getState().setRunning(false);

    expect(s.getState().isRunning).toBe(false);
    expect(s.getState().activeJobs.code).toBeUndefined(); // deploy/preview unblock
    expect(s.getState().activeJobs.plan).toBeDefined();    // concurrent plan survives
    expect(selectHasActiveCodeJob(s.getState())).toBe(false);
  });

  it('setRunning(false) is a no-op on activeJobs when no entry owns the current jobId', () => {
    s.setState({
      currentJobId: 'jX',
      isRunning: true,
      activeJobs: { code: { jobId: 'j1', status: 'running' } },
    });
    s.getState().setRunning(false);
    expect(s.getState().activeJobs.code).toBeDefined();
  });

  it('clearActiveJobByJobId removes only the matching entry, any type', () => {
    s.setState({
      activeJobs: {
        code: { jobId: 'j1', status: 'running' },
        plan: { jobId: 'j2', status: 'running' },
      },
    });

    s.getState().clearActiveJobByJobId('j2');
    expect(s.getState().activeJobs.plan).toBeUndefined();
    expect(s.getState().activeJobs.code).toBeDefined();

    s.getState().clearActiveJobByJobId(''); // guard: empty is a no-op
    expect(s.getState().activeJobs.code).toBeDefined();

    s.getState().clearActiveJobByJobId('nope'); // no match is a no-op
    expect(s.getState().activeJobs.code).toBeDefined();
  });
});
