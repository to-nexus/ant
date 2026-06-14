/**
 * L1 — test-code tasks flow through the standard plan path (F2).
 *
 * Regression context: an earlier `if (isTestCodeTask(task)) return false;`
 * branch in `taskRequiresPlan` skipped plan-LLM for test-code, leaving
 * retry cycles silent (no keyword / planGen / violation injection) and
 * turning any `incomplete_implementation` violation into an infinite
 * identical-prompt loop (observed in the `plum-molding-bench` code job).
 * F2 removed the branch; this test locks the invariant.
 */

import { describe, it, expect } from 'vitest';
import { taskRequiresPlan } from '../../src/agents/architect/graph/code/nodes/plan/llm';
import { VERIFICATION_PRIORITY } from '../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../src/agents/architect/types/task';

function makeTask(overrides: Partial<CodeTask>): CodeTask {
  return {
    id: 'test-code',
    name: 'Test Suite',
    description: 'Write tests covering section rendering',
    priority: 700,
    ...overrides,
  } as CodeTask;
}

describe('taskRequiresPlan — F2: test-code takes the standard plan path', () => {
  it('returns true for test-code (no longer skipped)', () => {
    expect(taskRequiresPlan(makeTask({ type: 'test-code' as any }))).toBe(true);
  });

  it('still returns true for feature / ui / design-system (unchanged)', () => {
    expect(taskRequiresPlan(makeTask({ type: 'feature' as any }))).toBe(true);
    expect(taskRequiresPlan(makeTask({ type: 'ui' as any }))).toBe(true);
    expect(taskRequiresPlan(makeTask({ type: 'design-system' as any }))).toBe(true);
  });

  it('still returns false for verification / doc / explain (unchanged)', () => {
    expect(taskRequiresPlan(makeTask({ type: 'verification' as any }))).toBe(false);
    expect(taskRequiresPlan(makeTask({ type: 'doc' as any }))).toBe(false);
    expect(taskRequiresPlan(makeTask({ type: 'explain' as any }))).toBe(false);
  });

  it('still returns false for the VERIFICATION_PRIORITY priority guard', () => {
    expect(
      taskRequiresPlan(makeTask({
        type: 'feature' as any,
        priority: VERIFICATION_PRIORITY,
      })),
    ).toBe(false);
  });
});
