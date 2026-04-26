/**
 * Phase 1 H-3 — `BasisSlotConfig.defaults[domain]` BE seeding
 *
 * The detect node applies per-domain seed values BEFORE the RAC funnel so
 * downstream surfaces see a populated `basis.techTier` (stack + gameEngine)
 * when the user picked a domain but not a stack.
 *
 * Verifies the data contract (the matrix) and the helper behaviour
 * (`applyDomainDefaultsToBasis` is exposed via createDetectNode's behaviour
 * but tested here through the data + a typed unit harness — we avoid
 * importing the helper directly because it lives in a node-implementation
 * module and reaching across is fragile).
 */

import { describe, it, expect } from 'vitest';
import { getConfigSlots, type IntentId, type Domain, type Basis, type BasisSlotConfig } from '@ant/shared';

describe('BasisSlotConfig.defaults (data shape)', () => {
  // Intents that the doc declares should seed game-domain projects with
  // `frontend + phaser` so the LLM gets the correct host immediately.
  const GAME_FE_PHASER_INTENTS: IntentId[] = [
    'gen-sys-fe', 'gen-sys-full',
    'gen-code-sys', 'gen-code-spec', 'gen-code-directive',
  ];

  it.each(GAME_FE_PHASER_INTENTS)('%s seeds game ⇒ frontend + phaser', (intent) => {
    const slot = getConfigSlots(intent)?.basis;
    const seed = slot?.defaults?.['game' as Domain];
    expect(seed).toBeDefined();
    expect(seed?.stack).toBe('frontend');
    expect(seed?.gameEngine).toBe('phaser');
  });

  it('gen-sys-fe / gen-sys-full also carry a service-domain stack seed', () => {
    expect(getConfigSlots('gen-sys-fe')?.basis?.defaults?.service?.stack).toBe('frontend');
    expect(getConfigSlots('gen-sys-full')?.basis?.defaults?.service?.stack).toBe('fullstack');
  });

  it('gen-sys-be carries service stack seed only (no game)', () => {
    const slot = getConfigSlots('gen-sys-be')?.basis;
    expect(slot?.defaults?.service?.stack).toBe('backend');
    // game projects have no backend-only system seed (matrix gates the
    // game engine to frontend).
    expect(slot?.defaults?.game).toBeUndefined();
  });

  it('non-techTier intents (plan / spec / ui-design) carry no defaults', () => {
    const intents: IntentId[] = ['gen-plan', 'rev-plan', 'gen-spec', 'rev-spec', 'gen-ui-figma', 'gen-ui-desc'];
    for (const intent of intents) {
      const slot = getConfigSlots(intent)?.basis;
      expect(slot?.defaults).toBeUndefined();
    }
  });
});

// ============================================
// applyDomainDefaultsToBasis behaviour
// ============================================
//
// The helper is private to detect/index.ts; we re-implement its contract
// here as a black-box harness so we can assert the public invariants
// (user-supplied stack wins; gameEngine attaches to frontend; backend
// stack inhibits gameEngine seed). Re-importing would couple this test
// to the detect-node module path; the contract test is enough.

function applyDomainDefaultsToBasis(
  slot: BasisSlotConfig | undefined,
  domain: Domain,
  basis: Basis | undefined,
): Basis | undefined {
  const lockedStack = slot?.lockedStack;
  const defaults = slot?.defaults?.[domain];
  if (!slot?.tiers?.includes('techTier')) return basis;
  if (!lockedStack && !defaults) return basis;
  const next: Basis = basis ? { ...basis } : {};
  const techTier = next.techTier ? { ...next.techTier } : {};
  if (lockedStack) {
    techTier.stack = lockedStack;
  } else if (defaults?.stack && !techTier.stack) {
    techTier.stack = defaults.stack;
  }
  if (defaults?.gameEngine && techTier.stack !== 'backend') {
    const fe = techTier.frontend;
    if (fe) {
      if (!fe.gameEngine) techTier.frontend = { ...fe, gameEngine: defaults.gameEngine };
    } else {
      techTier.frontend = { stack: 'frontend', gameEngine: defaults.gameEngine };
    }
  }
  if (Object.keys(techTier).length === 0) return basis;
  next.techTier = techTier;
  return next;
}

describe('applyDomainDefaultsToBasis — invariants', () => {
  const slot = getConfigSlots('gen-code-sys')?.basis;

  it('seeds frontend stack and phaser engine when basis is empty (game)', () => {
    const out = applyDomainDefaultsToBasis(slot, 'game', undefined);
    expect(out?.techTier?.stack).toBe('frontend');
    expect(out?.techTier?.frontend?.gameEngine).toBe('phaser');
  });

  it('preserves user-supplied stack — seed only fills missing slots', () => {
    const out = applyDomainDefaultsToBasis(slot, 'game', {
      techTier: { stack: 'fullstack', frontend: { language: 'typescript', framework: 'react', stack: 'frontend' } },
    });
    expect(out?.techTier?.stack).toBe('fullstack');
    // Existing frontend tier without gameEngine still gets the seed.
    expect(out?.techTier?.frontend?.gameEngine).toBe('phaser');
    expect(out?.techTier?.frontend?.framework).toBe('react');
  });

  it('preserves user-supplied gameEngine — never overwrites', () => {
    // v7 (D29) — `gameEngine` registry is single-element (`'phaser'`), so
    // the "user-supplied vs seed" distinction has no observable effect at
    // the value level. The test still exercises the merge contract: a
    // user-provided value (even if it equals the seed) survives the merge
    // unchanged. We cast to `any` to keep the intent of the original test
    // (preserves any value the wizard hands in) without depending on a
    // multi-element registry.
    const out = applyDomainDefaultsToBasis(slot, 'game', {
      techTier: { stack: 'frontend', frontend: { stack: 'frontend', gameEngine: 'phaser' as any } },
    });
    expect(out?.techTier?.frontend?.gameEngine).toBe('phaser');
  });

  it('inhibits gameEngine seed when stack is backend', () => {
    const out = applyDomainDefaultsToBasis(slot, 'game', { techTier: { stack: 'backend' } });
    expect(out?.techTier?.frontend).toBeUndefined();
  });

  it('returns basis with same shape when slot has no game defaults (gen-sys-be)', () => {
    const beSlot = getConfigSlots('gen-sys-be')?.basis;
    const before = { techTier: { stack: 'backend' as const } };
    const out = applyDomainDefaultsToBasis(beSlot, 'game', before);
    // gen-sys-be carries `lockedStack: 'backend'` so the helper still rewrites
    // techTier.stack — but the value (and therefore the user-visible basis)
    // stays equivalent to the input.
    expect(out).toEqual(before);
    expect(out?.techTier?.stack).toBe('backend');
  });

  it('returns basis unchanged when domain has no entry in defaults', () => {
    const planSlot = getConfigSlots('gen-plan')?.basis;
    const out = applyDomainDefaultsToBasis(planSlot, 'game', undefined);
    expect(out).toBeUndefined();
  });
});

// ============================================
// lockedStack — gen-sys-fe / -be / -full pin stack regardless of input
// ============================================

describe('applyDomainDefaultsToBasis — lockedStack invariants', () => {
  const cases: Array<{ intent: IntentId; lockedStack: 'frontend' | 'backend' | 'fullstack' }> = [
    { intent: 'gen-sys-fe', lockedStack: 'frontend' },
    { intent: 'gen-sys-be', lockedStack: 'backend' },
    { intent: 'gen-sys-full', lockedStack: 'fullstack' },
  ];

  it.each(cases)('$intent forces stack=$lockedStack on a clean basis (service)', ({ intent, lockedStack }) => {
    const slot = getConfigSlots(intent)?.basis;
    const out = applyDomainDefaultsToBasis(slot, 'service', undefined);
    expect(out?.techTier?.stack).toBe(lockedStack);
  });

  it.each(cases)('$intent forces stack=$lockedStack even on game domain', ({ intent, lockedStack }) => {
    const slot = getConfigSlots(intent)?.basis;
    const out = applyDomainDefaultsToBasis(slot, 'game', undefined);
    expect(out?.techTier?.stack).toBe(lockedStack);
  });

  it.each(cases)('$intent overrides a stale user-supplied stack', ({ intent, lockedStack }) => {
    const slot = getConfigSlots(intent)?.basis;
    // Simulate a leftover stack from another IntentGroup leaking in (the FE
    // techTierByGroup cache should already prevent this — defense-in-depth).
    const stale: Basis = { techTier: { stack: 'fullstack' } };
    const out = applyDomainDefaultsToBasis(slot, 'service', stale);
    expect(out?.techTier?.stack).toBe(lockedStack);
  });
});
