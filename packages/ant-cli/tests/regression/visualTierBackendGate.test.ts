/**
 * Visual Tier matrix gate — SSOT for Visual Tier availability.
 *
 * After Phase 1 D9, the gate is `isTierActive('visualTier', slot, domain, runtime)`
 * — `isVisualTierActive` was retired in favour of the unified matrix
 * predicate. Three runtime axes still suppress visualTier (slot opt-in via
 * `tiers`, backend-only stack, hasUiDoc=true).
 *
 * D28 — visualTier is now service-domain-only at the matrix level. The
 * runtime suppressors (backend stack / hasUiDoc) still apply on top, but
 * a game-domain RAC unconditionally fails the matrix check before any
 * runtime branch runs.
 */
import { describe, it, expect } from 'vitest';
import { isTierActive, pathsContainUiDoc, type BasisSlotConfig, type TechTierConfig } from '@ant/shared';

describe('isTierActive(visualTier)', () => {
  const yesSlot: BasisSlotConfig = { tiers: ['visualTier'] };
  const noSlot: BasisSlotConfig = { tiers: [] };
  const emptySlot: BasisSlotConfig = {};

  it('returns false when slot does not declare visualTier', () => {
    expect(isTierActive('visualTier', noSlot, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
    expect(isTierActive('visualTier', emptySlot, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
    expect(isTierActive('visualTier', undefined, 'service', { techTier: { stack: 'frontend' } })).toBe(false);
  });

  it('returns false for backend-only stack even when slot allows visualTier', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'backend' } as TechTierConfig })).toBe(false);
  });

  it('returns true for frontend and fullstack stacks (service domain)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(true);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'fullstack' } as TechTierConfig })).toBe(true);
  });

  it('returns true when techTier is undefined (stack not yet chosen, service domain)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: undefined })).toBe(true);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: {} })).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // hasUiDoc axis — UI design doc in RAC closes the gate.
  // ─────────────────────────────────────────────────────────────
  it('returns false when hasUiDoc=true regardless of stack (service domain)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig, hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'fullstack' } as TechTierConfig, hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'service', { hasUiDoc: true })).toBe(false);
  });

  it('returns true when hasUiDoc=false and other axes pass (service domain)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig, hasUiDoc: false })).toBe(true);
  });

  it('hasUiDoc=undefined behaves like false (gate open, service domain)', () => {
    expect(isTierActive('visualTier', yesSlot, 'service', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(true);
  });

  it('D28 — domain=game fails the matrix check unconditionally (visualTier is service-only)', () => {
    expect(isTierActive('visualTier', yesSlot, 'game', { techTier: { stack: 'frontend' } as TechTierConfig })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'game', { techTier: { stack: 'fullstack' } as TechTierConfig })).toBe(false);
    expect(isTierActive('visualTier', yesSlot, 'game', { hasUiDoc: false })).toBe(false);
  });
});

describe('pathsContainUiDoc', () => {
  it('returns false for empty / undefined input', () => {
    expect(pathsContainUiDoc(undefined)).toBe(false);
    expect(pathsContainUiDoc([])).toBe(false);
  });

  it('returns false for paths that are not UI artifacts', () => {
    expect(pathsContainUiDoc([
      'plan/prd.md',
      'architecture/spec/core.md',
      'architecture/system/fe-system-app.md',
    ])).toBe(false);
  });

  it('detects ant / figma / handoff UI docs', () => {
    expect(pathsContainUiDoc(['visual/ui/ant/ui-spec.json'])).toBe(true);
    expect(pathsContainUiDoc(['visual/ui/figma/figma.json'])).toBe(true);
    expect(pathsContainUiDoc(['visual/ui/handoff/overview.html'])).toBe(true);
  });

  it('returns true when any item in a mixed list is a UI doc', () => {
    expect(pathsContainUiDoc([
      'plan/prd.md',
      'visual/ui/handoff/overview.html',
    ])).toBe(true);
  });
});
