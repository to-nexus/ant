/**
 * L2 — `nodes/plan/planGeneration.ts` taskRequiresPlan predicate.
 *
 * Introduced in T6b-κ together with isDocTask / isExplainTask so the
 * skip-planning gate lives as a disjunction of per-task predicates (R1)
 * instead of a cascade of literal `task.type !== '...'` comparisons in
 * the phase layer.
 *
 * F2 (2026-04) moved test-code back into the standard plan path — the
 * earlier `isTestCodeTask` skip branch was a phase-layer R1 residual
 * that trapped test-code in a silent retry loop when its check.evaluate
 * hook fired `incomplete_implementation` violations (no plan-LLM meant
 * no way for violations to reach the next execute prompt).
 *
 * This test locks:
 *   - verification / doc / explain tasks are skipped
 *   - VERIFICATION_PRIORITY priority short-circuits regardless of type
 *   - test-code is NO LONGER skipped — flows through standard plan
 *   - every other task type (feature / ui / design-system / error /
 *     setup) still requires plan text
 */

import { describe, it, expect } from 'vitest';

import { taskRequiresPlan } from '../../../src/agents/architect/graph/code/nodes/plan/llm';
import { VERIFICATION_PRIORITY } from '../../../src/agents/architect/graph/code/state';
import type { CodeTask } from '../../../src/agents/architect/types/task';

function task(
  type: CodeTask['type'],
  overrides: Partial<CodeTask> = {},
): CodeTask {
  return {
    id: `t-${type}`,
    name: `t-${type}`,
    type,
    priority: 400,
    description: `task ${type}`,
    ...overrides,
  } as CodeTask;
}

describe('nodes/plan/planGeneration — taskRequiresPlan', () => {
  describe('skips plan generation', () => {
    it('verification tasks — covered by isVerificationTask', () => {
      expect(taskRequiresPlan(task('verification'))).toBe(false);
    });

    it('doc tasks — covered by isDocTask', () => {
      expect(taskRequiresPlan(task('doc'))).toBe(false);
    });

    it('explain tasks — covered by isExplainTask', () => {
      expect(taskRequiresPlan(task('explain'))).toBe(false);
    });

    it('VERIFICATION_PRIORITY priority short-circuits before predicate chain', () => {
      // Priority-guard ensures dynamically-constructed tasks whose
      // `type` is missing still skip plan generation.
      const t = task('feature', { priority: VERIFICATION_PRIORITY });
      expect(taskRequiresPlan(t)).toBe(false);
    });
  });

  describe('requires plan generation', () => {
    it('feature tasks', () => {
      expect(taskRequiresPlan(task('feature'))).toBe(true);
    });

    it('ui tasks', () => {
      expect(taskRequiresPlan(task('ui'))).toBe(true);
    });

    it('design-system tasks', () => {
      expect(taskRequiresPlan(task('design-system'))).toBe(true);
    });

    it('error tasks', () => {
      expect(taskRequiresPlan(task('error'))).toBe(true);
    });

    it('setup tasks', () => {
      expect(taskRequiresPlan(task('setup'))).toBe(true);
    });

    it('test-code tasks — F2 restored standard plan path', () => {
      // Previously skipped via `isTestCodeTask` (R1 residual). F2 moved
      // test-code back into the standard plan path so keyword / RAG /
      // planGen run like every other code-writing task and retries can
      // actually surface violations to the next prompt.
      expect(taskRequiresPlan(task('test-code'))).toBe(true);
    });
  });
});
