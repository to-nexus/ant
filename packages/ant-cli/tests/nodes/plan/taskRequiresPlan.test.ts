/**
 * L2 — `nodes/plan/planGeneration.ts` taskRequiresPlan predicate.
 *
 * Introduced in T6b-κ together with isTestCodeTask / isDocTask /
 * isExplainTask so the skip-planning gate lives as a disjunction of
 * per-task predicates (R1) instead of a cascade of literal
 * `task.type !== '...'` comparisons in the phase layer.
 *
 * This test locks:
 *   - verification / test-code / doc / explain tasks are skipped
 *   - FINAL_VERIFICATION priority short-circuits regardless of type
 *   - every other task type (feature / ui / design-system / error /
 *     setup) still requires plan text
 */

import { describe, it, expect } from 'vitest';

import { taskRequiresPlan } from '../../../src/agents/architect/graph/code/nodes/plan/planGeneration';
import { TASK_PRIORITIES } from '../../../src/agents/architect/graph/code/state';
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

    it('test-code tasks — covered by isTestCodeTask', () => {
      expect(taskRequiresPlan(task('test-code'))).toBe(false);
    });

    it('doc tasks — covered by isDocTask', () => {
      expect(taskRequiresPlan(task('doc'))).toBe(false);
    });

    it('explain tasks — covered by isExplainTask', () => {
      expect(taskRequiresPlan(task('explain'))).toBe(false);
    });

    it('FINAL_VERIFICATION priority short-circuits before predicate chain', () => {
      // Priority-guard ensures dynamically-constructed tasks whose
      // `type` is missing still skip plan generation.
      const t = task('feature', { priority: TASK_PRIORITIES.FINAL_VERIFICATION });
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
  });
});
