/**
 * L1 — retry counter single-writer contract.
 *
 * Context: `bc1e45b9 feat(ant-cli): remove enforce node and consolidate
 * retry/violation flow` declared `handleRetryEntry` as the sole writer
 * of `state.retries`. The earlier `retries: preservedRetries` override
 * in plan's return objects silently dropped the increment and trapped
 * generic retryable tasks in an infinite loop (observed in the
 * `plum-molding-bench` code job's test-code task). F3 removed the
 * override so `state.retries` mutations by `handleRetryEntry` now
 * persist through plan's return into LangGraph state.
 *
 * These tests exercise `handleRetryEntry` directly (via
 * `resolvePlanEntry`) and `plan.maxRetries` throw semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import { __testing__ } from '../src/agents/architect/graph/code/nodes/plan';
import { VerificationTerminalError } from '../src/agents/architect/graph/code/tasks/_shared/verify/errors';

const { resolvePlanEntry } = __testing__;

function makeRetryEntryState(overrides: Record<string, any> = {}) {
  return {
    currentTask: {
      id: 'feature-x',
      name: 'Feature X',
      description: 'Implement Feature X',
      type: 'feature',
      priority: 300,
    },
    _nextPlanEntry: 'retry' as const,
    _activePhase: 'execute' as const,
    taskQueue: {
      pop: vi.fn(),
      getAll: vi.fn(() => []),
      size: vi.fn(() => 0),
      push: vi.fn(),
    },
    retries: 0,
    maxRetries: 3,
    conversations: {},
    completedTasksDetails: [],
    violations: [],
    _httpJobId: undefined,
    deps: {} as any,
    context: { featurePath: undefined, featureFolder: undefined } as any,
    recursionCount: 0,
    recursionLimit: 200,
    ...overrides,
  } as any;
}

describe('handleRetryEntry — state.retries is the authoritative counter', () => {
  it('increments state.retries on generic retry entry', async () => {
    const state = makeRetryEntryState({ retries: 0 });
    await resolvePlanEntry(state);
    // Generic (non-verification) task: phase layer is single writer and
    // must bump the counter so subsequent retries converge on maxRetries.
    expect(state.retries).toBe(1);
  });

  it('throws VerificationTerminalError("max_retries_exceeded") when state.retries reaches maxRetries', async () => {
    const state = makeRetryEntryState({ retries: 3, maxRetries: 3 });
    // state.retries becomes 4 (>= maxRetries) inside handleRetryEntry → throw.
    let caught: unknown;
    try {
      await resolvePlanEntry(state);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VerificationTerminalError);
    expect((caught as VerificationTerminalError).kind).toBe('max_retries_exceeded');
    expect((caught as VerificationTerminalError).message).toContain('Feature X');
  });

  it('accumulates retries across multiple plan re-entries (regression: was reset by `retries: preservedRetries`)', async () => {
    const state = makeRetryEntryState({ retries: 0, maxRetries: 5 });
    await resolvePlanEntry(state);
    expect(state.retries).toBe(1);

    // Simulate checkTaskStatus re-dispatching for another retry — it does
    // NOT touch state.retries, only sets `_nextPlanEntry: 'retry'`.
    state._nextPlanEntry = 'retry';
    await resolvePlanEntry(state);
    expect(state.retries).toBe(2);

    state._nextPlanEntry = 'retry';
    await resolvePlanEntry(state);
    expect(state.retries).toBe(3);
  });
});

describe('tool-loop re-entry (inToolLoop=true) — retries is untouched', () => {
  it('does NOT mutate state.retries when re-entering plan from tool node', async () => {
    // Simulates the plan↔tool loop ae0db2b3 originally guarded: plan is
    // re-invoked with _activePhase='plan' while state.retries carries a
    // non-zero count from a prior handleRetryEntry run. The re-entry
    // branch must not reset nor bump retries — only the explicit retry
    // entry writes to the counter.
    const state = makeRetryEntryState({
      retries: 2,
      _nextPlanEntry: undefined,
      _activePhase: 'plan',
    });
    const { context: ctx, delta } = await resolvePlanEntry(state);
    expect(ctx.inToolLoop).toBe(true);
    expect(ctx.isRetry).toBe(false);
    expect(state.retries).toBe(2);
    // Tool-loop re-entry has no pending state writes.
    expect(delta).toEqual({});
  });
});

describe('fresh task entry — retries is not touched (TaskWorker/checkTaskStatus seed to 0)', () => {
  it('leaves state.retries untouched (the seed is owned by upstream nodes)', async () => {
    const state = makeRetryEntryState({
      currentTask: undefined,
      _nextPlanEntry: undefined,
      _activePhase: undefined,
      retries: 0,
      taskQueue: {
        pop: vi.fn(() => ({
          id: 't1',
          name: 't1',
          description: 'd',
          type: 'feature',
          priority: 300,
        })),
        getAll: vi.fn(() => []),
        size: vi.fn(() => 0),
        push: vi.fn(),
      },
    });
    await resolvePlanEntry(state);
    expect(state.retries).toBe(0);
  });
});
