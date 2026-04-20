/**
 * L1 — `nodes/checkTaskStatus/evaluate.ts` pure judgement.
 *
 * Locks the shared violation-builder contract that backs both the main
 * graph `checkTaskStatus` and the worker subgraph `workerCheckTaskStatus`:
 *   - fileErrors → typed violations with classifier
 *   - budget-exhaustion guard is task-type-blind (dispatches hint via hook)
 *   - task-type-specific `check.evaluate` is dispatched only when the LLM
 *     signalled `<done>` and no prior violation fired
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateTaskStatus } from '../../../src/agents/architect/graph/code/nodes/checkTaskStatus/evaluate';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 't1', name: 'task', type: 'feature', priority: 10 },
    commandHistory: [],
    llmResponse: { done: true },
    ...overrides,
  } as any;
}

describe('nodes/checkTaskStatus/evaluate', () => {
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

  it('returns no violations when state is clean and LLM signalled done', async () => {
    const state = makeState();
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toEqual([]);
    expect(result.llmExplicitlyDone).toBe(true);
    expect(result.stopRequested).toBe(false);
    expect(result.batchSplitRequeued).toBe(false);
  });

  it('classifies `Cannot edit non-existing file` as missing_file', async () => {
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/foo.ts"'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('missing_file');
    expect(result.violations[0].file).toBe('src/foo.ts');
  });

  it('classifies `Search block not found` as file_operation_failed', async () => {
    const state = makeState({
      fileErrors: ['Search block not found in file "src/bar.ts"'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations[0].type).toBe('file_operation_failed');
    expect(result.violations[0].suggestedFix).toContain('src/bar.ts');
  });

  it('classifies `already created by task` as cross_worker_conflict', async () => {
    const state = makeState({
      fileErrors: ['File "src/baz.ts" was already created by task other-worker'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'worker' });
    expect(result.violations[0].type).toBe('cross_worker_conflict');
  });

  it('injects budget_exhausted when LLM did not signal done', async () => {
    const state = makeState({ llmResponse: { done: false } as any });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('budget_exhausted');
    // Generic task types get the generic hint — no `task.type` branching.
    expect(result.violations[0].suggestedFix).toContain('Break down the task scope');
  });

  it('verification task picks up the verification-specific budget hint via hook', async () => {
    const state = makeState({
      llmResponse: { done: false } as any,
      currentTask: { id: 'v1', name: 'verify', type: 'verification', priority: 10 } as any,
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations[0].type).toBe('budget_exhausted');
    expect(result.violations[0].suggestedFix).toContain('Verification task did not complete');
  });

  it('dispatches to hook check.evaluate only when no prior violation + done=true', async () => {
    // When fileErrors exist, budget/hook check should not fire.
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/a.ts"'],
      currentTask: { id: 'tc', name: 'tc', type: 'test-code', priority: 10 } as any,
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    // test-code hook would have added incomplete_implementation, but
    // fileErrors block the hook from running.
    expect(result.violations.every(v => v.type !== 'incomplete_implementation')).toBe(true);
  });

  it('exposes _isStopRequested() and _batchSplitRequeued pass-through flags', async () => {
    const state = makeState({
      _isStopRequested: () => true,
      _batchSplitRequeued: true,
    } as any);
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.stopRequested).toBe(true);
    expect(result.batchSplitRequeued).toBe(true);
  });
});
