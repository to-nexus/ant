/**
 * Universal checklist on the kanban plane — reducer preserve rule.
 *
 * The checklist rides `KanbanData.checklist` (same SSE event, same store
 * slot). The broadcaster includes it in every frame once cached, but frames
 * that predate the cache or REST-restored boards can omit it — the reducer
 * must preserve the last-seen list instead of blanking the Checklist board
 * (same rule as tokenUsage / jobTiming).
 */

import { describe, it, expect, vi } from 'vitest';

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

const CHECKLIST = {
  items: [
    { id: 'item-1', text: 'first', state: 'done' as const },
    { id: 'item-2', text: 'second', state: 'active' as const },
  ],
  sourcePlanPath: 'plan/ops/weekly/report.md',
};

function makeHarness(existingKanban: any) {
  const state: any = {
    currentJobId: 'uni-1',
    isRunning: true,
    selectedProject: 'proj',
    selectedFeature: 'universal',
    runningJobsByFeature: {},
    userStoppedJobId: undefined,
    jobStartPending: false,
    kanban: existingKanban,
  };
  let applied: any = {};
  const set = (patch: any) => { applied = { ...applied, ...patch }; };
  const get = () => ({ ...state, ...applied });
  return { set, get, applied: () => applied };
}

describe('kanbanReducer — checklist preserve rule', () => {
  it('a frame that omits checklist keeps the last-seen list', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const h = makeHarness({
      jobId: 'uni-1', jobType: 'universal',
      todo: [], inProgress: [], completed: [],
      checklist: CHECKLIST,
    });

    handleKanbanUpdate(
      { jobId: 'uni-1', todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'live' } as any,
      h.set as any,
      h.get as any,
    );
    expect(h.applied().kanban?.checklist).toEqual(CHECKLIST);
  });

  it('a frame that carries checklist replaces it wholesale (full-replace)', async () => {
    const { handleKanbanUpdate } = await import('../../src/domain/store/slices/sse/kanbanReducer');
    const h = makeHarness({
      jobId: 'uni-1', jobType: 'universal',
      todo: [], inProgress: [], completed: [],
      checklist: CHECKLIST,
    });
    const next = { items: [{ id: 'item-1', text: 'first', state: 'done' as const }] };

    handleKanbanUpdate(
      { jobId: 'uni-1', todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'live', checklist: next } as any,
      h.set as any,
      h.get as any,
    );
    expect(h.applied().kanban?.checklist).toEqual(next);
  });
});
