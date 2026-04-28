/**
 * Domain-Aware Plan Exclusivity (D28-revised) — Regression Test.
 *
 * `gen-plan` is the single source of plan-document outputs. The static
 * matrix lists BOTH `prd.md` and `gdd.md` candidates so resolve-time
 * helpers and FE listings can hide both files from `plan/` directory
 * listings before the workspace domain is known. Once the domain is
 * known, `getConfigSlotsForDomain(intent, domain)` MUST collapse the
 * `gen-plan` `target.outputs` to a single domain-correct entry AND
 * augment every plan-dir slot's `excludeFiles` with the wrong-domain
 * filename so neither domain ever previews the other domain's plan
 * artifact.
 *
 * Likewise the action-card / intent labels carry a `labelByDomain`
 * override that the SSOT accessors `getActionLabel` / `getIntentLabel`
 * surface so service workspaces render "PRD" / "Create PRD" while game
 * workspaces render "GDD" / "Create GDD" — Korean stays
 * domain-neutral ('기획서') because both surfaces share the same noun.
 *
 * This file pins those four invariants. A future refactor that
 * re-introduces dual-candidate `target.outputs`, drops the domain
 * exclude rewrite, or strips the label override will trip a failure.
 */

import { describe, it, expect } from 'vitest';
import {
  ACTION_DEFINITIONS,
  INTENT_DEFINITIONS,
  getConfigSlots,
  getConfigSlotsForDomain,
  getPlanOutputs,
  getActionLabel,
  getIntentLabel,
  type Domain,
  type IntentId,
} from '@ant/shared';

const SOURCES_DIR = 'plan';
const DOMAINS: ReadonlyArray<Domain> = ['service', 'game'] as const;

/**
 * Every intent whose static matrix entry references `plan/` as a refs
 * or context slot. The helper guard MUST hide the wrong-domain plan
 * filename from each of these intents' listings.
 */
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

describe('domain-aware plan exclusivity — getConfigSlotsForDomain', () => {
  it('discovers a non-empty plan-input intent set', () => {
    // Sanity check — if this drops to zero we mis-detected and the rest
    // of the suite is meaningless.
    expect(PLAN_INPUT_INTENTS.length).toBeGreaterThan(0);
  });

  for (const intent of PLAN_INPUT_INTENTS) {
    for (const domain of DOMAINS) {
      it(`[${domain}] ${intent}: plan-dir slots exclude wrong-domain filename`, () => {
        const slots = getConfigSlotsForDomain(intent, domain);
        expect(slots).not.toBeNull();
        const planSlots = [
          ...slots!.refs.filter(s => s.path === SOURCES_DIR),
          ...slots!.context.filter(s => s.path === SOURCES_DIR),
        ];
        const expectedHidden = domain === 'game' ? 'prd.md' : 'gdd.md';
        const expectedKept = domain === 'game' ? 'gdd.md' : 'prd.md';
        for (const slot of planSlots) {
          expect(
            slot.excludeFiles ?? [],
            `${intent}@${domain}: plan-dir slot must hide ${expectedHidden}`,
          ).toContain(expectedHidden);
          // gen-plan's static matrix already excludes both filenames so
          // the slot's *outputs* don't echo back as input candidates;
          // every other plan-input intent must NOT hide its own domain's
          // plan filename.
          if (intent !== 'gen-plan') {
            expect(
              slot.excludeFiles ?? [],
              `${intent}@${domain}: plan-dir slot must NOT hide ${expectedKept}`,
            ).not.toContain(expectedKept);
          }
        }
      });

      it(`[${domain}] ${intent}: plan-dir slots carry domain-correct label`, () => {
        const slots = getConfigSlotsForDomain(intent, domain);
        const planSlots = [
          ...slots!.refs.filter(s => s.path === SOURCES_DIR),
          ...slots!.context.filter(s => s.path === SOURCES_DIR),
        ];
        for (const slot of planSlots) {
          // EN labels diverge across domains, KO is shared ('기획서').
          if (domain === 'game') {
            expect(slot.label.en).toBe('GDD');
          } else {
            expect(slot.label.en).toBe('PRD');
          }
          expect(slot.label.ko).toBe('기획서');
        }
      });
    }
  }
});

describe('gen-plan target.outputs collapses domain-correct', () => {
  it('service → single PRD output', () => {
    const slots = getConfigSlotsForDomain('gen-plan', 'service');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toHaveLength(1);
    expect(slots.target.outputs[0].prefix).toBe('prd');
    expect(slots.target.outputs[0].ext).toBe('.md');
  });

  it('game → single GDD output', () => {
    const slots = getConfigSlotsForDomain('gen-plan', 'game');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toHaveLength(1);
    expect(slots.target.outputs[0].prefix).toBe('gdd');
    expect(slots.target.outputs[0].ext).toBe('.md');
  });

  it('service helper output matches matrix-helper collapse', () => {
    const helper = getPlanOutputs('service');
    const slots = getConfigSlotsForDomain('gen-plan', 'service');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toEqual(helper);
  });

  it('game helper output matches matrix-helper collapse', () => {
    const helper = getPlanOutputs('game');
    const slots = getConfigSlotsForDomain('gen-plan', 'game');
    if (slots?.target.kind !== 'generate') return;
    expect(slots.target.outputs).toEqual(helper);
  });
});

describe('domain-aware label accessors', () => {
  it('plan action card resolves PRD/GDD per domain (en)', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(planAction).toBeDefined();
    expect(getActionLabel(planAction!, 'service', 'en')).toBe('PRD');
    expect(getActionLabel(planAction!, 'game', 'en')).toBe('GDD');
  });

  it('plan action card stays domain-neutral in Korean', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(getActionLabel(planAction!, 'service', 'ko')).toBe('기획서');
    expect(getActionLabel(planAction!, 'game', 'ko')).toBe('기획서');
  });

  it('gen-plan / rev-plan / explain-plan intents resolve PRD/GDD per domain (en)', () => {
    const cases: Array<[IntentId, string, string]> = [
      ['gen-plan', 'Create PRD', 'Create GDD'],
      ['rev-plan', 'Update PRD', 'Update GDD'],
      ['explain-plan', 'Explain PRD', 'Explain GDD'],
    ];
    for (const [id, expectedService, expectedGame] of cases) {
      const def = INTENT_DEFINITIONS.find(d => d.id === id);
      expect(def, id).toBeDefined();
      expect(getIntentLabel(def!, 'service', 'en')).toBe(expectedService);
      expect(getIntentLabel(def!, 'game', 'en')).toBe(expectedGame);
    }
  });

  it('non-plan intents fall back to the static label across domains', () => {
    const def = INTENT_DEFINITIONS.find(d => d.id === 'gen-spec');
    expect(def).toBeDefined();
    const enService = getIntentLabel(def!, 'service', 'en');
    const enGame = getIntentLabel(def!, 'game', 'en');
    expect(enService).toBe(def!.label.en);
    expect(enGame).toBe(def!.label.en);
  });

  it('undefined domain falls back to service semantics (workspace default seed)', () => {
    const planAction = ACTION_DEFINITIONS.find(d => d.id === 'plan');
    expect(getActionLabel(planAction!, undefined, 'en')).toBe('PRD');
  });
});

describe('matrix-level invariant — static slots remain dual-candidate', () => {
  // The static matrix MUST keep listing both `prd.md` and `gdd.md` as
  // gen-plan candidates so resolve-time helpers (`getPlanOutputs`,
  // `pickExistingPlanFilename`) and pre-domain FE listings keep their
  // existing two-file vocabulary. Domain collapse happens in the
  // helper, NOT in the matrix entry — this guards against an over-
  // eager refactor that pre-collapses the matrix and breaks resolve.
  it('gen-plan matrix entry lists both candidates in target.outputs', () => {
    const slots = getConfigSlots('gen-plan');
    expect(slots?.target.kind).toBe('generate');
    if (slots?.target.kind !== 'generate') return;
    const filenames = slots.target.outputs.map(o => `${o.prefix}${o.ext}`);
    expect(filenames).toContain('prd.md');
    expect(filenames).toContain('gdd.md');
    expect(filenames).toHaveLength(2);
  });

  it('gen-plan refs slot pre-excludes both plan filenames at the matrix layer', () => {
    const slots = getConfigSlots('gen-plan');
    const refSlot = slots?.refs[0];
    expect(refSlot).toBeDefined();
    expect(refSlot!.excludeFiles).toContain('prd.md');
    expect(refSlot!.excludeFiles).toContain('gdd.md');
  });
});
