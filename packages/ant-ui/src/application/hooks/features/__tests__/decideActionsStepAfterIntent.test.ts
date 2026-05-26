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
    // gen-ui-desc's static tiers are ['visualTier', 'gameContentTier'].
    // Under service: gameContentTier is closed by the matrix, leaving
    // visualTier — but if the user already attached a UI design doc
    // (handoff/ant/figma) to refs, visualTier suppresses too, leaving
    // zero active tiers.
    //
    // (`gen-ui-figma` was the original gen-ui pick here, but its static
    // `basis.tiers` was pruned to drop visualTier — figma source is the
    // visual authority, so the wizard step would be a no-op. With
    // visualTier no longer in the static set the suppressor is never
    // exercised for that intent. `gen-ui-desc` is the natural successor
    // because it still opts into visualTier statically.)
    it('gen-ui-desc with hasUiDoc-equivalent ref → config', () => {
      const slot = getConfigSlots('gen-ui-desc')?.basis;
      const metadata = empty({
        domain: 'service',
        refs: ['visual/ui/handoff/spec.md'],
      });
      expect(decideActionsStepAfterIntent(slot, metadata)).toBe('config');
    });

    // Direct routing test for the figma intent: with visualTier elided
    // from static tiers and gameContentTier closed by the service-domain
    // matrix, the chip click MUST land on `config` — no wizard required.
    // Pinning this prevents a future revert of the matrix prune from
    // silently re-introducing the wizard hop on chip click.
    it('gen-ui-figma on service (empty refs) → config (static tier prune)', () => {
      const slot = getConfigSlots('gen-ui-figma')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('config');
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

describe('existing codebase short-circuits techTier AND visualTier (D27 SSOT runtime suppressor)', () => {
  // Pin spec §4.1 / §4.2 — when `gitSnapshot.hasCodebase === true`, the
  // RUNTIME_SUPPRESSORS for BOTH `techTier` AND `visualTier` fire:
  //   - techTier: an existing codebase implicitly locks the stack.
  //   - visualTier: an existing codebase implicitly locks visual identity
  //     (CSS / design tokens / component library are already chosen by
  //     the code on disk); re-prompting via BasisWizard would overwrite
  //     the user's existing visual choices.
  //
  // For service-domain code intents whose static tiers are
  // ['techTier','visualTier','gameArtTier','gameContentTier']
  // (gen-code-sys / gen-code-spec / gen-code-directive), the service
  // matrix already closes gameArtTier + gameContentTier, and hasCodebase
  // now closes techTier + visualTier — so zero tiers stay active and the
  // chip MUST route to `config`. Pinning all three intents prevents a
  // future revert of the visualTier suppressor from silently re-introducing
  // the wizard hop for any of them.

  it('gen-code-sys + service + empty basis + hasCodebase=true → config (both techTier and visualTier suppressed)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), true),
    ).toBe('config');
  });

  it('gen-code-spec + service + empty basis + hasCodebase=true → config', () => {
    const slot = getConfigSlots('gen-code-spec')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), true),
    ).toBe('config');
  });

  it('gen-code-directive + service + empty basis + hasCodebase=true → config', () => {
    const slot = getConfigSlots('gen-code-directive')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), true),
    ).toBe('config');
  });

  it('gen-sys-fe + service + hasCodebase=true → config', () => {
    const slot = getConfigSlots('gen-sys-fe')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), true),
    ).toBe('config');
  });

  it('gen-code-sys + game + hasCodebase=true → basis-edit (gameArtTier/gameContentTier remain active)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'game' }), true),
    ).toBe('basis-edit');
  });

  it('gen-code-sys + service + hasCodebase=false → basis-edit (greenfield unaffected)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), false),
    ).toBe('basis-edit');
  });
});
