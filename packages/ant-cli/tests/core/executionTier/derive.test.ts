/**
 * core/executionTier/derive — tier-boundary helpers under Tier-Verification
 * Alignment (Phase 1).
 *
 * The boundary shifted from `tier <= 2 → direct` to `tier <= 1 → direct`.
 * Tier 2 (Exploratory) is now a task-path tier (single unit of work with
 * `selfVerifyOnDone`), not a direct ReAct loop.
 */

import { describe, it, expect } from 'vitest';
import { ExecutionTierId } from '@ant/shared';
import {
  isDirectTier,
  isTaskTier,
  tierToDirectMode,
} from '../../../src/core/executionTier/derive';

describe('isDirectTier — boundary is tier <= 1', () => {
  it('Tier 0 Reflex → direct', () => {
    expect(isDirectTier(ExecutionTierId.Reflex)).toBe(true);
  });

  it('Tier 1 OneShot → direct', () => {
    expect(isDirectTier(ExecutionTierId.OneShot)).toBe(true);
  });

  it('Tier 2 Exploratory → NOT direct (task path)', () => {
    expect(isDirectTier(ExecutionTierId.Exploratory)).toBe(false);
  });

  it('Tier 3 Task → NOT direct', () => {
    expect(isDirectTier(ExecutionTierId.Task)).toBe(false);
  });

  it('Tier 4 RefsGrounded → NOT direct', () => {
    expect(isDirectTier(ExecutionTierId.RefsGrounded)).toBe(false);
  });
});

describe('isTaskTier — boundary is tier >= 2', () => {
  it('Tier 0 Reflex → NOT task', () => {
    expect(isTaskTier(ExecutionTierId.Reflex)).toBe(false);
  });

  it('Tier 1 OneShot → NOT task', () => {
    expect(isTaskTier(ExecutionTierId.OneShot)).toBe(false);
  });

  it('Tier 2 Exploratory → task path', () => {
    expect(isTaskTier(ExecutionTierId.Exploratory)).toBe(true);
  });

  it('Tier 3 Task → task path', () => {
    expect(isTaskTier(ExecutionTierId.Task)).toBe(true);
  });

  it('Tier 4 RefsGrounded → task path', () => {
    expect(isTaskTier(ExecutionTierId.RefsGrounded)).toBe(true);
  });

  it('isDirectTier and isTaskTier are exhaustive / disjoint for every tier', () => {
    for (const tier of [
      ExecutionTierId.Reflex,
      ExecutionTierId.OneShot,
      ExecutionTierId.Exploratory,
      ExecutionTierId.Task,
      ExecutionTierId.RefsGrounded,
    ]) {
      expect(isDirectTier(tier) !== isTaskTier(tier)).toBe(true);
    }
  });
});

describe('tierToDirectMode — Tier 0 undefined, Tier 1 oneshot, Tier 2+ undefined', () => {
  it('Tier 0 Reflex → undefined (no tool loop; single assistant turn)', () => {
    expect(tierToDirectMode(ExecutionTierId.Reflex)).toBeUndefined();
  });

  it('Tier 1 OneShot → oneshot', () => {
    expect(tierToDirectMode(ExecutionTierId.OneShot)).toBe('oneshot');
  });

  it('Tier 2 Exploratory → undefined (routed to task path, not direct)', () => {
    expect(tierToDirectMode(ExecutionTierId.Exploratory)).toBeUndefined();
  });

  it('Tier 3 Task → undefined', () => {
    expect(tierToDirectMode(ExecutionTierId.Task)).toBeUndefined();
  });

  it('Tier 4 RefsGrounded → undefined', () => {
    expect(tierToDirectMode(ExecutionTierId.RefsGrounded)).toBeUndefined();
  });
});
