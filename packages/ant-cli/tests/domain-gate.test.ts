/**
 * Domain Gate (Phase 2 — D22 / D28)
 *
 * The workspace-level project domain (`actionMetadata.domain` →
 * `WorkspaceConfig.domain`) gates which Action cards / mention-menu
 * intents are visible. The matrix gates
 * (`TIER_DOMAIN_MATRIX.gameArtTier=['game']`,
 *  `TIER_DOMAIN_MATRIX.visualTier=['service']`) are the deeper authority
 * for tier activation, but this layer keeps the user-facing affordances
 * (cards, mentions) consistent without requiring callers to reproduce
 * the matrix logic.
 *
 * Invariants (D28 — vertical domain split):
 *   - `design-game-art` card is gated to `['game']`
 *   - `design-ui` card is gated to `['service']`
 *   - All other cards are domain-agnostic
 */

import { describe, it, expect } from 'vitest';
import {
  ACTION_DEFINITIONS,
  INTENT_DEFINITIONS,
  isActionVisibleForDomain,
  TIER_DOMAIN_MATRIX,
  type Domain,
} from '@ant/shared';

describe('ActionDefinition.domainGate', () => {
  it('design-game-art is gated to game domain only (D22 + matrix mirror)', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art');
    expect(def).toBeDefined();
    expect(def!.domainGate).toEqual(['game']);
    // The domainGate row MUST mirror the matrix gate so we can never
    // ship a card whose card-level visibility contradicts its tier
    // visibility.
    expect(def!.domainGate).toEqual(TIER_DOMAIN_MATRIX.gameArtTier);
  });

  it('design-ui is gated to service domain only (D28 + matrix mirror)', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-ui');
    expect(def).toBeDefined();
    expect(def!.domainGate).toEqual(['service']);
    expect(def!.domainGate).toEqual(TIER_DOMAIN_MATRIX.visualTier);
  });

  it('every other action card is domain-agnostic (no surprise gates)', () => {
    const GATED = new Set(['design-game-art', 'design-ui']);
    for (const def of ACTION_DEFINITIONS) {
      if (GATED.has(def.id)) continue;
      expect(def.domainGate).toBeUndefined();
    }
  });
});

describe('isActionVisibleForDomain', () => {
  const ALL: ReadonlyArray<Domain | undefined> = ['service', 'game', undefined];

  it('domain-agnostic cards are always visible', () => {
    const planDef = ACTION_DEFINITIONS.find(d => d.id === 'plan')!;
    for (const d of ALL) expect(isActionVisibleForDomain(planDef, d)).toBe(true);
  });

  it('design-game-art is hidden on service / undefined (default seed) and visible on game', () => {
    const artDef = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art')!;
    expect(isActionVisibleForDomain(artDef, 'service')).toBe(false);
    expect(isActionVisibleForDomain(artDef, undefined)).toBe(false); // defaults to 'service'
    expect(isActionVisibleForDomain(artDef, 'game')).toBe(true);
  });

  it('design-ui is visible on service / undefined and hidden on game (D28)', () => {
    const uiDef = ACTION_DEFINITIONS.find(d => d.id === 'design-ui')!;
    expect(isActionVisibleForDomain(uiDef, 'service')).toBe(true);
    expect(isActionVisibleForDomain(uiDef, undefined)).toBe(true); // defaults to 'service'
    expect(isActionVisibleForDomain(uiDef, 'game')).toBe(false);
  });

  it('mention-menu mirrors the same gate (intentGroup → action def) — game-art', () => {
    // Pick a representative gated intent and ensure its group's gate is
    // honored when filtering INTENT_DEFINITIONS for the @intent: mention.
    const gameOnly: ReadonlyArray<string> = ['gen-game-art-figma', 'gen-game-art-desc', 'rev-game-art', 'explain-game-art'];
    for (const intentId of gameOnly) {
      const intent = INTENT_DEFINITIONS.find(d => d.id === intentId);
      expect(intent).toBeDefined();
      const def = ACTION_DEFINITIONS.find(d => d.id === intent!.intentGroup);
      expect(def).toBeDefined();
      expect(isActionVisibleForDomain(def!, 'service')).toBe(false);
      expect(isActionVisibleForDomain(def!, 'game')).toBe(true);
    }
  });

  it('mention-menu mirrors the same gate (intentGroup → action def) — UI design', () => {
    const serviceOnly: ReadonlyArray<string> = ['gen-ui-figma', 'gen-ui-desc', 'rev-ui', 'explain-ui'];
    for (const intentId of serviceOnly) {
      const intent = INTENT_DEFINITIONS.find(d => d.id === intentId);
      expect(intent).toBeDefined();
      const def = ACTION_DEFINITIONS.find(d => d.id === intent!.intentGroup);
      expect(def).toBeDefined();
      expect(isActionVisibleForDomain(def!, 'service')).toBe(true);
      expect(isActionVisibleForDomain(def!, 'game')).toBe(false);
    }
  });
});
