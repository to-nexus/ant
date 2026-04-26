/**
 * Domain Gate (Phase 2 — D22)
 *
 * The workspace-level project domain (`actionMetadata.domain` →
 * `WorkspaceConfig.domain`) gates which Action cards / mention-menu
 * intents are visible. The matrix gate
 * (`TIER_DOMAIN_MATRIX.gameArtTier=['game']`) is still the deeper
 * authority for tier activation, but this layer keeps the user-facing
 * affordances (cards, mentions) consistent without requiring callers
 * to reproduce the matrix logic.
 *
 * Invariant: `design-art` is the only domain-gated card today.
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
  it('design-art is gated to game domain only (D22 + matrix mirror)', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-art');
    expect(def).toBeDefined();
    expect(def!.domainGate).toEqual(['game']);
    // The domainGate row MUST mirror the matrix gate so we can never
    // ship a card whose card-level visibility contradicts its tier
    // visibility.
    expect(def!.domainGate).toEqual(TIER_DOMAIN_MATRIX.gameArtTier);
  });

  it('every other action card is domain-agnostic (no surprise gates)', () => {
    for (const def of ACTION_DEFINITIONS) {
      if (def.id === 'design-art') continue;
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

  it('design-art is hidden on service / undefined (default seed) and visible on game', () => {
    const artDef = ACTION_DEFINITIONS.find(d => d.id === 'design-art')!;
    expect(isActionVisibleForDomain(artDef, 'service')).toBe(false);
    expect(isActionVisibleForDomain(artDef, undefined)).toBe(false); // defaults to 'service'
    expect(isActionVisibleForDomain(artDef, 'game')).toBe(true);
  });

  it('mention-menu mirrors the same gate (intentGroup → action def)', () => {
    // Pick a representative gated intent and ensure its group's gate is
    // honored when filtering INTENT_DEFINITIONS for the @intent: mention.
    const gameOnly: ReadonlyArray<string> = ['gen-art-figma', 'gen-art-desc', 'rev-art', 'explain-art'];
    for (const intentId of gameOnly) {
      const intent = INTENT_DEFINITIONS.find(d => d.id === intentId);
      expect(intent).toBeDefined();
      const def = ACTION_DEFINITIONS.find(d => d.id === intent!.intentGroup);
      expect(def).toBeDefined();
      expect(isActionVisibleForDomain(def!, 'service')).toBe(false);
      expect(isActionVisibleForDomain(def!, 'game')).toBe(true);
    }
  });
});
