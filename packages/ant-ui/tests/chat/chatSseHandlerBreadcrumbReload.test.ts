/**
 * Regression: SSE `job_status` handler must always refresh feature
 * breadcrumbs on completion when the event matches the selected
 * project/feature. The stale-job and `jobStartPending` guards may only
 * skip the run-state transition (`setRunning(false)`); they MUST NOT
 * skip the timeline reload.
 *
 * Failure mode this test pins:
 *   - User submits design job J1 → BE finalizes after some delay.
 *   - User starts another action that mutates `currentJobId` to J2 (or
 *     sets `jobStartPending=true`) before J1's `job_status=completed`
 *     SSE arrives.
 *   - Old behavior: J1 completion is "stale" → the handler `break`s
 *     before `loadFeatureBreadcrumbs`, leaving the Timeline tab empty
 *     until the user manually refreshes.
 *   - Fixed behavior: refreshFileTree + loadFeatureBreadcrumbs always
 *     fire for the selected feature; only setRunning(false) is gated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatSseHandler } from '../../src/domain/store/slices/sse/chatSseHandler';

interface HarnessState {
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  currentJobId: string | undefined;
  isRunning: boolean;
  jobStartPending: boolean;
  loadFeatureBreadcrumbs: ReturnType<typeof vi.fn>;
  refreshFileTree: ReturnType<typeof vi.fn>;
  setRunning: ReturnType<typeof vi.fn>;
  // Other store fields the handler may touch on non-relevant paths.
  setDismissedInterruptTimestamp: ReturnType<typeof vi.fn>;
  inlineAskContext: undefined;
  kanban: undefined;
  clearChatEvents: ReturnType<typeof vi.fn>;
  clearFeatureLog: ReturnType<typeof vi.fn>;
  appendChatEvent: ReturnType<typeof vi.fn>;
  replaceChatEvents: ReturnType<typeof vi.fn>;
  replaceStreamingBuffer: ReturnType<typeof vi.fn>;
  lastChatSnapshotTs: undefined;
}

function createHarness(overrides: Partial<HarnessState> = {}) {
  let state: HarnessState = {
    selectedProject: 'proj',
    selectedFeature: 'base',
    currentJobId: undefined,
    isRunning: false,
    jobStartPending: false,
    loadFeatureBreadcrumbs: vi.fn(),
    refreshFileTree: vi.fn(),
    setRunning: vi.fn(),
    setDismissedInterruptTimestamp: vi.fn(),
    inlineAskContext: undefined,
    kanban: undefined,
    clearChatEvents: vi.fn(),
    clearFeatureLog: vi.fn(),
    appendChatEvent: vi.fn(),
    replaceChatEvents: vi.fn(),
    replaceStreamingBuffer: vi.fn(),
    lastChatSnapshotTs: undefined,
    ...overrides,
  };
  const get = () => state;
  const set = (
    update: Partial<HarnessState> | ((s: HarnessState) => Partial<HarnessState>),
  ) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  return { get, set, state: () => state };
}

function completedEvent(jobId: string) {
  return {
    type: 'job_status',
    status: 'completed',
    jobId,
    projectId: 'proj',
    featureName: 'base',
  };
}

describe('chatSseHandler — job_status breadcrumb reload guard split', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('always reloads breadcrumbs on completion for the selected feature', () => {
    const h = createHarness({ currentJobId: undefined });
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler(completedEvent('job-A'));

    const s = h.state();
    expect(s.loadFeatureBreadcrumbs).toHaveBeenCalledWith('proj', 'base');
    expect(s.refreshFileTree).toHaveBeenCalledTimes(1);
    expect(s.setRunning).toHaveBeenCalledWith(false);
  });

  it('reloads breadcrumbs even when the completed jobId is stale (currentJobId differs)', () => {
    const h = createHarness({ currentJobId: 'job-B' });
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler(completedEvent('job-A'));

    const s = h.state();
    expect(s.loadFeatureBreadcrumbs).toHaveBeenCalledWith('proj', 'base');
    expect(s.refreshFileTree).toHaveBeenCalledTimes(1);
    // setRunning must NOT be flipped by a stale completion.
    expect(s.setRunning).not.toHaveBeenCalled();
  });

  it('reloads breadcrumbs even when jobStartPending && isRunning', () => {
    const h = createHarness({ jobStartPending: true, isRunning: true });
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler(completedEvent('job-A'));

    const s = h.state();
    expect(s.loadFeatureBreadcrumbs).toHaveBeenCalledWith('proj', 'base');
    expect(s.refreshFileTree).toHaveBeenCalledTimes(1);
    // setRunning must NOT be flipped while a new job start is pending.
    expect(s.setRunning).not.toHaveBeenCalled();
  });

  it('does not reload breadcrumbs when project/feature does not match selection', () => {
    const h = createHarness({ selectedProject: 'other-proj' });
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler(completedEvent('job-A'));

    const s = h.state();
    expect(s.loadFeatureBreadcrumbs).not.toHaveBeenCalled();
    expect(s.refreshFileTree).not.toHaveBeenCalled();
    expect(s.setRunning).not.toHaveBeenCalled();
  });
});
