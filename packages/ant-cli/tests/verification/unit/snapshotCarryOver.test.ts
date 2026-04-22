/**
 * L1 — Snapshot capture/restore round-trip.
 *
 * Core invariant of Phase A: `snapshotFromState(state)` produces a
 * `WorkerSnapshot` that the orchestrator's restore path can consume
 * without losing verification carry-over state. The `still-lacing-north`
 * incident was caused by this round-trip being broken — the producer
 * (`captureState`) was never actually called, so the consumer's restore
 * block read only `undefined` fields and silently reset every counter.
 *
 * This suite exercises the producer directly; the consumer is covered by
 * the L2 scenario harness.
 */

import { describe, it, expect } from 'vitest';
import { snapshotFromState } from '../../../src/agents/architect/graph/code/parallel/TaskWorker';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';

describe('snapshotFromState — produces a complete WorkerSnapshot', () => {
  it('captures the VerificationSession snapshot alongside per-worker fields', () => {
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    session.onPlanEntry('retry');
    session.onPlanEntry('retry');
    session.onPlanEntry('retry');
    session.onCommand('typecheck', true);
    session.onCommand('build', true);
    session.markInstallNeeded(false);
    session.onPlanApplied('{"plan":1}');
    session.onPlanApplied('{"plan":2}');

    const state = {
      planText: '{"task":{"id":"x"}}',
      conversations: { 'node:plan': [] },
      retries: 2,
      violations: [{ type: 'syntax_error' }],
      enforcementHistory: [{ reason: 'retry' }],
      _currentTaskTokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheCreationTokens: 0 },
      verification: session,
    };

    const snap = snapshotFromState(state);
    expect(snap).not.toBeNull();
    expect(snap!.planText).toBe(state.planText);
    expect(snap!.retries).toBe(2);
    expect(snap!.violations).toEqual(state.violations);
    expect(snap!.tokenUsage).toEqual(state._currentTaskTokenUsage);

    // Every verification field that used to live on the flat state is now
    // carried on the `verification` snapshot owned by the Session.
    expect(snap!.verification).toBeDefined();
    expect(snap!.verification!.attempts).toBe(3);
    expect(snap!.verification!.installNeeded).toBe(false);
    expect(snap!.verification!.passed.sort()).toEqual(['build', 'typecheck'].sort());
    expect(snap!.verification!.planHistoryBodies).toEqual(['{"plan":1}', '{"plan":2}']);
  });

  it('returns null when state itself is null/undefined', () => {
    expect(snapshotFromState(null as any)).toBeNull();
    expect(snapshotFromState(undefined as any)).toBeNull();
  });

  it('round-trips via VerificationSession.rehydrate', () => {
    const session = VerificationSession.createFresh({ isTs: false, hasTests: false });
    session.onPlanEntry('reverify');
    session.onPlanEntry('reverify');
    session.onPlanApplied('p1');

    const snap = snapshotFromState({
      planText: 'plan-body',
      conversations: { a: [] },
      retries: 1,
      violations: [],
      enforcementHistory: [],
      verification: session,
    });

    // Simulate the orchestrator.restoreIntoWorkerState round-trip.
    const restored = VerificationSession.rehydrate(snap!.verification);
    expect(restored.attempts()).toBe(2);
    expect(restored.snapshot().planHistoryBodies).toEqual(['p1']);
  });
});
