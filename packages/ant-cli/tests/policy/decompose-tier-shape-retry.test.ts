/**
 * Decompose tier-shape retry contract (fixed-imaging-batch incident).
 *
 * `validateTierTaskShape` mirrors `createTaskQueue`'s tier count/shape gates
 * as a pure check run INSIDE the decompose retry loop, so an LLM shape drift
 * (e.g. glm emitting `selfVerifyOnDone:true` on a Tier 4 work task) gets a
 * corrective framing retry instead of crashing the job at the post-loop
 * `createTaskQueue` backstop.
 *
 * Locks:
 *   1. All five violation kinds throw a typed `TierShapeViolation`.
 *   2. Legitimate shapes pass (Tier 2 explain without the flag, Tier 3
 *      [feature × 1 + verification × 1], Tier 4 multi-task).
 *   3. Exemptions: empty task list and Tier 0/1 are skipped (owned by the
 *      specClarify / empty-tasks guard and the direct path respectively).
 *   4. Framing builders name the tier / task so the LLM can self-correct.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTierTaskShape,
  TierShapeViolation,
  buildTierShapeViolationFraming,
} from '../../src/agents/architect/graph/code/nodes/decompose/validation';
import type { CodeTask } from '../../src/agents/architect/types/task';

// `validateTierTaskShape` is a RUNTIME guard against malformed decompose output
// — the whole reason it exists is that an LLM can emit shapes the compile-time
// union forbids (e.g. `selfVerifyOnDone` on a variant that does not declare it,
// which is the tier2-flag-on-tier4 case below). So this builder deliberately
// accepts out-of-contract overrides, with the cast localised here rather than at
// every call site.
const task = (overrides: Record<string, unknown> = {}): CodeTask =>
  ({
    id: 'feature-1',
    name: 'Build feature',
    type: 'feature',
    priority: 300,
    description: 'implement X',
    ...overrides,
  }) as CodeTask;

const verification = (): CodeTask => task({
  id: 'final-verification',
  name: 'Final Verification',
  type: 'verification',
  priority: 1000,
  description: 'validate build + tests',
});

const catchViolation = (fn: () => void): TierShapeViolation => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TierShapeViolation);
    return e as TierShapeViolation;
  }
  throw new Error('expected TierShapeViolation, nothing was thrown');
};

describe('validateTierTaskShape — violation kinds', () => {
  it('tier2-count: Tier 2 with 2 tasks throws', () => {
    const v = catchViolation(() =>
      validateTierTaskShape([task({ selfVerifyOnDone: true }), task({ id: 'f2' })], 2),
    );
    expect(v.detail.kind).toBe('tier2-count');
    expect(v.detail.taskCount).toBe(2);
  });

  it('tier2-missing-flag: sole non-explain Tier 2 task without selfVerifyOnDone throws', () => {
    const v = catchViolation(() => validateTierTaskShape([task()], 2));
    expect(v.detail.kind).toBe('tier2-missing-flag');
    expect(v.detail.taskName).toBe('Build feature');
  });

  it('tier34-count: Tier 3 with a single task throws', () => {
    const v = catchViolation(() => validateTierTaskShape([task()], 3));
    expect(v.detail.kind).toBe('tier34-count');
  });

  it('tier34-missing-final: Tier 3 without a verification task throws', () => {
    const v = catchViolation(() =>
      validateTierTaskShape([task(), task({ id: 'f2', name: 'Second' })], 3),
    );
    expect(v.detail.kind).toBe('tier34-missing-final');
  });

  it('tier34-selfverify-leak: Tier 4 work task carrying the flag throws (incident shape)', () => {
    const v = catchViolation(() =>
      validateTierTaskShape(
        [task({ id: 'vpad-direction-hysteresis', name: 'VPad direction hysteresis', selfVerifyOnDone: true }), verification()],
        4,
      ),
    );
    expect(v.detail.kind).toBe('tier34-selfverify-leak');
    expect(v.detail.taskId).toBe('vpad-direction-hysteresis');
    expect(v.detail.executionTier).toBe(4);
  });
});

describe('validateTierTaskShape — legitimate shapes pass', () => {
  it('Tier 2 single task with selfVerifyOnDone:true passes', () => {
    expect(() => validateTierTaskShape([task({ selfVerifyOnDone: true })], 2)).not.toThrow();
  });

  it('Tier 2 explain task without the flag passes', () => {
    expect(() =>
      validateTierTaskShape([task({ type: 'explain', selfVerifyOnDone: false })], 2),
    ).not.toThrow();
  });

  it('Tier 3 [feature × 1 + verification × 1] passes', () => {
    expect(() => validateTierTaskShape([task(), verification()], 3)).not.toThrow();
  });

  it('Tier 4 multi-task with clean flags passes', () => {
    expect(() =>
      validateTierTaskShape([task(), task({ id: 'f2', name: 'Second' }), verification()], 4),
    ).not.toThrow();
  });
});

describe('validateTierTaskShape — exemptions', () => {
  it('empty task list is skipped at every tier (owned by the empty-tasks guard)', () => {
    for (const tier of [2, 3, 4] as const) {
      expect(() => validateTierTaskShape([], tier)).not.toThrow();
    }
  });

  it('Tier 0/1 are skipped even with malformed tasks (direct path clears them)', () => {
    expect(() => validateTierTaskShape([task({ selfVerifyOnDone: true })], 0)).not.toThrow();
    expect(() => validateTierTaskShape([task(), task({ id: 'f2' })], 1)).not.toThrow();
  });
});

describe('buildTierShapeViolationFraming', () => {
  it('leak framing names the task and tier and demands re-emission', () => {
    const v = catchViolation(() =>
      validateTierTaskShape([task({ selfVerifyOnDone: true }), verification()], 4),
    );
    const framing = buildTierShapeViolationFraming(v);
    expect(framing).toContain('## Retry: tier/task shape contract violation');
    expect(framing).toContain('Build feature');
    expect(framing).toContain('Tier 4');
    expect(framing).toContain('selfVerifyOnDone');
    expect(framing).toContain('Re-emit the FULL response');
  });

  it('every kind produces a distinct non-empty framing', () => {
    const violations: TierShapeViolation[] = [
      catchViolation(() => validateTierTaskShape([task({ selfVerifyOnDone: true }), task({ id: 'f2' })], 2)),
      catchViolation(() => validateTierTaskShape([task()], 2)),
      catchViolation(() => validateTierTaskShape([task()], 3)),
      catchViolation(() => validateTierTaskShape([task(), task({ id: 'f2', name: 'Second' })], 3)),
      catchViolation(() => validateTierTaskShape([task({ selfVerifyOnDone: true }), verification()], 4)),
    ];
    const framings = violations.map(buildTierShapeViolationFraming);
    expect(new Set(framings).size).toBe(5);
    for (const f of framings) expect(f.length).toBeGreaterThan(100);
  });
});
