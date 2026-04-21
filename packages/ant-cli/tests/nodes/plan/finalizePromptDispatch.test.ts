import { describe, it, expect } from 'vitest';
import {
  selectFinalizePrompt,
  shouldShortCircuitEmptyPlan,
} from '../../../src/agents/architect/graph/code/nodes/plan/planGeneration';
import type { CodeTask } from '../../../src/agents/architect/types/task';

/**
 * T6b-β post-audit regression guard.
 *
 * The T6b-β migration accidentally narrowed the `finalizePlanFromExploration`
 * diagnostic gate from `verification || error` to `verification`-only based
 * on an invariant ("error tasks always fast-path via prePlanText") that is
 * false for decompose-emitted error tasks (directive containing error
 * messages / stack traces per
 * `core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md`).
 *
 * These predicate-level tests lock in that:
 *   - verification + error reach the BATCHED diagnostic prompt,
 *   - all other task types fall to the implementation prompt,
 *   - the empty-plan shortcut respects the same diagnostic gate.
 */

function task(type: CodeTask['type'], overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: `t-${type}`,
    name: `${type} task`,
    description: 'test',
    type,
    priority: 500,
    ...overrides,
  } as CodeTask;
}

describe('selectFinalizePrompt — diagnostic gate', () => {
  it('verification 태스크는 BATCHED diagnostic 프롬프트', () => {
    const prompt = selectFinalizePrompt(task('verification', { priority: 1000 }));
    expect(prompt).toContain('diagnostic remediation plan');
    expect(prompt).toContain('BATCHED format');
    expect(prompt).toContain('batches');
  });

  it('decompose-emitted error 태스크도 동일 BATCHED 프롬프트 (R-1 회귀 방어)', () => {
    const prompt = selectFinalizePrompt(task('error', { priority: 950 }));
    expect(prompt).toContain('diagnostic remediation plan');
    expect(prompt).toContain('BATCHED format');
    expect(prompt).toContain('batches');
  });

  it('feature 태스크는 implementation 프롬프트', () => {
    const prompt = selectFinalizePrompt(task('feature'));
    expect(prompt).toContain('implementation plan');
    expect(prompt).not.toContain('BATCHED');
    expect(prompt).not.toContain('diagnostic remediation plan');
  });

  it.each([
    ['ui'],
    ['design-system'],
    ['test-code'],
    ['doc'],
    ['setup'],
    ['explain'],
  ] as const)('비-diagnostic 태스크 %s 도 implementation 프롬프트', (t) => {
    const prompt = selectFinalizePrompt(task(t as CodeTask['type']));
    expect(prompt).not.toContain('BATCHED');
    expect(prompt).toContain('implementation plan');
  });
});

describe('shouldShortCircuitEmptyPlan — diagnostic empty-plan gate', () => {
  const zeroErrors = { diagnostics: { totalErrors: 0 } };
  const allEmptyImpl = {
    implementation: { modify: [], create: [], delete: [] },
  };
  const withContent = {
    diagnostics: { totalErrors: 3 },
    implementation: { modify: ['a.ts'], create: [], delete: [] },
  };

  it('verification + totalErrors=0 → shortcut', () => {
    expect(shouldShortCircuitEmptyPlan(task('verification', { priority: 1000 }), zeroErrors)).toBe(true);
  });

  it('error + totalErrors=0 → shortcut (R-1 회귀 방어)', () => {
    expect(shouldShortCircuitEmptyPlan(task('error', { priority: 950 }), zeroErrors)).toBe(true);
  });

  it('error + all-empty implementation → shortcut', () => {
    expect(shouldShortCircuitEmptyPlan(task('error'), allEmptyImpl)).toBe(true);
  });

  it('feature 는 0 errors 여도 shortcut 안 탐', () => {
    expect(shouldShortCircuitEmptyPlan(task('feature'), zeroErrors)).toBe(false);
  });

  it('diagnostic 이지만 실제 내용 있으면 shortcut 안 탐', () => {
    expect(shouldShortCircuitEmptyPlan(task('verification'), withContent)).toBe(false);
    expect(shouldShortCircuitEmptyPlan(task('error'), withContent)).toBe(false);
  });

  it('delete 만 있어도 shortcut 안 탐 (implementation 비어있지 않음)', () => {
    expect(shouldShortCircuitEmptyPlan(task('verification'), {
      implementation: { modify: [], create: [], delete: ['x.ts'] },
    })).toBe(false);
  });
});
