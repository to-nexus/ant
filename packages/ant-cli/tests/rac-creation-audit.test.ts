/**
 * Audit 2: RAC Creation Verification
 *
 * Validates resolveFromExplicit, resolveFromInfer, and deriveFromIntent
 * across all intents and detection report variations.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFromExplicit,
  resolveFromInfer,
  deriveFromIntent,
  INTENT_DEFINITIONS,
} from '@ant/shared';
import type {
  ActionMetadata,
  DetectionReport,
  Mode,
  JobEnvironment,
  IntentGroup,
} from '@ant/shared';

// ============================================
// 2A. resolveFromExplicit — full intent sweep
// ============================================

describe('Audit 2A: resolveFromExplicit — every intent', () => {
  for (const def of INTENT_DEFINITIONS) {
    it(`${def.id}: source=explicit, intentDescription present, fields match deriveFromIntent`, () => {
      const metadata: ActionMetadata = { explicit: true, intent: def.id };
      const rac = resolveFromExplicit(metadata);

      expect(rac.source).toBe('explicit');
      expect(rac.intent).toBe(def.id);
      expect(rac.intentDescription).toBe(def.description.en);
      expect(typeof rac.intentDescription).toBe('string');
      expect(rac.intentDescription!.length).toBeGreaterThan(0);

      const derived = deriveFromIntent(def.id);
      expect(rac.mode).toBe(derived.mode);
      expect(rac.intentGroup).toBe(derived.intentGroup);

      if (derived.environment) {
        expect(rac.tech.environment).toBe(derived.environment);
      }
    });

    it(`${def.id}: hasExplicitFields is true (intentDescription always present)`, () => {
      const metadata: ActionMetadata = { explicit: true, intent: def.id };
      const rac = resolveFromExplicit(metadata);
      expect(rac.hasExplicitFields).toBe(true);
    });
  }

  it('all code intents have no derived environment', () => {
    const codeIntents = INTENT_DEFINITIONS.filter(d => d.intentGroup === 'code');
    for (const def of codeIntents) {
      const derived = deriveFromIntent(def.id);
      expect(derived.environment).toBeUndefined();
    }
  });

  it('all system-design create intents have derived environment', () => {
    const envIntents = ['gen-sys-fe', 'gen-sys-be', 'gen-sys-full'];
    for (const id of envIntents) {
      const derived = deriveFromIntent(id);
      expect(derived.environment).toBeDefined();
    }
  });

  it('rev-sys has no derived environment', () => {
    const derived = deriveFromIntent('rev-sys');
    expect(derived.environment).toBeUndefined();
  });

  it('all ui-design intents have no derived environment (it is implicit frontend)', () => {
    const uiIntents = INTENT_DEFINITIONS.filter(d => d.intentGroup === 'design-ui');
    for (const def of uiIntents) {
      const derived = deriveFromIntent(def.id);
      expect(derived.environment).toBeUndefined();
    }
  });

  it('refs + context + target propagate to RAC', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'gen-code-sys',
      refs: ['ref1.md'],
      context: ['ctx1.md'],
      target: ['src/main.ts'],
    };
    const rac = resolveFromExplicit(metadata);
    expect(rac.refs).toEqual(['ref1.md']);
    expect(rac.context).toEqual(['ctx1.md']);
    expect(rac.target).toEqual(['src/main.ts']);
  });

  it('documents are NOT populated by resolveFromExplicit', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'gen-code-sys',
      refs: ['a.md'],
    };
    const rac = resolveFromExplicit(metadata);
    expect(rac.documents).toBeUndefined();
  });

  it('tech.language reflects codebaseProfile', () => {
    const languages = [
      { input: 'TypeScript', expected: 'typescript' },
      { input: 'Go', expected: 'go' },
      { input: 'Python', expected: 'python' },
      { input: 'Rust', expected: 'rust' },
      { input: 'Java', expected: 'java' },
    ];
    for (const { input, expected } of languages) {
      const rac = resolveFromExplicit(
        { explicit: true, intent: 'gen-code-sys' },
        { language: input },
      );
      expect(rac.tech.language).toBe(expected);
    }
  });

  it('tech.framework reflects codebaseProfile', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'gen-sys-fe' },
      { language: 'TypeScript', framework: 'Next.js' },
    );
    expect(rac.tech.framework).toBe('nextjs');
  });

  it('intent-derived environment takes priority over fallbackHints', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'gen-sys-be' },
      { language: 'TypeScript' },
      { designDocPath: 'fe-system-main.md' },
    );
    expect(rac.tech.environment).toBe('backend');
  });

  it('fallbackHints used when intent has no environment', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'gen-code-sys' },
      { language: 'TypeScript' },
      { designDocPath: 'be-system-main.md' },
    );
    expect(rac.tech.environment).toBe('backend');
  });
});

// ============================================
// 2B. resolveFromInfer — DetectionReport variations
// ============================================

describe('Audit 2B: resolveFromInfer — detection report variations', () => {
  const baseReport: DetectionReport = {
    detectedMode: 'generate',
    detectedModeReasoning: 'test',
    sourceJob: 'design',
  };

  const DETECTION_SCENARIOS: Array<{
    name: string;
    report: DetectionReport;
    expectedEnv?: string;
    expectedLang?: string;
  }> = [
    {
      name: 'frontend + TypeScript',
      report: { ...baseReport, environment: 'frontend' as JobEnvironment, profile: { language: 'TypeScript' } },
      expectedEnv: 'frontend',
      expectedLang: 'typescript',
    },
    {
      name: 'backend + Go',
      report: { ...baseReport, environment: 'backend' as JobEnvironment, sourceJob: 'code', profile: { language: 'Go' } },
      expectedEnv: 'backend',
      expectedLang: 'go',
    },
    {
      name: 'fullstack + TypeScript',
      report: { ...baseReport, environment: 'fullstack' as JobEnvironment, profile: { language: 'TypeScript', framework: 'Next.js' } },
      expectedEnv: 'fullstack',
      expectedLang: 'typescript',
    },
    {
      name: 'unknown environment → undefined',
      report: { ...baseReport, environment: 'unknown' as JobEnvironment, profile: { language: 'TypeScript' } },
      expectedEnv: undefined,
      expectedLang: 'typescript',
    },
    {
      name: 'no environment → undefined',
      report: { ...baseReport },
      expectedEnv: undefined,
    },
  ];

  for (const { name, report, expectedEnv, expectedLang } of DETECTION_SCENARIOS) {
    describe(name, () => {
      it('source is always infer', () => {
        const rac = resolveFromInfer(report);
        expect(rac.source).toBe('infer');
      });

      it('intentDescription is always undefined (infer path)', () => {
        const rac = resolveFromInfer(report);
        expect(rac.intentDescription).toBeUndefined();
      });

      it('intent is always undefined (infer path)', () => {
        const rac = resolveFromInfer(report);
        expect(rac.intent).toBeUndefined();
      });

      if (expectedEnv !== undefined) {
        it(`tech.environment = ${expectedEnv}`, () => {
          const rac = resolveFromInfer(report);
          expect(rac.tech.environment).toBe(expectedEnv);
        });
      } else {
        it('tech.environment is undefined', () => {
          const rac = resolveFromInfer(report);
          expect(rac.tech.environment).toBeUndefined();
        });
      }

      if (expectedLang) {
        it(`tech.language = ${expectedLang}`, () => {
          const rac = resolveFromInfer(report);
          expect(rac.tech.language).toBe(expectedLang);
        });
      }
    });
  }

  describe('hasExplicitFields reflects actionMetadata presence', () => {
    it('true when actionMetadata has refs', () => {
      const rac = resolveFromInfer(baseReport, { refs: ['a.md'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('true when actionMetadata has target', () => {
      const rac = resolveFromInfer(baseReport, { target: ['src/main.ts'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('true when actionMetadata has context', () => {
      const rac = resolveFromInfer(baseReport, { context: ['notes.md'] });
      expect(rac.hasExplicitFields).toBe(true);
    });

    it('false when no actionMetadata', () => {
      const rac = resolveFromInfer(baseReport);
      expect(rac.hasExplicitFields).toBe(false);
    });

    it('false when actionMetadata has only empty arrays', () => {
      const rac = resolveFromInfer(baseReport, { refs: [], target: [], context: [] });
      expect(rac.hasExplicitFields).toBe(false);
    });
  });

  describe('codebaseProfile takes priority over report.profile', () => {
    it('codebaseProfile.language wins', () => {
      const report: DetectionReport = {
        ...baseReport,
        sourceJob: 'code',
        profile: { language: 'Python' },
      };
      const rac = resolveFromInfer(report, undefined, { language: 'Go' });
      expect(rac.tech.language).toBe('go');
    });

    it('falls back to report.profile when no codebaseProfile', () => {
      const report: DetectionReport = {
        ...baseReport,
        sourceJob: 'code',
        profile: { language: 'Python' },
      };
      const rac = resolveFromInfer(report);
      expect(rac.tech.language).toBe('python');
    });
  });

  describe('mode variations', () => {
    const modes: Mode[] = ['generate', 'refactor', 'explain'];
    for (const mode of modes) {
      it(`mode=${mode} passes through`, () => {
        const rac = resolveFromInfer({ ...baseReport, detectedMode: mode });
        expect(rac.mode).toBe(mode);
      });
    }
  });

  describe('intentGroup and domain pass through', () => {
    const intentGroups: Array<IntentGroup | undefined> = ['design-ui', 'design-system', 'design-spec', undefined];
    for (const ig of intentGroups) {
      it(`intentGroup=${ig}`, () => {
        const rac = resolveFromInfer({ ...baseReport, detectedIntentGroup: ig });
        expect(rac.intentGroup).toBe(ig);
      });
    }

    it('domain=game', () => {
      const rac = resolveFromInfer({ ...baseReport, domain: 'game' });
      expect(rac.domain).toBe('game');
    });

    it('domain=service', () => {
      const rac = resolveFromInfer({ ...baseReport, domain: 'service' });
      expect(rac.domain).toBe('service');
    });
  });

  describe('fallbackHints for environment', () => {
    it('used when report has no environment', () => {
      const rac = resolveFromInfer(
        baseReport, undefined,
        { language: 'TypeScript' },
        { designDocPath: 'fe-system-main.md' },
      );
      expect(rac.tech.environment).toBe('frontend');
    });

    it('report environment takes priority', () => {
      const rac = resolveFromInfer(
        { ...baseReport, environment: 'backend' },
        undefined,
        { language: 'TypeScript' },
        { designDocPath: 'fe-system-main.md' },
      );
      expect(rac.tech.environment).toBe('backend');
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
    environment?: string;
  }> = [
    { intent: 'gen-plan', mode: 'generate', agent: 'planner', jobType: 'plan' },
    { intent: 'rev-plan', mode: 'refactor', agent: 'planner', jobType: 'plan' },
    { intent: 'explain-plan', mode: 'explain', agent: 'planner', jobType: 'plan' },
    { intent: 'gen-sys-fe', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system', environment: 'frontend' },
    { intent: 'gen-sys-be', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system', environment: 'backend' },
    { intent: 'gen-sys-full', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-system', environment: 'fullstack' },
    { intent: 'rev-sys', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'explain-sys', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-system' },
    { intent: 'gen-ui-figma', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'gen-ui-ref', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'gen-ui-desc', mode: 'generate', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'rev-ui', mode: 'refactor', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
    { intent: 'explain-ui', mode: 'explain', agent: 'architect', jobType: 'design', intentGroup: 'design-ui' },
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
      const derived = deriveFromIntent(expected.intent);
      expect(derived.mode).toBe(expected.mode);
      expect(derived.agent).toBe(expected.agent);
      expect(derived.jobType).toBe(expected.jobType);
      if (expected.intentGroup) {
        expect(derived.intentGroup).toBe(expected.intentGroup);
      }
      if (expected.environment) {
        expect(derived.environment).toBe(expected.environment);
      } else {
        expect(derived.environment).toBeUndefined();
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
    const derived = deriveFromIntent('nonexistent-intent');
    expect(derived.mode).toBe('generate');
    expect(derived.agent).toBe('architect');
    expect(derived.jobType).toBe('design');
  });
});
