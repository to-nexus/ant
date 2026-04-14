import { describe, it, expect } from 'vitest';
import {
  INTENT_DEFINITIONS,
  deriveFromIntent,
  getConfigSlots,
  resolveToRAC,
  deriveChatNeedsRefs,
  deriveBuildNeedsRefs,
  hasRealRefSlots,
  hasMixedCodebaseRefs,
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

  it('rev-plan is buildDisabled (revision needs directive)', () => {
    const slots = getConfigSlots('rev-plan')!;
    expect(slots.buildDisabled).toBe(true);
    expect(slots.target.kind).toBe('revise');
    expect(slots.context.length).toBeGreaterThan(0);
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

  it('chatRequiresRefs: true intents have real (non-empty) ref slots', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id);
      if (slots?.chatRequiresRefs === true) {
        expect(
          hasRealRefSlots(slots),
          `${def.id} has chatRequiresRefs: true but no real ref slots`,
        ).toBe(true);
      }
    }
  });

  it('basis-dependent intents derive chatNeedsRefs = true via default (gen-code-sys, gen-code-spec, gen-ui-ref)', () => {
    const basisIntents = ['gen-code-sys', 'gen-code-spec', 'gen-ui-ref'] as const;
    for (const id of basisIntents) {
      const slots = getConfigSlots(id)!;
      expect(hasRealRefSlots(slots), `${id} should have real refs`).toBe(true);
      expect(
        deriveChatNeedsRefs(slots),
        `${id} must derive chatNeedsRefs = true (refs are the basis)`,
      ).toBe(true);
      expect(slots.chatRequiresRefs, `${id} should not need explicit chatRequiresRefs (default handles it)`).toBeUndefined();
    }
  });

  it('gen-plan has real refs with chatRequiresRefs: false (directive-capable, build needs refs)', () => {
    const slots = getConfigSlots('gen-plan')!;
    expect(hasRealRefSlots(slots)).toBe(true);
    expect(deriveBuildNeedsRefs(slots)).toBe(true);
    expect(slots.chatRequiresRefs).toBe(false);
    expect(deriveChatNeedsRefs(slots)).toBe(false);
  });

  it('intents with real refs and no buildRequiresRefs override derive buildNeedsRefs = true', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id)!;
      if (slots.buildRequiresRefs === undefined && hasRealRefSlots(slots)) {
        expect(
          deriveBuildNeedsRefs(slots),
          `${def.id} (real refs, no override) should derive buildNeedsRefs = true`,
        ).toBe(true);
      }
    }
  });

  it('directive-only intents (no real refs) derive buildNeedsRefs = false', () => {
    const directiveIntents = ['gen-code-directive', 'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration'] as const;
    for (const id of directiveIntents) {
      const slots = getConfigSlots(id)!;
      expect(hasRealRefSlots(slots), `${id} should have no real refs`).toBe(false);
      expect(deriveBuildNeedsRefs(slots), `${id} should derive buildNeedsRefs = false`).toBe(false);
    }
  });

  it('chatRequiresRefs is only declared when it differs from the default (deriveBuildNeedsRefs)', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id)!;
      if (slots.chatRequiresRefs !== undefined) {
        const buildDefault = deriveBuildNeedsRefs(slots);
        expect(
          slots.chatRequiresRefs !== buildDefault,
          `${def.id} has chatRequiresRefs=${slots.chatRequiresRefs} but default is already ${buildDefault} — redundant declaration`,
        ).toBe(true);
      }
    }
  });

  it('explain-visual has real ref slots (ASSETS_GEN_DIR)', () => {
    const slots = getConfigSlots('explain-visual')!;
    expect(slots.target.kind).toBe('chat-only');
    expect(hasRealRefSlots(slots)).toBe(true);
    expect(deriveChatNeedsRefs(slots)).toBe(true);
  });

  it('deriveChatNeedsRefs defaults to deriveBuildNeedsRefs', () => {
    for (const def of INTENT_DEFINITIONS) {
      const slots = getConfigSlots(def.id)!;
      if (slots.chatRequiresRefs === undefined) {
        expect(
          deriveChatNeedsRefs(slots),
          `${def.id} chatNeedsRefs should equal buildNeedsRefs when no override`,
        ).toBe(deriveBuildNeedsRefs(slots));
      }
    }
  });

  it('chatRequiresRefs: false overrides chat gate independently (gen-plan, gen-ui-desc, gen-spec)', () => {
    const directiveCapable = ['gen-plan', 'gen-ui-desc', 'gen-spec'] as const;
    for (const id of directiveCapable) {
      const slots = getConfigSlots(id)!;
      expect(slots.chatRequiresRefs, `${id} should have chatRequiresRefs: false`).toBe(false);
      expect(deriveChatNeedsRefs(slots), `${id} chat should not need refs`).toBe(false);
      expect(deriveBuildNeedsRefs(slots), `${id} build should need refs`).toBe(true);
    }
  });

  it('buildDisabled intents are visual gen + code directive + revise', () => {
    const expectedDisabled = [
      'gen-visual-logo', 'gen-visual-icon', 'gen-visual-hero', 'gen-visual-illustration',
      'gen-code-directive',
      'rev-plan', 'rev-sys', 'rev-ui', 'rev-spec',
    ] as const;
    for (const id of expectedDisabled) {
      const slots = getConfigSlots(id)!;
      expect(slots.buildDisabled, `${id} should be buildDisabled`).toBe(true);
    }
    for (const def of INTENT_DEFINITIONS) {
      if ((expectedDisabled as readonly string[]).includes(def.id)) continue;
      const slots = getConfigSlots(def.id)!;
      expect(slots.buildDisabled, `${def.id} should NOT be buildDisabled`).toBeFalsy();
    }
  });

  it('gen-code-directive is buildDisabled (directive-only intent)', () => {
    const slots = getConfigSlots('gen-code-directive')!;
    expect(slots.buildDisabled).toBe(true);
    expect(hasRealRefSlots(slots)).toBe(false);
    expect(deriveChatNeedsRefs(slots)).toBe(false);
  });

  it('revise intents are all buildDisabled', () => {
    const revIntents = ['rev-plan', 'rev-sys', 'rev-ui', 'rev-spec'] as const;
    for (const id of revIntents) {
      const slots = getConfigSlots(id)!;
      expect(slots.buildDisabled, `${id} should be buildDisabled`).toBe(true);
      expect(slots.target.kind, `${id} should be revise target`).toBe('revise');
    }
  });

  it('chat-only + realRefs: chat gated by ref selection (explain pattern)', () => {
    const explainWithRefs = ['explain-plan', 'explain-sys', 'explain-ui', 'explain-spec', 'explain-code', 'explain-visual'] as const;
    for (const id of explainWithRefs) {
      const slots = getConfigSlots(id)!;
      expect(slots.target.kind, `${id} should be chat-only`).toBe('chat-only');
      expect(hasRealRefSlots(slots), `${id} should have real refs`).toBe(true);
      expect(deriveChatNeedsRefs(slots), `${id} chat should need refs`).toBe(true);
    }
  });

  it('chat-only + no realRefs: build always disabled (ask pattern)', () => {
    const askIntents = ['ask-evaluate', 'ask-ant', 'ask-general'] as const;
    for (const id of askIntents) {
      const slots = getConfigSlots(id)!;
      expect(slots.target.kind).toBe('chat-only');
      expect(hasRealRefSlots(slots)).toBe(false);
      expect(deriveBuildNeedsRefs(slots)).toBe(false);
      expect(deriveChatNeedsRefs(slots)).toBe(false);
    }
  });

  it('hasMixedCodebaseRefs is true only for rev-code (codebase + non-codebase refs)', () => {
    const slots = getConfigSlots('rev-code')!;
    expect(hasMixedCodebaseRefs(slots)).toBe(true);

    for (const def of INTENT_DEFINITIONS) {
      if (def.id === 'rev-code') continue;
      const s = getConfigSlots(def.id)!;
      expect(
        hasMixedCodebaseRefs(s),
        `${def.id} should NOT have mixed codebase refs`,
      ).toBe(false);
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
