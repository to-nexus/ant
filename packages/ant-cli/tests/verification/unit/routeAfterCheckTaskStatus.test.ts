/**
 * L1 unit — routeAfterCheckTaskStatus 3-axis branching.
 *
 * Covers (see docs/testing/verification-scenarios.md, matrix C2-C5):
 *   - violations=0 → learn
 *   - violations>0 + recursionRemaining<20 → learn
 *   - violations>0 + retries<maxRetries → enforce
 *   - violations>0 + retries>=maxRetries → learn
 */

import { describe, it, expect } from 'vitest';
import { routeAfterCheckTaskStatus } from '../../../src/agents/architect/graph/code/routing';
import type { ArchitectGraphState, Violation } from '../../../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState>): ArchitectGraphState {
  return {
    violations: [],
    retries: 0,
    maxRetries: 3,
    recursionCount: 10,
    recursionLimit: 200,
    ...overrides,
  } as any;
}

const violation = (type: string = 'verification_incomplete'): Violation => ({
  type: type as any,
  severity: 'critical',
  message: 'test',
  isRetryable: true,
});

describe('routeAfterCheckTaskStatus — 3-axis branching', () => {
  describe('Axis 1: violations', () => {
    it('no violations → learn', () => {
      expect(routeAfterCheckTaskStatus(makeState({ violations: [] }))).toBe('learn');
    });

    it('undefined violations → learn', () => {
      expect(routeAfterCheckTaskStatus(makeState({ violations: undefined }))).toBe('learn');
    });

    it('has violations + budget + retries available → enforce', () => {
      expect(routeAfterCheckTaskStatus(
        makeState({ violations: [violation()], retries: 0, maxRetries: 3 }),
      )).toBe('enforce');
    });
  });

  describe('Axis 2: recursion budget', () => {
    it('has violations but recursionRemaining < 20 → learn (insufficient budget)', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 0,
        maxRetries: 3,
        recursionCount: 185,
        recursionLimit: 200,
      }))).toBe('learn');
    });

    it('has violations and recursionRemaining == 20 → enforce (boundary)', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 0,
        maxRetries: 3,
        recursionCount: 180,
        recursionLimit: 200,
      }))).toBe('enforce');
    });

    it('recursionLimit missing falls back to 200 default', () => {
      const result = routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 0,
        maxRetries: 3,
        recursionCount: 50,
        recursionLimit: undefined as any,
      }));
      expect(result).toBe('enforce');
    });
  });

  describe('Axis 3: retries vs maxRetries', () => {
    it('retries < maxRetries → enforce', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 2,
        maxRetries: 3,
      }))).toBe('enforce');
    });

    it('retries == maxRetries → learn (exhausted)', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 3,
        maxRetries: 3,
      }))).toBe('learn');
    });

    it('retries > maxRetries → learn', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 5,
        maxRetries: 3,
      }))).toBe('learn');
    });
  });

  describe('Axis interaction', () => {
    it('recursion check takes precedence over retry check', () => {
      expect(routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 0,
        maxRetries: 3,
        recursionCount: 190,
        recursionLimit: 200,
      }))).toBe('learn');
    });

    it('multiple violations behave identically to single violation', () => {
      const multi = routeAfterCheckTaskStatus(makeState({
        violations: [violation(), violation('budget_exhausted')],
        retries: 0,
        maxRetries: 3,
      }));
      const single = routeAfterCheckTaskStatus(makeState({
        violations: [violation()],
        retries: 0,
        maxRetries: 3,
      }));
      expect(multi).toBe(single);
    });
  });
});
