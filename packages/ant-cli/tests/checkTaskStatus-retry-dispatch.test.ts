/**
 * L1 — `workerCheckTaskStatus` retry dispatch after enforce node removal.
 *
 * The wrapper (post-enforce-removal) owns:
 *   1. `violation.isRetryable` filter — warnings are cleared so routing treats
 *      them as "no violations".
 *   2. `enforcementHistory` append — the feedback entry previously produced by
 *      the enforce node.
 *   3. `_nextPlanEntry: 'retry'` — tells `resolvePlanEntry` which branch to
 *      take so plan does NOT fall into `handleFreshTaskEntry` (duplicate
 *      `task_start` / reset counters).
 *
 * Worker subgraph wrapper is chosen over the main-graph wrapper because it
 * has no checkpoint / Kanban / SSE side-effects, so behaviour can be
 * asserted without mocking the whole deps surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workerCheckTaskStatus } from '../src/agents/architect/graph/code/nodes/checkTaskStatus/workerIndex';
import type { ArchitectGraphState } from '../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 't1', name: 'task', type: 'feature', priority: 10 },
    commandHistory: [],
    llmResponse: { done: true },
    retries: 0,
    maxRetries: 3,
    recursionCount: 0,
    recursionLimit: 200,
    ...overrides,
  } as any;
}

describe('workerCheckTaskStatus — retry dispatch (post-enforce-removal)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('retryable violation → filters+forwards, appends enforcementHistory, sets _nextPlanEntry=retry', async () => {
    const state = makeState({
      // `Cannot edit non-existing file` → missing_file with isRetryable=true
      fileErrors: ['Cannot edit non-existing file "src/foo.ts"'],
      enforcementHistory: [],
    });

    const result = await workerCheckTaskStatus(state) as any;

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('missing_file');
    expect(result.violations[0].isRetryable).toBe(true);
    expect(result._nextPlanEntry).toBe('retry');
    expect(result._taskCompleted).toBe(false);

    expect(result.enforcementHistory).toHaveLength(1);
    expect(result.enforcementHistory[0].taskId).toBe('t1');
    expect(result.enforcementHistory[0].attemptNumber).toBe(1);
    expect(result.enforcementHistory[0].fixStrategy).toBe('retry');
    expect(result.enforcementHistory[0].violations).toEqual(result.violations);
  });

  it('does NOT return an updated `retries` (handleRetryEntry is the single writer)', async () => {
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/foo.ts"'],
      retries: 1,
    });

    const result = await workerCheckTaskStatus(state) as any;

    // Violation path returns only { violations, enforcementHistory,
    // _nextPlanEntry, _taskCompleted, recursionCount, recursionLimit }.
    // `retries` must NOT be included — plan/handleRetryEntry is the
    // single +1 writer after the enforce node removal.
    expect(result.retries).toBeUndefined();
    expect(state.retries).toBe(1);
  });

  it('attemptNumber reflects current retries + 1 (1-indexed attempt count)', async () => {
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/foo.ts"'],
      retries: 2,
    });

    const result = await workerCheckTaskStatus(state) as any;
    expect(result.enforcementHistory[0].attemptNumber).toBe(3);
  });
});
