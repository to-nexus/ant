import { describe, it, expect } from 'vitest';
import {
  INTENT_DEFINITIONS,
  deriveFromIntent,
  getConfigSlots,
  resolveToRAC,
} from '@ant/shared';

describe('Action Config Matrix completeness', () => {
  it('every INTENT_DEFINITIONS.id has a MATRIX entry', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      expect(slots, `${def.id} should have MATRIX entry`).not.toBeNull();
    }
  });

  it('deriveFromIntent produces valid agent/jobType for every intent', () => {
    for (const def of INTENT_DEFINITIONS) {
      const derived = deriveFromIntent(def.id);
      expect(derived.agent, `${def.id}.agent`).toBeDefined();
      expect(derived.jobType, `${def.id}.jobType`).toBeDefined();
      expect(['generate', 'refactor', 'explain']).toContain(derived.mode);
    }
  });

  it('getConfigSlots returns complete slots for every intent in MATRIX', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      expect(slots, def.id).not.toBeNull();
      expect(slots!.refs).toBeDefined();
      expect(slots!.context).toBeDefined();
      expect(slots!.target).toBeDefined();
      expect(slots!.target.kind).toBeDefined();
    }
  });

  it('every TargetDef has a valid kind', () => {
    const validKinds = ['generate', 'revise', 'codebase', 'chat-only'];
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      expect(
        validKinds.includes(slots!.target.kind),
        `${def.id} target.kind="${slots!.target.kind}" should be one of ${validKinds.join(', ')}`,
      ).toBe(true);
    }
  });

  it('generate-mode intents have generate or codebase target kind', () => {
    const genIntents = INTENT_DEFINITIONS.filter(d => deriveFromIntent(d.id).mode === 'generate');
    for (const def of genIntents) {
      const slots = getConfigSlots(def.id);
      expect(
        slots!.target.kind === 'generate' || slots!.target.kind === 'codebase',
        `${def.id} should have target.kind generate or codebase, got ${slots!.target.kind}`,
      ).toBe(true);
    }
  });

  it('refactor-mode intents have revise or codebase target kind', () => {
    const revIntents = INTENT_DEFINITIONS.filter(d => deriveFromIntent(d.id).mode === 'refactor');
    for (const def of revIntents) {
      const slots = getConfigSlots(def.id);
      expect(
        slots!.target.kind === 'revise' || slots!.target.kind === 'codebase',
        `${def.id} should have target.kind revise or codebase, got ${slots!.target.kind}`,
      ).toBe(true);
    }
  });

  it('explain-mode intents have chat-only target kind', () => {
    const explainIntents = INTENT_DEFINITIONS.filter(d => deriveFromIntent(d.id).mode === 'explain');
    for (const def of explainIntents) {
      const slots = getConfigSlots(def.id);
      expect(
        slots!.target.kind,
        `${def.id} should have chat-only target`,
      ).toBe('chat-only');
    }
  });

  it('rev-plan requires context for build', () => {
    const slots = getConfigSlots('rev-plan');
    expect(slots).not.toBeNull();
    expect(slots!.buildRequiresContext).toBe(true);
    expect(slots!.context.length).toBeGreaterThan(0);
  });

  it('buildRequiresContext intents have non-empty context slots', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      if (slots?.buildRequiresContext) {
        expect(
          slots.context.length,
          `${def.id} has buildRequiresContext but no context slots`,
        ).toBeGreaterThan(0);
      }
    }
  });

});

describe('resolveToRAC merging', () => {
  it('refs propagate from slots', () => {
    const rac = resolveToRAC('gen-code-sys', { refs: ['x.md'] });
    expect(rac.refs).toEqual(['x.md']);
  });

  it('refs: undefined when no slots', () => {
    const rac = resolveToRAC('gen-code-sys');
    expect(rac.refs).toBeUndefined();
  });

  it('target propagates from slots', () => {
    const rac = resolveToRAC('gen-code-sys', { target: ['explicit.md'] });
    expect(rac.target).toEqual(['explicit.md']);
  });

  it('context propagates from slots', () => {
    const rac = resolveToRAC('gen-code-sys', { context: ['ctx1.md', 'ctx2.md'] });
    expect(rac.context).toEqual(['ctx1.md', 'ctx2.md']);
  });

});

describe('resolveToRAC with intentId variations', () => {
  it('gen-plan produces correct RAC', () => {
    const rac = resolveToRAC('gen-plan');
    expect(rac.intent).toBe('gen-plan');
    expect(rac.mode).toBe('generate');
    expect(rac.source).toBe('infer');
  });

  it('rev-plan produces refactor mode', () => {
    const rac = resolveToRAC('rev-plan');
    expect(rac.mode).toBe('refactor');
  });

  it('default source is infer', () => {
    const rac = resolveToRAC('gen-code-sys');
    expect(rac.source).toBe('infer');
    expect(rac.mode).toBe('generate');
  });
});
