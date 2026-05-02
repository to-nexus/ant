/**
 * Tier Matrix SSOT (Phase 2 — D12-revised + D22 + D23, I2)
 *
 * The matrix is the single authority for "is tier X active for slot Y in
 * domain Z under runtime R?". This test exercises the full grid:
 *
 *   - 4 tiers (`techTier` / `visualTier` / `gameArtTier` / `gameContentTier`)
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
  INTENT_DEFINITIONS,
  type IntentId,
  type Domain,
  type BasisSlotConfig,
  uiSourceOfPath,
  gameArtSourceOfPath,
} from '@ant/shared';

const ALL_DOMAINS: ReadonlyArray<Domain> = ['service', 'game'];

describe('TIER_KEYS — registry shape', () => {
  it('all 4 tiers are present (D23 removed `domain`)', () => {
    expect(TIER_KEYS).toEqual(['techTier', 'visualTier', 'gameArtTier', 'gameContentTier']);
  });
});

// `TIER_DOMAIN_MATRIX` row-shape assertions live in
// tests/policy/domain-surface-boundary.test.ts (the D28 SSOT).

describe('isTierActive — slot/domain/runtime composition', () => {
  it('returns false when slot is undefined', () => {
    for (const tier of TIER_KEYS) {
      for (const d of ALL_DOMAINS) {
        expect(isTierActive(tier, undefined, d)).toBe(false);
      }
    }
  });

  it('returns false when slot omits the tier even if matrix permits', () => {
    const slot: BasisSlotConfig = { tiers: ['gameContentTier'] };
    expect(isTierActive('techTier', slot, 'service')).toBe(false);
    expect(isTierActive('gameArtTier', slot, 'game')).toBe(false);
  });

  it('returns false when matrix forbids the (tier, domain) combo', () => {
    const slot: BasisSlotConfig = { tiers: ['gameArtTier', 'gameContentTier'] };
    expect(isTierActive('gameArtTier', slot, 'service')).toBe(false);
    expect(isTierActive('gameContentTier', slot, 'service')).toBe(false);
  });

  it('returns true when slot opts in AND matrix permits', () => {
    const slot: BasisSlotConfig = { tiers: ['gameArtTier', 'gameContentTier'] };
    expect(isTierActive('gameArtTier', slot, 'game')).toBe(true);
    expect(isTierActive('gameContentTier', slot, 'game')).toBe(true);
  });

  it('visualTier suppressor: backend-only stack closes the gate', () => {
    const slot: BasisSlotConfig = { tiers: ['visualTier'] };
    expect(isTierActive('visualTier', slot, 'service', { techTier: { stack: 'backend' } })).toBe(false);
    expect(isTierActive('visualTier', slot, 'service', { techTier: { stack: 'frontend' } })).toBe(true);
  });

  it('visualTier suppressor: hasUiDoc closes the gate', () => {
    const slot: BasisSlotConfig = { tiers: ['visualTier'] };
    expect(isTierActive('visualTier', slot, 'service', { hasUiDoc: true })).toBe(false);
    expect(isTierActive('visualTier', slot, 'service', { hasUiDoc: false })).toBe(true);
  });
});

describe('intent matrix (§4.1 SSOT-2 — Phase 2 D23)', () => {
  // Expected (tier, domain) cells per intent. After D23, `'domain'` is no
  // longer a TierKey — service-domain plan/spec wizards collapse because
  // gameContentTier is game-only (no other tiers), and the wizard is
  // hidden entirely. After the rev-overlay refactor, every `rev-*` intent
  // declares `tiers: []` because the document under review already encodes
  // every basis decision (exposing tier pickers would invite the user to
  // overwrite settings already encoded in the artifact).
  const expectations: Array<{ intent: IntentId; tiers: ReadonlyArray<TierKey> }> = [
    { intent: 'gen-plan', tiers: ['gameContentTier'] },
    { intent: 'rev-plan', tiers: [] },
    { intent: 'gen-spec', tiers: ['gameContentTier'] },
    { intent: 'rev-spec', tiers: [] },
    { intent: 'gen-sys-fe', tiers: ['techTier', 'gameContentTier'] },
    { intent: 'gen-sys-be', tiers: ['techTier', 'gameContentTier'] },
    { intent: 'gen-sys-full', tiers: ['techTier', 'gameContentTier'] },
    { intent: 'rev-sys', tiers: [] },
    // figma source is the visualTier authority — wizard tier intentionally
    // elided so the user is not forced to override what figma already
    // decides on action-tab entry.
    { intent: 'gen-ui-figma', tiers: ['gameContentTier'] },
    { intent: 'gen-ui-desc', tiers: ['visualTier', 'gameContentTier'] },
    { intent: 'rev-ui', tiers: [] },
    // Phase 2 (D17/D28) — game-art design intents. tiers omits visualTier (D18).
    // figma source is the gameArtTier authority — wizard tier elided
    // (mirrors `gen-ui-figma`).
    { intent: 'gen-game-art-figma', tiers: ['gameContentTier'] },
    { intent: 'gen-game-art-desc', tiers: ['gameArtTier', 'gameContentTier'] },
    { intent: 'rev-game-art', tiers: [] },
    { intent: 'gen-code-sys', tiers: ['techTier', 'visualTier', 'gameArtTier', 'gameContentTier'] },
    { intent: 'gen-code-spec', tiers: ['techTier', 'visualTier', 'gameArtTier', 'gameContentTier'] },
    { intent: 'gen-code-directive', tiers: ['techTier', 'visualTier', 'gameArtTier', 'gameContentTier'] },
    { intent: 'rev-code', tiers: [] },
  ];

  it.each(expectations)('intent $intent has tiers $tiers', ({ intent, tiers }) => {
    const slot = getConfigSlots(intent)?.basis;
    expect(slot).toBeDefined();
    expect(new Set(slot!.tiers ?? [])).toEqual(new Set(tiers));
  });

  it('service-domain plan/spec wizards collapse (D23 effect)', () => {
    // PLAN_TIERS / SPEC_TIERS = [gameContentTier], which is game-only.
    // Service domain therefore has zero active tiers → wizard hides.
    for (const intent of ['gen-plan', 'rev-plan', 'gen-spec', 'rev-spec'] as const) {
      const slot = getConfigSlots(intent)?.basis;
      const activeForService = TIER_KEYS.filter(t =>
        isTierActive(t, slot, 'service', {}),
      );
      expect(activeForService).toEqual([]);
    }
  });

  it('ask / explain / learn / visual intents are matrix-bypass', () => {
    const bypass: IntentId[] = [
      'ask-evaluate', 'ask-ant', 'ask-general',
      'explain-code', 'explain-ui', 'explain-sys', 'explain-spec', 'explain-plan', 'explain-visual',
      'explain-game-art',
      'gen-learn',
      'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration',
    ];
    for (const intent of bypass) {
      const slot = getConfigSlots(intent)?.basis;
      const tiers = slot?.tiers ?? [];
      expect(tiers.length).toBe(0);
    }
  });

  it('all rev-* intents expose zero configurable tiers', () => {
    const REV_INTENTS: IntentId[] = ['rev-plan', 'rev-sys', 'rev-ui', 'rev-game-art', 'rev-spec', 'rev-code'];
    for (const intent of REV_INTENTS) {
      const slot = getConfigSlots(intent)?.basis;
      expect(slot).toBeDefined();
      expect(slot!.tiers ?? []).toEqual([]);
    }
  });

  it('gen-sys-fe / gen-sys-be / gen-sys-full pin the stack via lockedStack', () => {
    expect(getConfigSlots('gen-sys-fe')?.basis?.lockedStack).toBe('frontend');
    expect(getConfigSlots('gen-sys-be')?.basis?.lockedStack).toBe('backend');
    expect(getConfigSlots('gen-sys-full')?.basis?.lockedStack).toBe('fullstack');
  });

  it('non-design-system intents do not declare lockedStack', () => {
    const NON_LOCKED: IntentId[] = [
      'gen-plan', 'rev-plan',
      'gen-spec', 'rev-spec',
      'rev-sys',
      'gen-ui-figma', 'gen-ui-desc', 'rev-ui',
      'gen-game-art-figma', 'gen-game-art-desc', 'rev-game-art',
      'gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code',
    ];
    for (const intent of NON_LOCKED) {
      const slot = getConfigSlots(intent)?.basis;
      if (slot) expect(slot.lockedStack).toBeUndefined();
    }
  });

  // Locked authority-source invariant.
  //
  // When an intent fixes a UI / game-art *authority* file as a locked ref
  // (e.g. `gen-ui-figma` / `gen-game-art-figma` with `figma.json` locked),
  // the source itself decides the matching tier. Surfacing that tier in
  // the wizard would force the user through a step whose answers the
  // authority source immediately overrides, and would race the FE
  // routing (`decideActionsStepAfterIntent` is called before the
  // auto-select effect in `ActionConfigView` populates `actionMetadata.refs`,
  // so the `hasUiDoc=true` runtime suppressor cannot fire in time —
  // see [tierRouting.ts](packages/ant-ui/src/application/hooks/features/tierRouting.ts)).
  //
  // SSOT for the authority-path classification: `uiSourceOfPath` /
  // `gameArtSourceOfPath` from canonical.ts.
  it('intents with a locked file ref to a UI / game-art authority path do not declare the matching tier', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      if (!slots) continue;
      const lockedAuthorityFiles = slots.refs.filter(
        (r) => r.locked && r.type === 'file' && r.path,
      );
      const tiers = slots.basis?.tiers ?? [];
      for (const r of lockedAuthorityFiles) {
        if (uiSourceOfPath(r.path)) {
          expect(tiers, `${def.id} locks ${r.path} (UI authority) but exposes visualTier`)
            .not.toContain('visualTier' as TierKey);
        }
        if (gameArtSourceOfPath(r.path)) {
          expect(tiers, `${def.id} locks ${r.path} (game-art authority) but exposes gameArtTier`)
            .not.toContain('gameArtTier' as TierKey);
        }
      }
    }
  });
});

// ============================================
// Full grid sweep — every (intent, domain, tier) cell exercised.
// Phase 2 grid: 4 tiers × 2 domains × ~20 intents ≈ 160+ assertions.
// ============================================

describe('full grid sweep (intent × domain × tier)', () => {
  const ARTIFACT_INTENTS: IntentId[] = [
    'gen-plan', 'rev-plan', 'gen-spec', 'rev-spec',
    'gen-sys-fe', 'gen-sys-be', 'gen-sys-full', 'rev-sys',
    'gen-ui-figma', 'gen-ui-desc', 'rev-ui',
    'gen-game-art-figma', 'gen-game-art-desc', 'rev-game-art',
    'gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code',
  ];

  for (const intent of ARTIFACT_INTENTS) {
    for (const domain of ALL_DOMAINS) {
      for (const tier of TIER_KEYS) {
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

  const NON_ARTIFACT_INTENTS: IntentId[] = [
    'ask-evaluate', 'ask-ant', 'ask-general',
    'explain-code', 'explain-ui', 'explain-sys', 'explain-spec', 'explain-plan', 'explain-visual',
    'explain-game-art',
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
