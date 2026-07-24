/**
 * useChatPolicy interruption gate (silly-peach RCA).
 *
 * The chat's "액션" CTA (ActionsCTA) is gated on `chatPolicy.reason === 'ready'`,
 * which is driven by `hasInterruption`. Dismissing a cancelled card sets the
 * authoritative BE flag `interruption.dismissed = true` (often with a FRESH
 * timestamp on the paused branch), so the old timestamp-only comparison flipped
 * `hasInterruption` back to true after dismiss and the CTA vanished. The gate
 * must read `interruption.dismissed` so a dismissed interruption resolves to
 * `reason: 'ready'`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = {};
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});

vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useChatPolicy } from '../../src/application/hooks/ui/useChatPolicy';

beforeEach(() => {
  // Authenticated + fully selected so the policy falls through to the
  // interruption / ready branches (local mode ⇒ selectIsAuthenticated true).
  Object.assign(storeState, {
    serverMode: { status: 'ready', data: 'local' },
    userEmail: null,
    selectedAgent: 'architect',
    selectedProject: 'proj',
    selectedFeature: 'base',
    selectedJobType: 'code',
    isRunning: false,
    isQueued: false,
    queuePosition: null,
    kanban: null,
    dismissedInterruptTimestamp: null,
  });
});

describe('useChatPolicy — interruption gate', () => {
  it("reports 'ready' when the interruption was dismissed with a fresh (non-matching) timestamp", () => {
    // Reproduces the bug: BE paused-dismiss mints a NEW timestamp the FE marker
    // (still null) can never match — the dismissed flag must win.
    storeState.kanban = {
      jobId: 'job-1',
      interruption: { canResume: true, dismissed: true, timestamp: 't-new', reason: 'user_stopped' },
    };
    storeState.dismissedInterruptTimestamp = null;

    expect(useChatPolicy().reason).toBe('ready');
  });

  it("reports 'job-interrupted' for a live, undismissed resumable interruption", () => {
    storeState.kanban = {
      jobId: 'job-1',
      interruption: { canResume: true, dismissed: false, timestamp: 't1', reason: 'user_stopped' },
    };
    storeState.dismissedInterruptTimestamp = null;

    expect(useChatPolicy().reason).toBe('job-interrupted');
  });

  it("reports 'ready' when there is no interruption at all", () => {
    storeState.kanban = { jobId: 'job-1' };
    expect(useChatPolicy().reason).toBe('ready');
  });

  it("still hides via the optimistic timestamp clause during an in-flight resume (dismissed not yet set)", () => {
    // Resume optimistically sets dismissedInterruptTimestamp === interruption.timestamp
    // while dismissed is still false — the timestamp clause keeps 'ready'.
    storeState.kanban = {
      jobId: 'job-1',
      interruption: { canResume: true, dismissed: false, timestamp: 't1', reason: 'user_stopped' },
    };
    storeState.dismissedInterruptTimestamp = 't1';

    expect(useChatPolicy().reason).toBe('ready');
  });

  it("reports 'job-running' while a job is running regardless of interruption", () => {
    storeState.isRunning = true;
    storeState.kanban = {
      jobId: 'job-1',
      interruption: { canResume: true, dismissed: false, timestamp: 't1', reason: 'user_stopped' },
    };
    expect(useChatPolicy().reason).toBe('job-running');
  });
});
