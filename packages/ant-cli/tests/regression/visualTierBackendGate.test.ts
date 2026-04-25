/**
 * Visual Tier matrix gate — SSOT for Visual Tier availability.
 *
 * After Phase 1 D9, the gate is `isTierActive('visualTier', slot, domain, runtime)`
 * — `isVisualTierActive` was retired in favour of the unified matrix
 * predicate. Three runtime axes still suppress visualTier (slot opt-in via
 * `tiers`, backend-only stack, hasUiDoc=true).
 */
import { describe, it, expect } from 'vitest';
import { isTierActive, pathsContainUiDoc, type BasisSlotConfig, type TechTierConfig } from '@ant/shared';

describe('isTierActive(visualTier)', () => {
  const yesSlot: BasisSlotConfig = { tiers: ['domain', 'visualTier'] };
  const noSlot: BasisSlotConfig = { tiers: ['domain'] };
  const emptySlot: BasisSlotConfig = {};

  it('returns false when slot does not declare visualTier', () => {
    expect(isTierActive('visualTier', noSlot, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
    expect(isTierActive('visualTier', emptySlot, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
    expect(isTierActive('visualTier', undefined, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
  });

  it('returns false for backend-only stack even when slot allows visualTier', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'backend' } as TechTierConfig })).toBe(false);
  });

  it('returns true for frontend and fullstack stacks', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(true);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'fullstack' } as TechTierConfig })).toBe(true);
  });

  it('returns true when techTier is undefined (stack not yet chosen)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: undefined })).toBe(true);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: {} })).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // hasUiDoc axis — UI design doc in RAC closes the gate.
  // ─────────────────────────────────────────────────────────────
  it('returns false when hasUiDoc=true regardless of stack', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig, hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'fullstack' } as TechTierConfig, hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'service', { hasUiDoc: true })).toBe(false);
  });

  it('returns true when hasUiDoc=false and other axes pass', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig, hasUiDoc: false })).toBe(true);
  });

  it('hasUiDoc=undefined behaves like false (gate open)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(true);
  });

  it('domain=game passes — visualTier is shared between game and service', () => {
    expect(isTierActive('visualTier', yesSlot, 'game', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(true);
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
