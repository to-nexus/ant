/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Covers verification scenario matrix entries:
 *   - C14: verification fresh entry initialises `state.verification`
 *          (VerificationSession) via the plan hook.
 *   - C15: retry entry clears per-cycle `attemptedThisCycle` while
 *          preserving already-passed gates and the required set.
 *
 * The dispatcher is a pure state transformer for these branches; this suite
 * exercises it directly without the full LangGraph harness.
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../src/agents/architect/graph/code/nodes/plan';
import { VerificationSession } from '../src/agents/architect/graph/code/tasks/verification/model/Session';

const { resolvePlanEntry } = __testing__;

function makeFreshVerificationState() {
  const taskQueue = {
    pop: vi.fn(() => ({
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification' as const,
      priority: 1000,
    })),
    getAll: vi.fn(() => []),
    size: vi.fn(() => 0),
    push: vi.fn(),
  };

  return {
    taskQueue,
    currentTask: undefined,
    retries: 0,
    maxRetries: 3,
    conversations: {},
    completedTasksDetails: [],
    _httpJobId: undefined,
    deps: {} as any,
    context: { featurePath: undefined, featureFolder: undefined } as any,
    recursionCount: 0,
    recursionLimit: 200,
  } as any;
}

describe('resolvePlanEntry — fresh verification task (C14)', () => {
  it('initialises the verification session via the plan hook', async () => {
    const state = makeFreshVerificationState();
    const ctx = await resolvePlanEntry(state);

    expect(ctx.nextTask.name).toBe('verify');
    expect(ctx.isRetry).toBe(false);
    expect(ctx.skipKeywordAndRAG).toBe(false);

    expect(state.verification).toBeInstanceOf(VerificationSession);
    // Env probe in the test harness has no feature path → hasTests=false
    // and techTier is absent → isTs=false. Required therefore reduces to
    // the always-on `build` gate.
    expect(state.verification.required()).toEqual(['build']);
    expect(state.verification.passed()).toEqual([]);
    expect(state.verification.attempts()).toBe(0);
  });

  it('resets _planSearchWebCount to 0', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    await resolvePlanEntry(state);
    expect(state._planSearchWebCount).toBe(0);
  });
});

describe('resolvePlanEntry — verification retry (C15)', () => {
  it('clears attemptedThisCycle while preserving passed + required gates', async () => {
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification',
      priority: 1000,
    };
    state._nextPlanEntry = 'retry';
    // Seed a rehydrated session with two gates already passed and the full
    // attempted set populated — the retry branch must clear the attempted
    // set while preserving passed + required.
    state.verification = VerificationSession.rehydrate({
      required: ['typecheck', 'build', 'test'],
      passed: ['typecheck', 'build'],
      attemptedThisCycle: ['typecheck', 'build', 'test'],
      attempts: 0,
      planHistoryHashes: [],
    });
    state.retries = 1;
    state.violations = [{ type: 'type_error' as any, severity: 'critical', message: 'x' }];
    state.planText = '{"task":{"id":"t1"},"diagnostics":{"totalErrors":1}}';

    const ctx = await resolvePlanEntry(state);

    expect(ctx.isRetry).toBe(true);
    expect(ctx.retrySummaryText).toBeTruthy();

    const snap = state.verification.snapshot();
    // onPlanEntry('retry') clears attemptedThisCycle
    expect(snap.attemptedThisCycle).toEqual([]);
    // passed / required preserved
    expect(snap.passed.sort()).toEqual(['build', 'typecheck'].sort());
    expect(snap.required.sort()).toEqual(['build', 'test', 'typecheck'].sort());
    // attempts bumped
    expect(snap.attempts).toBe(1);

    expect(state.violations).toEqual([]);
  });
});
