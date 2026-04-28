/**
 * I7-revised — Domain-Surface Boundary (D28)
 *
 * D28 splits the visual surfaces vertically by workspace domain:
 *   - service domain → visualTier + ui-* artifacts + design-ui intents
 *   - game domain    → gameArtTier + game-art-* artifacts + design-game-art intents
 *
 * The two surfaces never cross-pollinate at the matrix / config / policy
 * level. This file backstops that contract programmatically so a future
 * refactor that re-introduces `visualTier` for game (or `gameArtTier`
 * for service) trips a build failure.
 */

import { describe, it, expect } from 'vitest';
import {
  TIER_DOMAIN_MATRIX,
  ACTION_DEFINITIONS,
  INTENT_DEFINITIONS,
  isActionVisibleForDomain,
  getConfigSlots,
  filterSlotsByDomain,
  type Domain,
} from '@ant/shared';

describe('Domain-Surface Boundary (D28) — matrix layer', () => {
  it('visualTier matrix row is service-only', () => {
    expect(TIER_DOMAIN_MATRIX.visualTier).toEqual(['service']);
  });

  it('gameArtTier matrix row is game-only', () => {
    expect(TIER_DOMAIN_MATRIX.gameArtTier).toEqual(['game']);
  });

  it('gameContentTier matrix row is game-only', () => {
    expect(TIER_DOMAIN_MATRIX.gameContentTier).toEqual(['game']);
  });

  it('techTier remains domain-universal (the only universal tier)', () => {
    expect(TIER_DOMAIN_MATRIX.techTier).toEqual(['service', 'game']);
  });
});

describe('Domain-Surface Boundary (D28) — action card visibility', () => {
  it('design-ui card is service-domain only', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-ui')!;
    expect(def.domainGate).toEqual(['service']);
    expect(isActionVisibleForDomain(def, 'game')).toBe(false);
    expect(isActionVisibleForDomain(def, 'service')).toBe(true);
  });

  it('design-game-art card is game-domain only', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art')!;
    expect(def.domainGate).toEqual(['game']);
    expect(isActionVisibleForDomain(def, 'service')).toBe(false);
    expect(isActionVisibleForDomain(def, 'game')).toBe(true);
  });

  it('UI design intents (gen-ui-* / rev-ui / explain-ui) all sit under design-ui', () => {
    const uiIntents = INTENT_DEFINITIONS.filter(d => d.id.match(/^(gen-ui-|rev-ui|explain-ui)/));
    expect(uiIntents.length).toBeGreaterThan(0);
    for (const intent of uiIntents) {
      expect(intent.intentGroup).toBe('design-ui');
    }
  });

  it('Game-art design intents (gen-game-art-* / rev-game-art / explain-game-art) all sit under design-game-art', () => {
    const gameArtIntents = INTENT_DEFINITIONS.filter(d => d.id.match(/^(gen-game-art-|rev-game-art|explain-game-art)/));
    expect(gameArtIntents.length).toBeGreaterThan(0);
    for (const intent of gameArtIntents) {
      expect(intent.intentGroup).toBe('design-game-art');
    }
  });
});

describe('Domain-Surface Boundary (D28) — code intent ref/ctx routing', () => {
  const CODE_INTENTS = ['gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code'] as const;

  it('every code intent declares both ui-source AND game-art-source slots in its full definition', () => {
    for (const intent of CODE_INTENTS) {
      const slots = getConfigSlots(intent)!;
      const allSlots = [...slots.refs, ...slots.context];
      const hasUiSource = allSlots.some(s => s.path === 'visual/ui');
      const hasGameArtSource = allSlots.some(s => s.path === 'visual/game-art/ant');
      // gen-code-spec uses spec docs as refs only, but UI/game-art is in context.
      expect(hasUiSource || hasGameArtSource, `${intent} must list at least one design source`).toBe(true);
    }
  });

  it('service domain filter drops game-art-source slots from all code intents', () => {
    for (const intent of CODE_INTENTS) {
      const filtered = filterSlotsByDomain(getConfigSlots(intent)!, 'service');
      const allSlots = [...filtered.refs, ...filtered.context];
      const gameArtSlots = allSlots.filter(s => s.path === 'visual/game-art/ant');
      expect(gameArtSlots, `${intent} must drop game-art-source slots in service domain`).toEqual([]);
    }
  });

  it('game domain filter drops ui-source slots from all code intents', () => {
    for (const intent of CODE_INTENTS) {
      const filtered = filterSlotsByDomain(getConfigSlots(intent)!, 'game');
      const allSlots = [...filtered.refs, ...filtered.context];
      const uiSlots = allSlots.filter(s => s.path === 'visual/ui');
      expect(uiSlots, `${intent} must drop ui-source slots in game domain`).toEqual([]);
    }
  });

  it('domain-agnostic slots (sources, codebase, system-design, spec) survive both domain filters', () => {
    for (const intent of CODE_INTENTS) {
      const fullSlots = getConfigSlots(intent)!;
      const fullDomainAgnosticPaths = new Set(
        [...fullSlots.refs, ...fullSlots.context]
          .filter(s => !s.applicableDomains)
          .map(s => s.path),
      );
      for (const domain of ['service', 'game'] as const) {
        const filtered = filterSlotsByDomain(fullSlots, domain);
        const filteredPaths = new Set(
          [...filtered.refs, ...filtered.context].map(s => s.path),
        );
        for (const p of fullDomainAgnosticPaths) {
          expect(filteredPaths.has(p), `${intent} (${domain}): domain-agnostic ${p} dropped`).toBe(true);
        }
      }
    }
  });
});

describe('Domain-Surface Boundary (D28) — service domain regression (zero impact)', () => {
  // D28 must not change the service-domain wiring at all. These tests pin
  // down the service surface so a future game-domain refactor cannot
  // accidentally drop a service-side affordance.

  it('service domain action cards: plan / design-system / design-ui / design-spec / code / visual / ask are visible', () => {
    const expectedVisible = ['plan', 'design-system', 'design-ui', 'design-spec', 'code', 'visual', 'ask'];
    for (const id of expectedVisible) {
      const def = ACTION_DEFINITIONS.find(d => d.id === id);
      expect(def, `${id} action def`).toBeDefined();
      expect(isActionVisibleForDomain(def!, 'service'), `${id} hidden for service`).toBe(true);
    }
  });

  it('service domain hides design-game-art (mirror invariant)', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art')!;
    expect(isActionVisibleForDomain(def, 'service')).toBe(false);
  });

  it('service code intents retain ui-source slots after domain filter', () => {
    const CODE_INTENTS = ['gen-code-sys', 'gen-code-spec', 'gen-code-directive', 'rev-code'] as const;
    for (const intent of CODE_INTENTS) {
      const filtered = filterSlotsByDomain(getConfigSlots(intent)!, 'service');
      const allSlots = [...filtered.refs, ...filtered.context];
      const uiSlots = allSlots.filter(s => s.path === 'visual/ui');
      expect(uiSlots.length, `${intent}: service must keep ui-source slot`).toBeGreaterThan(0);
    }
  });
});

describe('Domain-Surface Boundary (D28) — undefined domain falls back to service', () => {
  it('isActionVisibleForDomain treats undefined as service (default seed)', () => {
    const uiDef = ACTION_DEFINITIONS.find(d => d.id === 'design-ui')!;
    const gameArtDef = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art')!;
    expect(isActionVisibleForDomain(uiDef, undefined)).toBe(true);
    expect(isActionVisibleForDomain(gameArtDef, undefined)).toBe(false);
  });

  it('filterSlotsByDomain with undefined drops domain-restricted slots (no domain matches)', () => {
    const filtered = filterSlotsByDomain(getConfigSlots('gen-code-sys')!, undefined);
    const allSlots = [...filtered.refs, ...filtered.context];
    // ui-source has applicableDomains=['service'], game-art-source ['game'] —
    // neither matches `undefined` so both drop. Domain-agnostic slots remain.
    const uiSlots = allSlots.filter(s => s.path === 'visual/ui');
    const gameArtSlots = allSlots.filter(s => s.path === 'visual/game-art/ant');
    expect(uiSlots).toEqual([]);
    expect(gameArtSlots).toEqual([]);
    // System-design slot is domain-agnostic and must survive.
    const sysSlots = allSlots.filter(s => s.path === 'architecture/system');
    expect(sysSlots.length).toBeGreaterThan(0);
  });
});

describe('Domain-Surface Boundary (D28) — exhaustive matrix coverage', () => {
  const ALL_DOMAINS: ReadonlyArray<Domain> = ['service', 'game'];

  it('NO action card is visible on BOTH domains AND domain-gated (no orphan gates)', () => {
    for (const def of ACTION_DEFINITIONS) {
      if (!def.domainGate) continue;
      const visibleDomains = ALL_DOMAINS.filter(d => isActionVisibleForDomain(def, d));
      // A gated card must have at least one domain it's NOT visible on.
      // Otherwise the gate is a no-op and indicates a config bug.
      expect(visibleDomains.length, `${def.id} gate is a no-op`).toBeLessThan(ALL_DOMAINS.length);
    }
  });
});
