/**
 * Tier Matrix SSOT (Phase 1, I2)
 *
 * The matrix is the single authority for "is tier X active for slot Y in
 * domain Z under runtime R?". This test exercises the full grid:
 *
 *   - 5 tiers (`domain` / `techTier` / `visualTier` / `artTier` / `gameContentTier`)
 *   - 2 domains (`service` / `game`)
 *   - representative slot configs from `getConfigSlots`
 *   - runtime suppression scenarios for `visualTier`
 *
 * The intent matrix is asserted against the table in §4.1 of the handoff
 * doc — divergence must be traceable to a deliberate matrix edit.
 */

import { describe, it, expect } from 'vitest';
import {
  isTierActive,
  TIER_DOMAIN_MATRIX,
  TIER_KEYS,
  type TierKey,
  getConfigSlots,
  type IntentId,
  type Domain,
  type BasisSlotConfig,
} from '@ant/shared';

const ALL_DOMAINS: ReadonlyArray<Domain> = ['service', 'game'];

describe('TIER_DOMAIN_MATRIX', () => {
  it('all 5 tiers are present', () => {
    expect(TIER_KEYS).toEqual(['domain', 'techTier', 'visualTier', 'artTier', 'gameContentTier']);
  });

  it('domain / techTier / visualTier are domain-universal', () => {
    expect(TIER_DOMAIN_MATRIX.domain).toEqual(expect.arrayContaining(['service', 'game']));
    expect(TIER_DOMAIN_MATRIX.techTier).toEqual(expect.arrayContaining(['service', 'game']));
    expect(TIER_DOMAIN_MATRIX.visualTier).toEqual(expect.arrayContaining(['service', 'game']));
  });

  it('artTier and gameContentTier are game-only in Phase 1', () => {
    expect(TIER_DOMAIN_MATRIX.artTier).toEqual(['game']);
    expect(TIER_DOMAIN_MATRIX.gameContentTier).toEqual(['game']);
  });
});

describe('isTierActive — slot/domain/runtime composition', () => {
  it('returns false when slot is undefined', () => {
    for (const tier of TIER_KEYS) {
      for (const d of ALL_DOMAINS) {
        expect(isTierActive(tier, undefined, d)).toBe(false);
      }
    }
  });

  it('returns false when slot omits the tier even if matrix permits', () => {
    const slot: BasisSlotConfig = { tiers: ['domain'] };
    expect(isTierActive('techTier', slot, 'service')).toBe(false);
    expect(isTierActive('artTier', slot, 'game')).toBe(false);
  });

  it('returns false when matrix forbids the (tier, domain) combo', () => {
    const slot: BasisSlotConfig = { tiers: ['domain', 'artTier', 'gameContentTier'] };
    expect(isTierActive('artTier', slot, 'service')).toBe(false);
    expect(isTierActive('gameContentTier', slot, 'service')).toBe(false);
  });

  it('returns true when slot opts in AND matrix permits', () => {
    const slot: BasisSlotConfig = { tiers: ['domain', 'artTier', 'gameContentTier'] };
    expect(isTierActive('artTier', slot, 'game')).toBe(true);
    expect(isTierActive('gameContentTier', slot, 'game')).toBe(true);
  });

  it('visualTier suppressor: backend-only stack closes the gate', () => {
    const slot: BasisSlotConfig = { tiers: ['domain', 'visualTier'] };
    expect(isTierActive('visualTier', slot, 'service', { techTier: { stack: 'backend' } })).toBe(false);
    expect(isTierActive('visualTier', slot, 'service', { techTier: { stack: 'frontend' } })).toBe(true);
  });

  it('visualTier suppressor: hasUiDoc closes the gate', () => {
    const slot: BasisSlotConfig = { tiers: ['domain', 'visualTier'] };
    expect(isTierActive('visualTier', slot, 'service', { hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', slot, 'service', { hasUiDoc: false })).toBe(true);
  });
});

describe('intent matrix (§4.1 SSOT-2)', () => {
  // Expected (tier, domain) cells per intent.
  const expectations: Array<{ intent: IntentId; tiers: ReadonlyArray<TierKey> }> = [
    { intent: 'gen-plan', tiers: ['domain', 'gameContentTier'] },
    { intent: 'rev-plan', tiers: ['domain', 'gameContentTier'] },
    { intent: 'gen-spec', tiers: ['domain', 'gameContentTier'] },
    { intent: 'rev-spec', tiers: ['domain', 'gameContentTier'] },
    { intent: 'gen-sys-fe', tiers: ['domain', 'techTier', 'gameContentTier'] },
    { intent: 'gen-sys-be', tiers: ['domain', 'techTier', 'gameContentTier'] },
    { intent: 'gen-sys-full', tiers: ['domain', 'techTier', 'gameContentTier'] },
    { intent: 'rev-sys', tiers: ['domain', 'techTier', 'gameContentTier'] },
    { intent: 'gen-ui-figma', tiers: ['domain', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'gen-ui-ref', tiers: ['domain', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'gen-ui-desc', tiers: ['domain', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'rev-ui', tiers: ['domain', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'gen-code-sys', tiers: ['domain', 'techTier', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'gen-code-spec', tiers: ['domain', 'techTier', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'gen-code-directive', tiers: ['domain', 'techTier', 'visualTier', 'artTier', 'gameContentTier'] },
    { intent: 'rev-code', tiers: ['domain', 'techTier', 'visualTier', 'artTier', 'gameContentTier'] },
  ];

  it.each(expectations)('intent $intent has tiers $tiers', ({ intent, tiers }) => {
    const slot = getConfigSlots(intent)?.basis;
    expect(slot).toBeDefined();
    expect(new Set(slot!.tiers ?? [])).toEqual(new Set(tiers));
  });

  it('ask / explain / learn / visual intents are matrix-bypass', () => {
    const bypass: IntentId[] = [
      'ask-evaluate', 'ask-ant', 'ask-general',
      'explain-code', 'explain-ui', 'explain-sys', 'explain-spec', 'explain-plan', 'explain-visual',
      'gen-learn',
      'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration',
    ];
    for (const intent of bypass) {
      const slot = getConfigSlots(intent)?.basis;
      const tiers = slot?.tiers ?? [];
      expect(tiers.length).toBe(0);
    }
  });
});

// ============================================
// Full grid sweep — every (intent, domain, tier) cell exercised.
// Required by handoff doc (Phase 1 §15.5):
//   "5 tier × 2 domain × ~16 intent ≈ 160+ assertion".
// ============================================

describe('full grid sweep (intent × domain × tier)', () => {
  // Artifact-producing intents that opt into at least one tier.
  const ARTIFACT_INTENTS: IntentId[] = [
    'gen-plan', 'rev-plan', 'gen-spec', 'rev-spec',
    'gen-sys-fe', 'gen-sys-be', 'gen-sys-full', 'rev-sys',
    'gen-ui-figma', 'gen-ui-ref', 'gen-ui-desc', 'rev-ui',
    'gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code',
  ];

  for (const intent of ARTIFACT_INTENTS) {
    for (const domain of ALL_DOMAINS) {
      for (const tier of TIER_KEYS) {
        // Expected: tier active iff slot opts in AND matrix permits the
        // (tier, domain) cell. Runtime suppression is exercised separately.
        const slot = getConfigSlots(intent)?.basis;
        const slotOptsIn = !!slot?.tiers?.includes(tier);
        const matrixPermits = TIER_DOMAIN_MATRIX[tier].includes(domain);
        const expected = slotOptsIn && matrixPermits;
        it(`${intent} × ${domain} × ${tier} → ${expected}`, () => {
          const actual = isTierActive(tier, slot, domain, {});
          expect(actual).toBe(expected);
        });
      }
    }
  }

  // Non-artifact intents (ask / explain / learn / visual) — every cell
  // must be inactive because the slots have no `basis.tiers`.
  const NON_ARTIFACT_INTENTS: IntentId[] = [
    'ask-evaluate', 'ask-ant', 'ask-general',
    'explain-code', 'explain-ui', 'explain-sys', 'explain-spec', 'explain-plan', 'explain-visual',
    'gen-learn',
    'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration',
  ];
  for (const intent of NON_ARTIFACT_INTENTS) {
    for (const domain of ALL_DOMAINS) {
      for (const tier of TIER_KEYS) {
        it(`${intent} × ${domain} × ${tier} → false (non-artifact intent)`, () => {
          const slot = getConfigSlots(intent)?.basis;
          expect(isTierActive(tier, slot, domain, {})).toBe(false);
        });
      }
    }
  }
});
