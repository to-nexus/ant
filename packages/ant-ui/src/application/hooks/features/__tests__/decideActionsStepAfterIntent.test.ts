/**
 * Regression tests for the `IntentChipGrid → blank panel` bug.
 *
 * Background — the original `handleIntentSelect` routed on the static
 * `slot.tiers?.length > 0`, ignoring the domain × runtime matrix. For
 * intents whose static tiers are all closed by the matrix (e.g.
 * `gen-plan`'s `PLAN_TIERS = ['gameContentTier']` under the `service`
 * domain) this routed the user to `basis-edit`, which then mounted a
 * `BasisWizard` whose `availableTiers === []` triggered its defensive
 * `!currentStep → return null` guard, leaving the entire panel blank.
 *
 * The fix funnels both the handler and the `basis-edit` render guard
 * through `decideActionsStepAfterIntent`, which calls the SSOT
 * (`listActiveTiers`) and routes to `'config'` whenever no tier is
 * actually live. These tests pin that behaviour for every "all tiers
 * closed by matrix" combination we know about so a future static-only
 * shortcut cannot reintroduce the regression.
 */

import { describe, it, expect } from 'vitest';
import { getConfigSlots, type ActionMetadata } from '@ant/shared';
// Importing from the sibling pure-helper module avoids pulling in
// `useStore` (and its SSE / window-bound transitive imports), keeping
// these tests runnable under vitest's default node environment.
import { decideActionsStepAfterIntent } from '../tierRouting';

const empty = (overrides: Partial<ActionMetadata> = {}): ActionMetadata => ({
  domain: 'service',
  ...overrides,
});

describe('decideActionsStepAfterIntent — D27 SSOT routing', () => {
  describe('service domain — game-only tiers collapse to config', () => {
    it('gen-plan (PLAN_TIERS = gameContentTier) → config', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('config');
    });

    it('gen-spec (PLAN_TIERS = gameContentTier) → config', () => {
      const slot = getConfigSlots('gen-spec')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('config');
    });
  });

  describe('game domain — same intents now route to basis-edit', () => {
    it('gen-plan → basis-edit', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'game' }))).toBe('basis-edit');
    });

    it('gen-spec → basis-edit', () => {
      const slot = getConfigSlots('gen-spec')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'game' }))).toBe('basis-edit');
    });
  });

  describe('runtime suppressors close visualTier even on service domain', () => {
    // gen-ui-figma's static tiers are ['visualTier', 'gameContentTier'].
    // Under service: gameContentTier is closed by the matrix, leaving
    // visualTier — but if the user already attached a UI design doc
    // (handoff/ant/figma) to refs, visualTier suppresses too, leaving
    // zero active tiers.
    it('gen-ui-figma with hasUiDoc-equivalent ref → config', () => {
      const slot = getConfigSlots('gen-ui-figma')?.basis;
      const metadata = empty({
        domain: 'service',
        refs: ['outputs/design/ui/handoff/spec.md'],
      });
      expect(decideActionsStepAfterIntent(slot, metadata)).toBe('config');
    });
  });

  describe('basis already saved short-circuits to config', () => {
    it('gen-plan + game + saved basis → config (no re-edit on chip click)', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      const metadata = empty({
        domain: 'game',
        basis: { gameContentTier: { genre: 'puzzle', coreLoop: 'solve' } } as any,
      });
      expect(decideActionsStepAfterIntent(slot, metadata)).toBe('config');
    });
  });

  describe('intents without basis tiers always route to config', () => {
    it('rev-plan (no basis key) → config', () => {
      const slot = getConfigSlots('rev-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty())).toBe('config');
    });

    it('explain-plan (no basis key) → config', () => {
      const slot = getConfigSlots('explain-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty())).toBe('config');
    });
  });

  describe('code intents with multiple tiers — at least one stays active on service', () => {
    // gen-code-sys's static tiers are ['techTier', 'visualTier',
    // 'gameArtTier', 'gameContentTier']. Under service the game-only
    // pair drops, but techTier + visualTier survive (no UI doc, no
    // backend lock at chip-click time), so basis-edit is correct.
    it('gen-code-sys on service with empty basis → basis-edit', () => {
      const slot = getConfigSlots('gen-code-sys')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('basis-edit');
    });
  });
});
