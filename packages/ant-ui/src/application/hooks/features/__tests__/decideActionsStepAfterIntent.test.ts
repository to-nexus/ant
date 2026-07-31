/**
 * Regression tests for the `IntentChipGrid → blank panel` bug.
 *
 * Background — the original `handleIntentSelect` routed on the static
 * `slot.tiers?.length > 0`, ignoring the domain × runtime matrix. For
 * intents with no live wizard tiers (e.g. `gen-plan`'s `PLAN_TIERS = []`,
 * or an intent whose remaining tiers the matrix / runtime suppressors
 * close) this routed the user to `basis-edit`, which then mounted a
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
  describe('plan intents expose no wizard tiers → config', () => {
    it('gen-plan (PLAN_TIERS = []) → config on service', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('config');
    });

    // gen-plan carries no wizard tiers in EITHER domain — genre/coreLoop now
    // live as free prose in the PRD, not a basis tier. So game domain routes
    // to config too (no wizard hop).
    it('gen-plan (PLAN_TIERS = []) → config on game', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'game' }))).toBe('config');
    });

    // gen-spec grounds in the existing codebase's stack, so its basis is
    // SYS_TIERS = ['techTier']. techTier is domain-universal and stays active
    // on greenfield → basis-edit (same shape as gen-sys-*).
    it('gen-spec (SYS_TIERS: techTier-grounded) → basis-edit on service greenfield', () => {
      const slot = getConfigSlots('gen-spec')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('basis-edit');
    });

    // …and once a codebase exists, techTier is suppressed too → config.
    it('gen-spec + service + hasCodebase=true → config (techTier suppressed)', () => {
      const slot = getConfigSlots('gen-spec')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), true)).toBe('config');
    });

    it('gen-spec → basis-edit on game (techTier active)', () => {
      const slot = getConfigSlots('gen-spec')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'game' }))).toBe('basis-edit');
    });
  });

  describe('runtime suppressors close visualTier even on service domain', () => {
    // gen-ui-desc's static tiers are ['visualTier']. Under service,
    // visualTier is live — but if the user already attached a UI design doc
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

    // Direct routing test for the figma intent: its static tiers are `[]`
    // (figma is the visual authority — no wizard step), so the chip click
    // MUST land on `config` — no wizard required. Pinning this prevents a
    // future revert of the matrix prune from re-introducing the wizard hop.
    it('gen-ui-figma on service (empty refs) → config (empty static tiers)', () => {
      const slot = getConfigSlots('gen-ui-figma')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('config');
    });
  });

  describe('basis already saved short-circuits to config', () => {
    it('gen-plan + game + saved basis → config (no re-edit on chip click)', () => {
      const slot = getConfigSlots('gen-plan')?.basis;
      const metadata = empty({
        domain: 'game',
        basis: { gameArtTier: { concept: 'flatVector' } } as any,
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
    // 'gameArtTier']. Under service the game-only gameArtTier drops, but
    // techTier + visualTier survive (no UI doc, no backend lock at
    // chip-click time), so basis-edit is correct.
    it('gen-code-sys on service with empty basis → basis-edit', () => {
      const slot = getConfigSlots('gen-code-sys')?.basis;
      expect(decideActionsStepAfterIntent(slot, empty({ domain: 'service' }))).toBe('basis-edit');
    });
  });
});

describe('existing codebase short-circuits every tier (D27 SSOT runtime suppressor)', () => {
  // Pin spec §4.1 / §4.2 — when `gitSnapshot.hasCodebase === true`, the
  // RUNTIME_SUPPRESSORS for ALL THREE tiers fire:
  //   - techTier: an existing codebase implicitly locks the stack.
  //   - visualTier: an existing codebase implicitly locks visual identity
  //     (CSS / design tokens / component library are already chosen by
  //     the code on disk); re-prompting via BasisWizard would overwrite
  //     the user's existing visual choices.
  //   - gameArtTier: the game-domain counterpart of visualTier (D28
  //     vertical split) — existing sprites / palette fix the art direction
  //     and the scene base class fixes the 2d/3d render dimension.
  //
  // Whatever the domain, a code intent whose static tiers are
  // ['techTier','visualTier','gameArtTier'] (gen-code-sys / gen-code-spec /
  // gen-code-directive) ends with zero active tiers on an existing codebase
  // — the matrix closes the wrong-domain tier and hasCodebase closes the
  // rest — so the chip MUST route to `config`. Pinning every intent × domain
  // prevents a future revert of any one suppressor from silently
  // re-introducing the wizard hop.

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

  // gameArtTier is the game domain's counterpart of visualTier (D28 vertical
  // split), so it takes the same hasCodebase treatment: an existing game
  // codebase already fixes the art direction AND the render dimension.
  // This previously asserted 'basis-edit' — the asymmetry that made a game
  // project with existing code skip techTier but still land on the game-art
  // picker (polyhedron / feature/base repro).
  it('gen-code-sys + game + hasCodebase=true → config (gameArtTier suppressed too)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'game' }), true),
    ).toBe('config');
  });

  it('gen-code-directive + game + hasCodebase=true → config', () => {
    const slot = getConfigSlots('gen-code-directive')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'game' }), true),
    ).toBe('config');
  });

  it('gen-code-sys + game + hasCodebase=false → basis-edit (greenfield game unaffected)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'game' }), false),
    ).toBe('basis-edit');
  });

  it('gen-code-sys + service + hasCodebase=false → basis-edit (greenfield unaffected)', () => {
    const slot = getConfigSlots('gen-code-sys')?.basis;
    expect(
      decideActionsStepAfterIntent(slot, empty({ domain: 'service' }), false),
    ).toBe('basis-edit');
  });
});
