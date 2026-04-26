/**
 * Audit 2: RAC Creation Verification
 *
 * Validates resolveToRAC and deriveFromIntent
 * across all intents and slot variations.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveToRAC,
  deriveFromIntent,
  INTENT_DEFINITIONS,
} from '@ant/shared';
import type {
  ActionMetadata,
  Mode,
  IntentGroup,
} from '@ant/shared';

// ============================================
// 2A. resolveToRAC — explicit path, full intent sweep
// ============================================

describe('Audit 2A: resolveToRAC explicit — every intent', () => {
  for (const def of INTENT_DEFINITIONS) {
    it(`${def.id}: source=explicit, intentDescription present, fields match deriveFromIntent`, () => {
      const rac = resolveToRAC(def.id, undefined, 'explicit');

      expect(rac.source).toBe('explicit');
      expect(rac.intent).toBe(def.id);
      expect(rac.intentDescription).toBe(def.description.en);
      expect(typeof rac.intentDescription).toBe('string');
      expect(rac.intentDescription!.length).toBeGreaterThan(0);

      const derived = deriveFromIntent(def.id);
      expect(rac.mode).toBe(derived.mode);
      expect(rac.intentGroup).toBe(derived.intentGroup);
    });

    it(`${def.id}: hasExplicitFields is false when no slots`, () => {
      const rac = resolveToRAC(def.id, undefined, 'explicit');
      expect(rac.hasExplicitFields).toBe(false);
    });
  }

  it('refs + context + target propagate to RAC', () => {
    const rac = resolveToRAC('gen-code-sys', {
      refs: ['ref1.md'],
      context: ['ctx1.md'],
      target: ['src/main.ts'],
    }, 'explicit');
    expect(rac.refs).toEqual(['ref1.md']);
    expect(rac.context).toEqual(['ctx1.md']);
    expect(rac.target).toEqual(['src/main.ts']);
  });

  it('documents are NOT populated by resolveToRAC', () => {
    const rac = resolveToRAC('gen-code-sys', {
      refs: ['a.md'],
    }, 'explicit');
    expect(rac.documents).toBeUndefined();
  });

  it('hasExplicitFields true when slots have content', () => {
    const rac = resolveToRAC('gen-code-sys', {
      refs: ['ref1.md'],
    }, 'explicit');
    expect(rac.hasExplicitFields).toBe(true);
  });
});

// ============================================
// 2B. resolveToRAC — infer path variations
// ============================================

describe('Audit 2B: resolveToRAC — infer path variations', () => {
  it('source is always infer by default', () => {
    const rac = resolveToRAC('gen-code-sys');
    expect(rac.source).toBe('infer');
  });

  it('intentDescription is always populated', () => {
    const rac = resolveToRAC('gen-code-sys');
    expect(rac.intentDescription).toBeDefined();
  });

  it('intent is populated', () => {
    const rac = resolveToRAC('gen-code-sys');
    expect(rac.intent).toBe('gen-code-sys');
  });

  describe('hasExplicitFields reflects slot presence', () => {
    it('true when slots have refs', () => {
      const rac = resolveToRAC('gen-code-sys', { refs: ['a.md'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('true when slots have target', () => {
      const rac = resolveToRAC('gen-code-sys', { target: ['src/main.ts'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('true when slots have context', () => {
      const rac = resolveToRAC('gen-code-sys', { context: ['notes.md'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('false when no slots', () => {
      const rac = resolveToRAC('gen-code-sys');
      expect(rac.hasExplicitFields).toBe(false);
    });

    it('false when slots have only empty arrays', () => {
      const rac = resolveToRAC('gen-code-sys', { refs: [], target: [], context: [] });
      expect(rac.hasExplicitFields).toBe(false);
    });
  });

  describe('mode variations', () => {
    it('generate mode via gen-code-sys', () => {
      const rac = resolveToRAC('gen-code-sys');
      expect(rac.mode).toBe('generate');
    });

    it('refactor mode via rev-code', () => {
      const rac = resolveToRAC('rev-code');
      expect(rac.mode).toBe('refactor');
    });

    it('explain mode via explain-code', () => {
      const rac = resolveToRAC('explain-code');
      expect(rac.mode).toBe('explain');
    });
  });

  describe('intentGroup and domain pass through', () => {
    const intentGroups: Array<{ intentId: Parameters<typeof resolveToRAC>[0]; expectedGroup?: IntentGroup }> = [
      { intentId: 'gen-ui-figma', expectedGroup: 'design-ui' },
      { intentId: 'gen-sys-fe', expectedGroup: 'design-system' },
      { intentId: 'gen-spec', expectedGroup: 'design-spec' },
      { intentId: 'gen-code-sys', expectedGroup: undefined },
    ];
    for (const { intentId, expectedGroup } of intentGroups) {
      it(`intentGroup=${expectedGroup} for ${intentId}`, () => {
        const rac = resolveToRAC(intentId);
        expect(rac.intentGroup).toBe(expectedGroup);
      });
    }

    it('domain=game', () => {
      const rac = resolveToRAC('gen-sys-fe', { domain: 'game' });
      expect(rac.domain).toBe('game');
    });

    it('domain=service', () => {
      const rac = resolveToRAC('gen-sys-fe', { domain: 'service' });
      expect(rac.domain).toBe('service');
    });
  });
});

// ============================================
// 2C. deriveFromIntent — full mapping accuracy
// ============================================

describe('Audit 2C: deriveFromIntent — intent → derived values', () => {
  const EXPECTED_DERIVATIONS: Array<{
    intent: string;
    mode: Mode;
    agent: string;
    jobType: string;
    intentGroup?: IntentGroup;
  }> = [
    { intent: 'gen-plan', mode: 'generate', agent: 'planner', jobType: 'plan' },
    { intent: 'rev-plan', mode: 'refactor', agent: 'planner', jobType: 'plan' },
    { intent: 'explain-plan', mode: 'explain', agent: 'planner', jobType: 'plan' },
    { intent: 'gen-sys-fe', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'gen-sys-be', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'gen-sys-full', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'rev-sys', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'explain-sys', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'gen-ui-figma', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'gen-ui-desc', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'rev-ui', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'explain-ui', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'gen-game-art-figma', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-game-art' },
    { intent: 'gen-game-art-desc', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-game-art' },
    { intent: 'rev-game-art', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-game-art' },
    { intent: 'explain-game-art', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-game-art' },
    { intent: 'gen-spec', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-spec' },
    { intent: 'rev-spec', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-spec' },
    { intent: 'explain-spec', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-spec' },
    { intent: 'gen-code-sys', mode: 'generate', agent: 'architect', jobType: 'code' },
    { intent: 'gen-code-spec', mode: 'generate', agent: 'architect', jobType: 'code' },
    { intent: 'gen-code-directive', mode: 'generate', agent: 'architect', jobType: 'code' },
    { intent: 'rev-code', mode: 'refactor', agent: 'architect', jobType: 'code' },
    { intent: 'explain-code', mode: 'explain', agent: 'architect', jobType: 'code' },
    { intent: 'gen-visual-logo', mode: 'generate', agent: 'creator', jobType: 'visual' },
    { intent: 'gen-visual-icon', mode: 'generate', agent: 'creator', jobType: 'visual' },
    { intent: 'gen-visual-hero', mode: 'generate', agent: 'creator', jobType: 'visual' },
    { intent: 'gen-visual-illustration', mode: 'generate', agent: 'creator', jobType: 'visual' },
    { intent: 'explain-visual', mode: 'explain', agent: 'creator', jobType: 'visual' },
    { intent: 'gen-learn', mode: 'generate', agent: 'architect', jobType: 'learn' },
    { intent: 'ask-evaluate', mode: 'explain', agent: 'architect', jobType: 'ask' },
    { intent: 'ask-ant', mode: 'explain', agent: 'architect', jobType: 'ask' },
    { intent: 'ask-general', mode: 'explain', agent: 'architect', jobType: 'ask' },
  ];

  for (const expected of EXPECTED_DERIVATIONS) {
    it(`${expected.intent} → mode=${expected.mode}, agent=${expected.agent}, jobType=${expected.jobType}`, () => {
      const derived = deriveFromIntent(expected.intent as any);
      expect(derived.mode).toBe(expected.mode);
      expect(derived.agent).toBe(expected.agent);
      expect(derived.jobType).toBe(expected.jobType);
      if (expected.intentGroup) {
        expect(derived.intentGroup).toBe(expected.intentGroup);
      }
    });
  }

  it('covers all INTENT_DEFINITIONS', () => {
    const tested = new Set(EXPECTED_DERIVATIONS.map(e => e.intent));
    for (const def of INTENT_DEFINITIONS) {
      expect(tested.has(def.id)).toBe(true);
    }
  });

  it('unknown intent defaults to generate/architect/design', () => {
    const derived = deriveFromIntent('nonexistent-intent' as any);
    expect(derived.mode).toBe('generate');
    expect(derived.agent).toBe('architect');
    expect(derived.jobType).toBe('design');
  });
});
