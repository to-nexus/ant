/**
 * L1 — Snapshot capture/restore round-trip.
 *
 * Core invariant of Phase A: `snapshotFromState(state)` produces a
 * `WorkerSnapshot` that `TaskWorker.executeTask` restore block can consume
 * without losing verification carry-over state. The `still-lacing-north`
 * incident was caused by this round-trip being broken — the producer
 * (`captureState`) was never actually called, so the consumer's restore
 * block read only `undefined` fields and silently reset every counter.
 *
 * This suite exercises the producer directly; the consumer is covered by
 * the L2 scenario harness (`S10-orchestrator-requeue-carry-over`).
 */

import { describe, it, expect } from 'vitest';
import { snapshotFromState } from '../../../src/agents/architect/graph/code/parallel/TaskWorker';

describe('snapshotFromState — produces a complete WorkerSnapshot', () => {
  it('copies every verification-related field from state', () => {
    const state = {
      planText: '{"task":{"id":"x"}}',
      conversations: { 'node:plan': [] },
      projectCodeContext: {
        source: 'plan',
        filePaths: ['a.ts'],
        stats: { filesLoaded: 1 },
      },
      retries: 2,
      violations: [{ type: 'syntax_error' }],
      enforcementHistory: [{ reason: 'retry' }],
      _currentTaskTokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 },
      _depFileHash: 'abc123',
      _verificationAttempts: 3,
      _verificationTracker: {
        buildPassed: true,
        testPassed: false,
        typecheckPassed: true,
        buildAttempted: true,
        testAttempted: false,
        typecheckAttempted: true,
        testsRequired: true,
        typecheckRequired: true,
      },
      _appliedPlanHistory: ['{"plan":1}', '{"plan":2}'],
    };

    const snap = snapshotFromState(state);
    expect(snap).not.toBeNull();
    expect(snap!.planText).toBe(state.planText);
    expect(snap!.retries).toBe(2);
    expect(snap!.violations).toEqual(state.violations);
    expect(snap!.tokenUsage).toEqual(state._currentTaskTokenUsage);
    expect(snap!._depFileHash).toBe('abc123');
    expect(snap!._verificationAttempts).toBe(3);
    expect(snap!._verificationTracker).toEqual(state._verificationTracker);
    expect(snap!._appliedPlanHistory).toEqual(state._appliedPlanHistory);
  });

  it('returns null when state itself is null/undefined', () => {
    expect(snapshotFromState(null as any)).toBeNull();
    expect(snapshotFromState(undefined as any)).toBeNull();
  });

  it('omits projectCodeContext when state.projectCodeContext is undefined', () => {
    const snap = snapshotFromState({ planText: 'x', retries: 0 });
    expect(snap).not.toBeNull();
    expect(snap!.projectCodeContext).toBeUndefined();
  });

  it('is round-trip-safe: a snapshot assigned to task.resumeState can be read by TaskWorker restore block', () => {
    // The shape of snapshot must satisfy the restore block's reads. We
    // simulate the restore read pattern here.
    const state = {
      planText: 'plan-body',
      conversations: { a: [] },
      retries: 1,
      violations: [],
      enforcementHistory: [],
      _depFileHash: 'deadbeef',
      _verificationAttempts: 2,
      _verificationTracker: { buildPassed: false },
      _appliedPlanHistory: ['p1'],
    };
    const snap = snapshotFromState(state);

    // Simulate the restore spread.
    const restored = {
      planText: snap!.planText || '',
      conversations: snap!.conversations || {},
      retries: snap!.retries || 0,
      violations: snap!.violations || [],
      enforcementHistory: snap!.enforcementHistory || [],
      _depFileHash: snap!._depFileHash,
      _verificationAttempts: snap!._verificationAttempts,
      _verificationTracker: snap!._verificationTracker,
      _appliedPlanHistory: snap!._appliedPlanHistory,
    };

    expect(restored.planText).toBe('plan-body');
    expect(restored.retries).toBe(1);
    expect(restored._verificationAttempts).toBe(2);
    expect(restored._appliedPlanHistory).toEqual(['p1']);
    expect(restored._verificationTracker).toEqual({ buildPassed: false });
  });
});
