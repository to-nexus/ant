/**
 * isVisualTierActive gate — SSOT for Visual Tier availability.
 *
 * Rule: `basisSlot.visualTier === true
 *        && techTier.stack !== 'backend'
 *        && !hasUiDoc`.
 * Four surfaces (FE wizard / FE summary / BE decompose / prompt injection)
 * all read this single predicate.
 */
import { describe, it, expect } from 'vitest';
import { isVisualTierActive, pathsContainUiDoc, type BasisSlotConfig, type TechTierConfig } from '@ant/shared';

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

  // ─────────────────────────────────────────────────────────────
  // hasUiDoc axis — UI design doc in RAC closes the gate.
  //
  // UI design docs (ant / figma / handoff) own the design-system
  // authority. When any is present in the user-selected RAC, a
  // parallel visualTier would be redundant/conflicting; the gate
  // must close regardless of other axes.
  // ─────────────────────────────────────────────────────────────
  it('returns false when hasUiDoc=true regardless of stack', () => {
    expect(isVisualTierActive(yesSlot, { stack: 'frontend' } as TechTierConfig, true)).toBe(false);
    expect(isVisualTierActive(yesSlot, { stack: 'fullstack' } as TechTierConfig, true)).toBe(false);
    expect(isVisualTierActive(yesSlot, undefined, true)).toBe(false);
  });

  it('returns true when hasUiDoc=false (explicit) and other axes pass', () => {
    expect(isVisualTierActive(yesSlot, { stack: 'frontend' } as TechTierConfig, false)).toBe(true);
  });

  it('hasUiDoc=undefined behaves like false (gate open)', () => {
    expect(isVisualTierActive(yesSlot, { stack: 'frontend' } as TechTierConfig, undefined)).toBe(true);
  });
});

describe('pathsContainUiDoc', () => {
  it('returns false for empty / undefined input', () => {
    expect(pathsContainUiDoc(undefined)).toBe(false);
    expect(pathsContainUiDoc([])).toBe(false);
  });

  it('returns false for paths that are not UI artifacts', () => {
    expect(pathsContainUiDoc([
      'inputs/sources/prd.md',
      'outputs/design/spec/core.md',
      'outputs/design/system/fe-system-app.md',
    ])).toBe(false);
  });

  it('detects ant / figma / handoff UI docs', () => {
    expect(pathsContainUiDoc(['outputs/design/ui/ant/ui-spec.json'])).toBe(true);
    expect(pathsContainUiDoc(['outputs/design/ui/figma/figma.json'])).toBe(true);
    expect(pathsContainUiDoc(['outputs/design/ui/handoff/overview.html'])).toBe(true);
  });

  it('returns true when any item in a mixed list is a UI doc', () => {
    expect(pathsContainUiDoc([
      'inputs/sources/prd.md',
      'outputs/design/ui/handoff/overview.html',
    ])).toBe(true);
  });
});
