/**
 * isVisualTierActive gate — SSOT for Visual Tier availability.
 *
 * Rule: `basisSlot.visualTier === true && techTier.stack !== 'backend'`.
 * Four surfaces (FE wizard / FE summary / BE decompose / prompt injection)
 * all read this single predicate.
 */
import { describe, it, expect } from 'vitest';
import { isVisualTierActive, type BasisSlotConfig, type TechTierConfig } from '@ant/shared';

describe('isVisualTierActive', () => {
  const yesSlot: BasisSlotConfig = { visualTier: true };
  const noSlot: BasisSlotConfig = { visualTier: false };
  const emptySlot: BasisSlotConfig = {};

  it('returns false when slot does not declare visualTier', () => {
    expect(isVisualTierActive(noSlot, { stack: 'frontend' })).toBe(false);
    expect(isVisualTierActive(emptySlot, { stack: 'frontend' })).toBe(false);
    expect(isVisualTierActive(undefined, { stack: 'frontend' })).toBe(false);
  });

  it('returns false for backend-only stack even when slot allows visualTier', () => {
    expect(isVisualTierActive(yesSlot, { stack: 'backend' } as TechTierConfig)).toBe(false);
  });

  it('returns true for frontend and fullstack stacks', () => {
    expect(isVisualTierActive(yesSlot, { stack: 'frontend' } as TechTierConfig)).toBe(true);
    expect(isVisualTierActive(yesSlot, { stack: 'fullstack' } as TechTierConfig)).toBe(true);
  });

  it('returns true when techTier is undefined (stack not yet chosen)', () => {
    expect(isVisualTierActive(yesSlot, undefined)).toBe(true);
    expect(isVisualTierActive(yesSlot, {})).toBe(true);
  });
});
