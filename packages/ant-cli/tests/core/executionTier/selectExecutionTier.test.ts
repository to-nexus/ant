/**
 * selectExecutionTier — 7-cell (mode × complexity) matrix + fallback coverage.
 *
 * SSOT: 18-session-redesign.md §5.1.1 tier matrix.
 *   explain × oneshot     → 0 Reflex
 *   any     × oneshot     → 1 OneShot
 *   any     × exploratory → 2 Exploratory
 *   any     × task        → 3 Task
 *   fallback              → 4 Plan
 */
import { describe, it, expect } from 'vitest';
import { selectExecutionTier } from '../../../src/core/executionTier/selectExecutionTier';

describe('selectExecutionTier', () => {
  it('explain × oneshot → Tier 0 (Reflex)', () => {
    expect(selectExecutionTier('explain', 'oneshot')).toBe(0);
  });

  it('generate × oneshot → Tier 1 (OneShot)', () => {
    expect(selectExecutionTier('generate', 'oneshot')).toBe(1);
  });

  it('refactor × oneshot → Tier 1 (OneShot)', () => {
    expect(selectExecutionTier('refactor', 'oneshot')).toBe(1);
  });

  it('explain × exploratory → Tier 2 (Exploratory)', () => {
    expect(selectExecutionTier('explain', 'exploratory')).toBe(2);
  });

  it('generate × exploratory → Tier 2 (Exploratory)', () => {
    expect(selectExecutionTier('generate', 'exploratory')).toBe(2);
  });

  it('refactor × exploratory → Tier 2 (Exploratory)', () => {
    expect(selectExecutionTier('refactor', 'exploratory')).toBe(2);
  });

  it('explain × task → Tier 3 (Task, explain variant)', () => {
    expect(selectExecutionTier('explain', 'task')).toBe(3);
  });

  it('generate × task → Tier 3 (Task, generate variant)', () => {
    expect(selectExecutionTier('generate', 'task')).toBe(3);
  });

  it('refactor × task → Tier 3 (Task, refactor variant)', () => {
    expect(selectExecutionTier('refactor', 'task')).toBe(3);
  });

  it('undefined mode falls back to Tier 4 (Plan)', () => {
    expect(selectExecutionTier(undefined, 'task')).toBe(4);
  });

  it('undefined complexity falls back to Tier 4 (Plan)', () => {
    expect(selectExecutionTier('generate', undefined)).toBe(4);
  });

  it('both undefined falls back to Tier 4 (Plan)', () => {
    expect(selectExecutionTier(undefined, undefined)).toBe(4);
  });
});
