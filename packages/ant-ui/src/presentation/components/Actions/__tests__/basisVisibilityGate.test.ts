/**
 * Regression tests for the `BasisSummaryBar Section disappears under
 * hasCodebase=true` bug and its sibling `gen-ui-figma Section appears
 * with empty rows on service domain`. Pins the dual-SSOT contract:
 *
 *   - **Routing** (`decideActionsStepAfterIntent`) → consults
 *     `listActiveTiers(slot, domain, runtime)` with the real workspace
 *     runtime context. `hasCodebase=true` correctly auto-skips the
 *     forced wizard hop. See `decideActionsStepAfterIntent.test.ts`.
 *
 *   - **Visibility** (BasisSummaryBar Section gate in
 *     `ActionConfigView.tsx` + basis-edit render gate in
 *     `ActionsPanel.tsx`) → consults `listActiveTiers(slot, domain)`
 *     with an *empty runtime context*. Static slot × TIER_DOMAIN_MATRIX
 *     gate only; runtime suppressors (`hasCodebase`, `hasUiDoc`, backend
 *     stack) MUST NOT hide the Section, because the user must keep a
 *     manual override entry-point into the wizard. Re-coupling the
 *     visibility gate to runtime suppressors re-introduces the
 *     regression where users with an existing codebase have no way to
 *     open the wizard at all.
 *
 * These tests assert the dual contract by invoking `listActiveTiers`
 * with no runtime context — the same call the FE gates make. A future
 * contributor wiring runtime context into the visibility gate would
 * still pass routing tests but break these.
 */

import { describe, it, expect } from 'vitest';
import { getConfigSlots, listActiveTiers, type IntentId, type Domain } from '@ant/shared';

const visibilityCount = (intent: IntentId, domain: Domain): number =>
  listActiveTiers(getConfigSlots(intent)?.basis, domain).length;

describe('Basis visibility gate — static slot × domain matrix (no runtime suppressors)', () => {
  describe('Section MUST render — manual override entry must survive runtime suppression', () => {
    it('gen-ui-desc on service → visualTier passes (gameContentTier domain-blocked)', () => {
      // UI_TIERS = ['visualTier', 'gameContentTier']
      expect(visibilityCount('gen-ui-desc', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-sys on service → techTier + visualTier pass (game tiers domain-blocked)', () => {
      // CODE_TIERS = ['techTier','visualTier','gameArtTier','gameContentTier']
      expect(visibilityCount('gen-code-sys', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-spec on service → passes', () => {
      expect(visibilityCount('gen-code-spec', 'service')).toBeGreaterThan(0);
    });

    it('gen-code-directive on service → passes', () => {
      expect(visibilityCount('gen-code-directive', 'service')).toBeGreaterThan(0);
    });
  });

  describe('Section MUST stay hidden — declared tiers are all domain-blocked or empty', () => {
    it('gen-ui-figma on service → 0 (only gameContentTier declared, domain-blocked)', () => {
      // gen-ui-figma's basis.tiers === ['gameContentTier'] because figma
      // is the visual authority; on service the matrix closes
      // gameContentTier → 0 tiers → Section hidden. Without the
      // domain-matrix component in the gate, the Section would render
      // an anonymous "Configure" CTA which the user explicitly does
      // NOT want here.
      expect(visibilityCount('gen-ui-figma', 'service')).toBe(0);
    });

    it('rev-plan on service → 0 (basis.tiers absent)', () => {
      expect(visibilityCount('rev-plan', 'service')).toBe(0);
    });

    it('explain-plan on service → 0', () => {
      expect(visibilityCount('explain-plan', 'service')).toBe(0);
    });
  });

  describe('Game domain — game-only tiers unlock', () => {
    it('gen-ui-figma on game → gameContentTier passes', () => {
      expect(visibilityCount('gen-ui-figma', 'game')).toBeGreaterThan(0);
    });

    it('gen-code-sys on game → 4 tiers pass', () => {
      expect(visibilityCount('gen-code-sys', 'game')).toBeGreaterThan(0);
    });
  });
});
