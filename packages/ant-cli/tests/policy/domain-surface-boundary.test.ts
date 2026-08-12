/**
 * Domain SSOT — every domain contract lives in one file so a regression
 * surfaces here and only here:
 *
 *   1. D28 Domain-Surface Boundary (this file's original scope) —
 *      visual / game-art surfaces split per workspace domain at the
 *      matrix / action / intent / slot-routing layer; mention-menu
 *      mirror; service-domain regression; undefined-domain fallback.
 *
 *   2. Domain pipeline compatibility (Phase 1 10.x) —
 *      `getEffectiveDomain` + `mergeWithMetadata` shared/runtime
 *      precedence: explicit metadata > inferred > undefined → service.
 *
 *   3. Domain-aware plan exclusivity (D28-revised) —
 *      `gen-plan` collapses `target.outputs` per domain (PRD vs GDD);
 *      every plan-input intent's plan-dir slots hide the wrong-domain
 *      filename via `excludeFiles`; label accessors render PRD/GDD per
 *      domain (Korean stays domain-neutral '기획서').
 *
 *   4. BasisSlotConfig.defaults BE seeding (Phase 1 H-3) —
 *      detect node applies per-domain seed values BEFORE the RAC funnel
 *      so downstream surfaces see a populated `basis.techTier`.
 *      `lockedStack` (gen-sys-fe / -be / -full) pins stack regardless.
 *
 *   5. Explicit > infer LLM skip (Phase 1 H-1) —
 *      detect template gates the domain instruction on
 *      `{{#unless explicitDomain}}` so the LLM does not waste tokens
 *      re-inferring an already-known domain.
 */

import { afterEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { ProjectCrudService } from '../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService';
import {
  TIER_DOMAIN_MATRIX,
  ACTION_DEFINITIONS,
  INTENT_DEFINITIONS,
  isActionVisibleForDomain,
  isActionSurfaced,
  getConfigSlots,
  getConfigSlotsForDomain,
  getPlanOutputs,
  getActionLabel,
  getIntentLabel,
  getEffectiveDomain,
  mergeWithMetadata,
  filterSlotsByDomain,
  type Domain,
  type IntentId,
  type Basis,
  type BasisSlotConfig,
  type InferredAction,
  type ActionMetadata,
} from '@ant/shared';

const TEMPLATES_ROOT = path.resolve(__dirname, '../../src/core/prompt/templates');

function renderTemplate(rel: string, vars: Record<string, unknown>): string {
  const file = path.join(TEMPLATES_ROOT, `${rel}.md`);
  const src = fs.readFileSync(file, 'utf-8');
  const tmpl = Handlebars.compile(src, { noEscape: true, strict: false });
  return tmpl(vars);
}

// ────────────────────────────────────────────────────────────────────────────
// Mention-menu mirror: intentGroup → action def gate consistency
// (consolidated from the retired tests/policy/domain-gate.test.ts so card
// visibility and @intent: mention visibility share one regression file.)
// ────────────────────────────────────────────────────────────────────────────

describe('mention-menu mirrors action card domainGate', () => {
  it('game-art intents (intentGroup → action def) are hidden in service / visible in game', () => {
    const gameOnly: ReadonlyArray<string> = [
      'gen-game-art-figma',
      'gen-game-art-desc',
      'rev-game-art',
      'explain-game-art',
    ];
    for (const intentId of gameOnly) {
      const intent = INTENT_DEFINITIONS.find(d => d.id === intentId);
      expect(intent).toBeDefined();
      const def = ACTION_DEFINITIONS.find(d => d.id === intent!.intentGroup);
      expect(def).toBeDefined();
      expect(isActionVisibleForDomain(def!, 'service')).toBe(false);
      expect(isActionVisibleForDomain(def!, 'game')).toBe(true);
    }
  });

  it('UI design intents (intentGroup → action def) are visible in service / hidden in game', () => {
    const serviceOnly: ReadonlyArray<string> = [
      'gen-ui-figma',
      'gen-ui-desc',
      'rev-ui',
      'explain-ui',
    ];
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

describe('Domain-Surface Boundary (D28) — matrix layer', () => {
  it('visualTier matrix row is service-only', () => {
    expect(TIER_DOMAIN_MATRIX.visualTier).toEqual(['service']);
  });

  it('gameArtTier matrix row is game-only', () => {
    expect(TIER_DOMAIN_MATRIX.gameArtTier).toEqual(['game']);
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
  const CODE_INTENTS = ['gen-code-sys', 'gen-code-spec', 'gen-code-directive'] as const;

  it('every code intent declares both ui-source AND game-art-source slots in its full definition', () => {
    for (const intent of CODE_INTENTS) {
      const slots = getConfigSlots(intent)!;
      const allSlots = [...slots.refs, ...slots.context];
      const hasUiSource = allSlots.some(s => s.path === 'visual/ui');
      const hasGameArtSource = allSlots.some(s => s.path === 'visual/game-art');
      // gen-code-spec uses spec docs as refs only, but UI/game-art is in context.
      expect(hasUiSource || hasGameArtSource, `${intent} must list at least one design source`).toBe(true);
    }
  });

  it('service domain filter drops game-art-source slots from all code intents', () => {
    for (const intent of CODE_INTENTS) {
      const filtered = filterSlotsByDomain(getConfigSlots(intent)!, 'service');
      const allSlots = [...filtered.refs, ...filtered.context];
      const gameArtSlots = allSlots.filter(s => s.path === 'visual/game-art');
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

describe('Domain-Surface Boundary — design-spec domain routing (Game-Activation T1-b)', () => {
  const SPEC_INTENTS = ['gen-spec', 'rev-spec'] as const;

  it('every spec intent lists both ui-source AND game-art-source in its full context', () => {
    for (const intent of SPEC_INTENTS) {
      const ctx = getConfigSlots(intent)!.context;
      expect(ctx.some(s => s.path === 'visual/ui'), `${intent} must list ui-source`).toBe(true);
      expect(ctx.some(s => s.path === 'visual/game-art'), `${intent} must list game-art-source`).toBe(true);
    }
  });

  it('game domain keeps game-art-source and drops ui-source', () => {
    for (const intent of SPEC_INTENTS) {
      const ctx = filterSlotsByDomain(getConfigSlots(intent)!, 'game').context;
      expect(ctx.some(s => s.path === 'visual/game-art'), `${intent}@game keeps game-art`).toBe(true);
      expect(ctx.some(s => s.path === 'visual/ui'), `${intent}@game drops ui-source`).toBe(false);
    }
  });

  it('service domain keeps ui-source and drops game-art-source', () => {
    for (const intent of SPEC_INTENTS) {
      const ctx = filterSlotsByDomain(getConfigSlots(intent)!, 'service').context;
      expect(ctx.some(s => s.path === 'visual/ui'), `${intent}@service keeps ui-source`).toBe(true);
      expect(ctx.some(s => s.path === 'visual/game-art'), `${intent}@service drops game-art`).toBe(false);
    }
  });

  it('plan-slot label is the domain-neutral PRD (unified — game spec grounds against the PRD)', () => {
    // gen-spec pulls the plan doc as ref; the plan artifact is the single
    // domain-neutral PRD (a game PRD carries game sections via the overlay),
    // so its label reads PRD in every domain including game.
    const gameRefs = getConfigSlotsForDomain('gen-spec', 'game')!.refs.filter(s => s.path === 'plan');
    expect(gameRefs.length).toBeGreaterThan(0);
    for (const slot of gameRefs) expect(slot.label.en).toBe('PRD');
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
    const CODE_INTENTS = ['gen-code-sys', 'gen-code-spec', 'gen-code-directive'] as const;
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
    const gameArtSlots = allSlots.filter(s => s.path === 'visual/game-art');
    expect(uiSlots).toEqual([]);
    expect(gameArtSlots).toEqual([]);
    // System-design slot is domain-agnostic and must survive.
    const sysSlots = allSlots.filter(s => s.path === 'architecture/system');
    expect(sysSlots.length).toBeGreaterThan(0);
  });
});

describe('Action surfacing — status: "hidden" closes every UI surface', () => {
  it('isActionSurfaced hides learn-codebase regardless of domain', () => {
    const def = ACTION_DEFINITIONS.find(d => d.id === 'learn-codebase')!;
    expect(isActionSurfaced(def, 'service')).toBe(false);
    expect(isActionSurfaced(def, 'game')).toBe(false);
    expect(isActionSurfaced(def, undefined)).toBe(false);
  });

  it('isActionSurfaced preserves the domain gate for non-hidden cards', () => {
    const ui = ACTION_DEFINITIONS.find(d => d.id === 'design-ui')!;
    expect(isActionSurfaced(ui, 'service')).toBe(true);
    expect(isActionSurfaced(ui, 'game')).toBe(false);
    const gameArt = ACTION_DEFINITIONS.find(d => d.id === 'design-game-art')!;
    expect(isActionSurfaced(gameArt, 'service')).toBe(false);
    expect(isActionSurfaced(gameArt, 'game')).toBe(true);
  });

  it('learn-codebase is the only currently-hidden action', () => {
    // Sanity guard so a future "set status: hidden" elsewhere fails this
    // test and forces the author to update the assertion intentionally.
    const hidden = ACTION_DEFINITIONS.filter(d => d.status === 'hidden').map(d => d.id);
    expect(hidden).toEqual(['learn-codebase']);
  });
});

describe('Domain-Surface Boundary (D28) — exhaustive matrix coverage', () => {
  const ALL_DOMAINS: ReadonlyArray<Domain> = ['service', 'game'];

  it('NO action card is visible on BOTH domains AND domain-gated (no orphan gates)', () => {
    for (const def of ACTION_DEFINITIONS) {
      if (!def.domainGate) continue;
      const visibleDomains = ALL_DOMAINS.filter(d => isActionVisibleForDomain(def, d));
      expect(visibleDomains.length, `${def.id} gate is a no-op`).toBeLessThan(ALL_DOMAINS.length);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Domain pipeline compatibility (Phase 1 10.x)
// Six fallback / explicit / infer / override scenarios.
// ════════════════════════════════════════════════════════════════════════════

function makeInferred(partial: Partial<InferredAction>): InferredAction {
  return { intentId: 'gen-plan', sourceJob: 'plan', ...partial };
}

describe('domain pipeline — getEffectiveDomain', () => {
  it('1. service-only: undefined → service', () => {
    expect(getEffectiveDomain(undefined)).toBe('service');
  });

  it('2. fallback: explicit service stays service', () => {
    expect(getEffectiveDomain('service')).toBe('service');
  });

  it('3. game stays game', () => {
    expect(getEffectiveDomain('game')).toBe('game');
  });
});

describe('domain pipeline — mergeWithMetadata', () => {
  it('3. game-explicit: actionMetadata wins when present', () => {
    const merged = mergeWithMetadata(makeInferred({}), { domain: 'game' } as ActionMetadata);
    expect(merged.domain).toBe('game');
  });

  it('4. game-infer: inferred used when metadata absent', () => {
    const merged = mergeWithMetadata(makeInferred({ domain: 'game' }));
    expect(merged.domain).toBe('game');
  });

  it('5. infer-fallback: nothing inferred and no metadata → undefined', () => {
    const merged = mergeWithMetadata(makeInferred({}));
    expect(merged.domain).toBeUndefined();
    expect(getEffectiveDomain(merged.domain)).toBe('service');
  });

  it('6. explicit-override: metadata=service beats inferred=game (10.2)', () => {
    const merged = mergeWithMetadata(
      makeInferred({ domain: 'game' }),
      { domain: 'service' } as ActionMetadata,
    );
    expect(merged.domain).toBe('service');
  });

  it('explicit-override (game): metadata=game beats inferred=service', () => {
    const merged = mergeWithMetadata(
      makeInferred({ domain: 'service' }),
      { domain: 'game' } as ActionMetadata,
    );
    expect(merged.domain).toBe('game');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Domain-aware plan exclusivity (D28-revised)
// gen-plan collapses outputs per domain; plan-dir slots hide wrong-domain file;
// label accessors render PRD/GDD per domain.
// ════════════════════════════════════════════════════════════════════════════

const SOURCES_DIR = 'plan';
const DOMAINS_BOTH: ReadonlyArray<Domain> = ['service', 'game'] as const;

const PLAN_INPUT_INTENTS = (() => {
  const out: IntentId[] = [];
  for (const def of INTENT_DEFINITIONS) {
    const slots = getConfigSlots(def.id as IntentId);
    if (!slots) continue;
    const refTouchesPlan = slots.refs.some(s => s.path === SOURCES_DIR);
    const ctxTouchesPlan = slots.context.some(s => s.path === SOURCES_DIR);
    if (refTouchesPlan || ctxTouchesPlan) out.push(def.id as IntentId);
  }
  return out;
})();

describe('domain-neutral plan slot — getConfigSlotsForDomain (unified PRD)', () => {
  it('discovers a non-empty plan-input intent set', () => {
    expect(PLAN_INPUT_INTENTS.length).toBeGreaterThan(0);
  });

  for (const intent of PLAN_INPUT_INTENTS) {
    for (const domain of DOMAINS_BOTH) {
      it(`[${domain}] ${intent}: plan-dir slots never hide the single canonical prd.md`, () => {
        // Unified single-canonical PRD: plan/prd.md is the plan artifact
        // for EVERY domain, so no domain rewrites the slot to hide a
        // "wrong-domain" filename. gen-plan's refs slot pre-excludes its
        // own output (prd.md); non-gen-plan intents keep prd.md visible.
        const slots = getConfigSlotsForDomain(intent, domain);
        expect(slots).not.toBeNull();
        const planSlots = [
          ...slots!.refs.filter(s => s.path === SOURCES_DIR),
          ...slots!.context.filter(s => s.path === SOURCES_DIR),
        ];
        for (const slot of planSlots) {
          // gdd.md is no longer a recognized plan filename anywhere.
          expect(slot.excludeFiles ?? [], `${intent}@${domain}: gdd.md must not appear`).not.toContain('gdd.md');
          if (intent !== 'gen-plan') {
            expect(slot.excludeFiles ?? [], `${intent}@${domain}: prd.md stays visible`).not.toContain('prd.md');
          }
        }
      });

      it(`[${domain}] ${intent}: plan-dir slots carry the domain-neutral PRD label`, () => {
        const slots = getConfigSlotsForDomain(intent, domain);
        const planSlots = [
          ...slots!.refs.filter(s => s.path === SOURCES_DIR),
          ...slots!.context.filter(s => s.path === SOURCES_DIR),
        ];
        for (const slot of planSlots) {
          expect(slot.label.en).toBe('PRD');
          expect(slot.label.ko).toBe('기획서');
        }
      });
    }
  }
});

describe('gen-plan target.outputs — single PRD for every domain', () => {
  it('service → single PRD output', () => {
    const slots = getConfigSlotsForDomain('gen-plan', 'service');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toHaveLength(1);
    expect(slots.target.outputs[0].prefix).toBe('prd');
    expect(slots.target.outputs[0].ext).toBe('.md');
  });

  it('game → single PRD output (unified — no separate GDD)', () => {
    const slots = getConfigSlotsForDomain('gen-plan', 'game');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toHaveLength(1);
    expect(slots.target.outputs[0].prefix).toBe('prd');
    expect(slots.target.outputs[0].ext).toBe('.md');
  });

  it('service output matches the domain-neutral helper', () => {
    const helper = getPlanOutputs();
    const slots = getConfigSlotsForDomain('gen-plan', 'service');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toEqual(helper);
  });

  it('game output matches the domain-neutral helper', () => {
    const helper = getPlanOutputs();
    const slots = getConfigSlotsForDomain('gen-plan', 'game');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toEqual(helper);
  });
});

describe('domain-neutral label accessors (unified PRD)', () => {
  it('plan action card resolves PRD for both domains (en)', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(planAction).toBeDefined();
    expect(getActionLabel(planAction!, 'service', 'en')).toBe('PRD');
    expect(getActionLabel(planAction!, 'game', 'en')).toBe('PRD');
  });

  it('plan action card stays domain-neutral in Korean', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(getActionLabel(planAction!, 'service', 'ko')).toBe('기획서');
    expect(getActionLabel(planAction!, 'game', 'ko')).toBe('기획서');
  });

  it('gen-plan / rev-plan / explain-plan intents resolve PRD for both domains (en)', () => {
    const cases: Array<[IntentId, string]> = [
      ['gen-plan', 'Create PRD'],
      ['rev-plan', 'Update PRD'],
      ['explain-plan', 'Explain PRD'],
    ];
    for (const [id, expected] of cases) {
      const def = INTENT_DEFINITIONS.find(d => d.id === id);
      expect(def, id).toBeDefined();
      expect(getIntentLabel(def!, 'service', 'en')).toBe(expected);
      expect(getIntentLabel(def!, 'game', 'en')).toBe(expected);
    }
  });

  it('non-plan intents fall back to the static label across domains', () => {
    const def = INTENT_DEFINITIONS.find(d => d.id === 'gen-spec');
    expect(def).toBeDefined();
    expect(getIntentLabel(def!, 'service', 'en')).toBe(def!.label.en);
    expect(getIntentLabel(def!, 'game', 'en')).toBe(def!.label.en);
  });

  it('undefined domain falls back to the same PRD label', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(getActionLabel(planAction!, undefined, 'en')).toBe('PRD');
  });
});

describe('matrix-level invariant — single-canonical plan output', () => {
  it('gen-plan matrix entry lists the single PRD candidate in target.outputs', () => {
    const slots = getConfigSlots('gen-plan');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    const filenames = slots.target.outputs.map(o => `${o.prefix}${o.ext}`);
    expect(filenames).toEqual(['prd.md']);
  });

  it('gen-plan refs slot pre-excludes only prd.md at the matrix layer', () => {
    const slots = getConfigSlots('gen-plan');
    const refSlot = slots?.refs[0];
    expect(refSlot).toBeDefined();
    expect(refSlot!.excludeFiles).toContain('prd.md');
    expect(refSlot!.excludeFiles).not.toContain('gdd.md');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BasisSlotConfig.defaults BE seeding (Phase 1 H-3)
// ════════════════════════════════════════════════════════════════════════════

describe('BasisSlotConfig.defaults (data shape)', () => {
  // FE-envelope game intents: game seeds frontend + phaser. gen-sys-full
  // moved to the fullstack assertion below (Game-Activation T3-a).
  const GAME_FE_PHASER_INTENTS: IntentId[] = [
    'gen-sys-fe',
    'gen-code-sys', 'gen-code-spec', 'gen-code-directive',
  ];

  it.each(GAME_FE_PHASER_INTENTS)('%s seeds game ⇒ frontend + phaser', (intent) => {
    const slot = getConfigSlots(intent)?.basis;
    const seed = slot?.defaults?.['game' as Domain];
    expect(seed).toBeDefined();
    expect(seed?.stack).toBe('frontend');
    expect(seed?.gameEngine).toBe('phaser');
  });

  it('gen-sys-full seeds game ⇒ fullstack + phaser (FE+BE parity, T3-a)', () => {
    const seed = getConfigSlots('gen-sys-full')?.basis?.defaults?.['game' as Domain];
    expect(seed).toBeDefined();
    expect(seed?.stack).toBe('fullstack');
    expect(seed?.gameEngine).toBe('phaser');
  });

  it('gen-sys-fe / gen-sys-full also carry a service-domain stack seed', () => {
    expect(getConfigSlots('gen-sys-fe')?.basis?.defaults?.service?.stack).toBe('frontend');
    expect(getConfigSlots('gen-sys-full')?.basis?.defaults?.service?.stack).toBe('fullstack');
  });

  it('gen-sys-be carries both service and game backend stack seeds (T3-a)', () => {
    const slot = getConfigSlots('gen-sys-be')?.basis;
    expect(slot?.defaults?.service?.stack).toBe('backend');
    // game backend is a first-class parity path — stack backend, no gameEngine
    // (a game server is expressed via backend.framework, not gameEngine).
    expect(slot?.defaults?.game?.stack).toBe('backend');
    expect(slot?.defaults?.game?.gameEngine).toBeUndefined();
  });

  it('non-techTier intents (plan / spec / ui-design) carry no defaults', () => {
    const intents: IntentId[] = ['gen-plan', 'rev-plan', 'gen-spec', 'rev-spec', 'gen-ui-figma', 'gen-ui-desc'];
    for (const intent of intents) {
      const slot = getConfigSlots(intent)?.basis;
      expect(slot?.defaults).toBeUndefined();
    }
  });
});

/**
 * Re-implemented black-box harness for `applyDomainDefaultsToBasis`.
 * The helper is private to detect/index.ts; re-importing would couple
 * this test to the detect-node module path. Contract test is enough.
 */
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
    expect(out?.techTier?.frontend?.gameEngine).toBe('phaser');
    expect(out?.techTier?.frontend?.framework).toBe('react');
  });

  it('preserves user-supplied gameEngine — never overwrites', () => {
    const out = applyDomainDefaultsToBasis(slot, 'game', {
      techTier: { stack: 'frontend', frontend: { stack: 'frontend', gameEngine: 'phaser' as any } },
    });
    expect(out?.techTier?.frontend?.gameEngine).toBe('phaser');
  });

  it('inhibits gameEngine seed when stack is backend', () => {
    const out = applyDomainDefaultsToBasis(slot, 'game', { techTier: { stack: 'backend' } });
    expect(out?.techTier?.frontend).toBeUndefined();
  });

  it('gen-sys-be game seed + lockedStack both resolve to backend, no gameEngine (T3-a)', () => {
    const beSlot = getConfigSlots('gen-sys-be')?.basis;
    const before = { techTier: { stack: 'backend' as const } };
    const out = applyDomainDefaultsToBasis(beSlot, 'game', before);
    // game default {stack:'backend'} + lockedStack backend → backend; the
    // backend stack inhibits the (absent) gameEngine seed, so the shape is
    // unchanged from a clean backend basis.
    expect(out?.techTier?.stack).toBe('backend');
    expect(out?.techTier?.frontend).toBeUndefined();
  });

  it('returns basis unchanged when domain has no entry in defaults', () => {
    const planSlot = getConfigSlots('gen-plan')?.basis;
    const out = applyDomainDefaultsToBasis(planSlot, 'game', undefined);
    expect(out).toBeUndefined();
  });
});

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
    const stale: Basis = { techTier: { stack: 'fullstack' } };
    const out = applyDomainDefaultsToBasis(slot, 'service', stale);
    expect(out?.techTier?.stack).toBe(lockedStack);
  });
});

// Phase D — the per-job plan/detect and design/detect templates were
// replaced by `jobs/shared/nodes/detect/variants/default/{base,rules}`
// and `explicitDomain` is no longer a template-level switch (domain is
// derived inside `inferRacWithTools` from triage + actionMetadata). The
// suppression describe blocks that lived here checked the old templates
// and have been removed alongside them.

// ─────────────────────────────────────────────────────────────────────
// 6. Domain persistence — `WorkspaceConfig.domain` exists from creation
//
// The backend's domain resolution (`resolveWorkspaceDomain`) treats an
// explicit `config.json` domain as absolute, so it is only as good as the
// creation path writing one. `createProject` wrote `{repositoryName, repoType,
// githubRepo, llmModels}` and nothing else, so a project created via the
// wizard had NO persisted domain and every job fell through to guessing from
// workspace shape. Resolution rows live in `triage-domain-derivation.test.ts`.
// ─────────────────────────────────────────────────────────────────────
describe('6. WorkspaceConfig.domain persistence', () => {
  const userContext = { organizationId: 'org-domain', userId: 'user-domain' };
  const roots: string[] = [];

  afterEach(async () => {
    while (roots.length > 0) {
      await fs.promises.rm(roots.pop()!, { recursive: true, force: true });
    }
  });

  async function mkCrud() {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-domain-'));
    roots.push(workspaceRoot);
    const resolver = new UnifiedWorkspaceResolver(workspaceRoot);
    return { resolver, crud: new ProjectCrudService(resolver) };
  }

  const readConfig = (resolver: UnifiedWorkspaceResolver, id: string) =>
    JSON.parse(
      fs.readFileSync(
        path.join(resolver.getProjectPath(userContext as any, id), 'config.json'),
        'utf-8',
      ),
    );

  it('defaults to service when the caller supplies no domain', async () => {
    const { resolver, crud } = await mkCrud();
    await crud.createProject('p-default', userContext as any);
    expect(readConfig(resolver, 'p-default').domain).toBe('service');
  });

  it('persists an explicit game domain at creation (not via a follow-up PUT)', async () => {
    const { resolver, crud } = await mkCrud();
    await crud.createProject('p-game', userContext as any, { domain: 'game' });
    expect(readConfig(resolver, 'p-game').domain).toBe('game');
  });

  it('backfills a legacy config that predates the persisted domain', async () => {
    const { resolver, crud } = await mkCrud();
    await crud.createProject('p-legacy', userContext as any);
    const configPath = path.join(
      resolver.getProjectPath(userContext as any, 'p-legacy'),
      'config.json',
    );
    const legacy = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    delete legacy.domain;
    fs.writeFileSync(configPath, JSON.stringify(legacy, null, 2));

    const returned = await crud.getProjectConfig('p-legacy', userContext as any);
    expect(returned.domain).toBe('service');
    // Healed on disk too — the runtime reads the file, not this return value.
    expect(readConfig(resolver, 'p-legacy').domain).toBe('service');
  });

  it('leaves an existing game domain untouched on read', async () => {
    const { resolver, crud } = await mkCrud();
    await crud.createProject('p-keep', userContext as any, { domain: 'game' });
    await crud.getProjectConfig('p-keep', userContext as any);
    expect(readConfig(resolver, 'p-keep').domain).toBe('game');
  });
});
