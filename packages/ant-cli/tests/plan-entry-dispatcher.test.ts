/**
 * L1 — `resolvePlanEntry` dispatcher invariants.
 *
 * Covers verification scenario matrix entries:
 *   - C14: verification fresh entry initializes `_verificationTracker`,
 *          `_verificationBudget`, `_appliedPlanHistory`.
 *   - C15: retry entry clears tracker `*Attempted` flags while
 *          preserving `*Passed` / `*Required`.
 *
 * The dispatcher is a pure state transformer for these branches; this suite
 * exercises it directly without the full LangGraph harness.
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../src/agents/architect/graph/code/nodes/plan';

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
  it('initializes verification tracker, budget, and plan history', async () => {
    const state = makeFreshVerificationState();
    const ctx = await resolvePlanEntry(state);

    expect(ctx.nextTask.name).toBe('verify');
    expect(ctx.isRetry).toBe(false);
    expect(ctx.skipKeywordAndRAG).toBe(false);

    expect(state._verificationTracker).toBeDefined();
    expect(state._verificationTracker?.buildPassed).toBe(false);
    expect(state._verificationTracker?.testPassed).toBe(false);
    expect(state._verificationTracker?.typecheckPassed).toBe(false);

    expect(state._verificationBudget).toBeGreaterThan(0);
    expect(state._diagnosticAttempts).toBe(0);
    expect(state._deepDiagnosticBudgetGranted).toBe(false);
    expect(Array.isArray(state._appliedPlanHistory)).toBe(true);
  });

  it('resets _planSearchWebCount to 0', async () => {
    const state = makeFreshVerificationState();
    state._planSearchWebCount = 42;

    await resolvePlanEntry(state);
    expect(state._planSearchWebCount).toBe(0);
  });
});

describe('resolvePlanEntry — verification retry (C15)', () => {
  it('clears *Attempted flags while preserving *Passed and *Required', async () => {
    const state = makeFreshVerificationState();
    state.currentTask = {
      id: 't1',
      name: 'verify',
      description: 'Verification task',
      type: 'verification',
      priority: 1000,
    };
    state._planEntryReason = 'retry';
    state._verificationTracker = {
      buildPassed: true,
      testPassed: false,
      typecheckPassed: true,
      buildAttempted: true,
      testAttempted: true,
      typecheckAttempted: true,
      testsRequired: true,
      typecheckRequired: true,
    };
    state._verificationBudget = 8;
    state._diagnosticAttempts = 0;
    state.retries = 1;
    state.violations = [{ type: 'type_error' as any, severity: 'critical', message: 'x' }];
    state.planText = '{"task":{"id":"t1"},"diagnostics":{"totalErrors":1}}';

    const ctx = await resolvePlanEntry(state);

    expect(ctx.isRetry).toBe(true);
    expect(ctx.retrySummaryText).toBeTruthy();

    expect(state._verificationTracker?.buildAttempted).toBe(false);
    expect(state._verificationTracker?.testAttempted).toBe(false);
    expect(state._verificationTracker?.typecheckAttempted).toBe(false);

    expect(state._verificationTracker?.buildPassed).toBe(true);
    expect(state._verificationTracker?.typecheckPassed).toBe(true);
    expect(state._verificationTracker?.testsRequired).toBe(true);
    expect(state._verificationTracker?.typecheckRequired).toBe(true);

    expect(state.violations).toEqual([]);
  });
});
