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
  Basis,
  JobMode,
  JobEnvironment,
  DesignWorkType,
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
      expect(rac.jobMode).toBe(derived.jobMode);
      expect(rac.workType).toBe(derived.workType);

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
    const codeIntents = INTENT_DEFINITIONS.filter(d => d.actionId === 'code');
    for (const def of codeIntents) {
      const derived = deriveFromIntent(def.id);
      expect(derived.environment).toBeUndefined();
    }
  });

  it('all system-design create intents have derived environment', () => {
    const envIntents = ['create-fe', 'create-be', 'create-fullstack'];
    for (const id of envIntents) {
      const derived = deriveFromIntent(id);
      expect(derived.environment).toBeDefined();
    }
  });

  it('revise-system has no derived environment', () => {
    const derived = deriveFromIntent('revise-system');
    expect(derived.environment).toBeUndefined();
  });

  it('all ui-design intents have no derived environment (it is implicit frontend)', () => {
    const uiIntents = INTENT_DEFINITIONS.filter(d => d.actionId === 'ui-design');
    for (const def of uiIntents) {
      const derived = deriveFromIntent(def.id);
      expect(derived.environment).toBeUndefined();
    }
  });

  it('basis + refs + context propagate to RAC', () => {
    const allBases: Basis[] = ['prd', 'directive', 'existing-doc', 'figma', 'references', 'spec', 'design-doc'];
    for (const basis of allBases) {
      const metadata: ActionMetadata = {
        explicit: true,
        intent: 'create-code',
        basis,
        refs: ['ref1.md'],
        context: ['ctx1.md'],
        target: ['src/main.ts'],
      };
      const rac = resolveFromExplicit(metadata);
      expect(rac.basis).toBe(basis);
      expect(rac.refs).toEqual(['ref1.md']);
      expect(rac.context).toEqual(['ctx1.md']);
      expect(rac.target).toEqual(['src/main.ts']);
      expect(rac.basisDescription).toBeDefined();
      expect(rac.basisDescription!.length).toBeGreaterThan(0);
    }
  });

  it('documents are NOT populated by resolveFromExplicit', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'create-code',
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
        { explicit: true, intent: 'create-code' },
        { language: input },
      );
      expect(rac.tech.language).toBe(expected);
    }
  });

  it('tech.framework reflects codebaseProfile', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'create-fe' },
      { language: 'TypeScript', framework: 'Next.js' },
    );
    expect(rac.tech.framework).toBe('nextjs');
  });

  it('intent-derived environment takes priority over fallbackHints', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'create-be' },
      { language: 'TypeScript' },
      { designDocPath: 'fe-system-main.md' },
    );
    expect(rac.tech.environment).toBe('backend');
  });

  it('fallbackHints used when intent has no environment', () => {
    const rac = resolveFromExplicit(
      { explicit: true, intent: 'create-code' },
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
    jobMode: 'generate',
    jobModeReasoning: 'test',
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
    it('true when actionMetadata has basis', () => {
      const rac = resolveFromInfer(baseReport, { basis: 'prd' });
      expect(rac.hasExplicitFields).toBe(true);
      expect(rac.basisDescription).toBeDefined();
    });

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

  describe('jobMode variations', () => {
    const modes: JobMode[] = ['generate', 'refactor', 'explain'];
    for (const mode of modes) {
      it(`jobMode=${mode} passes through`, () => {
        const rac = resolveFromInfer({ ...baseReport, jobMode: mode });
        expect(rac.jobMode).toBe(mode);
      });
    }
  });

  describe('workType and domain pass through', () => {
    const workTypes: Array<DesignWorkType | undefined> = ['ui-design', 'system-design', 'spec', undefined];
    for (const wt of workTypes) {
      it(`workType=${wt}`, () => {
        const rac = resolveFromInfer({ ...baseReport, workType: wt });
        expect(rac.workType).toBe(wt);
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
    jobMode: JobMode;
    agent: string;
    jobType: string;
    workType?: DesignWorkType;
    environment?: string;
  }> = [
    { intent: 'create-plan', jobMode: 'generate', agent: 'planner', jobType: 'plan' },
    { intent: 'revise-plan', jobMode: 'refactor', agent: 'planner', jobType: 'plan' },
    { intent: 'create-fe', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'system-design', environment: 'frontend' },
    { intent: 'create-be', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'system-design', environment: 'backend' },
    { intent: 'create-fullstack', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'system-design', environment: 'fullstack' },
    { intent: 'revise-system', jobMode: 'refactor', agent: 'architect', jobType: 'design', workType: 'system-design' },
    { intent: 'create-figma', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'ui-design' },
    { intent: 'create-ref', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'ui-design' },
    { intent: 'create-desc', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'ui-design' },
    { intent: 'revise-ui', jobMode: 'refactor', agent: 'architect', jobType: 'design', workType: 'ui-design' },
    { intent: 'create-spec', jobMode: 'generate', agent: 'architect', jobType: 'design', workType: 'spec' },
    { intent: 'revise-spec', jobMode: 'refactor', agent: 'architect', jobType: 'design', workType: 'spec' },
    { intent: 'create-code', jobMode: 'generate', agent: 'architect', jobType: 'code' },
    { intent: 'refactor-code', jobMode: 'refactor', agent: 'architect', jobType: 'code' },
    { intent: 'create-visual', jobMode: 'generate', agent: 'creator', jobType: 'visual' },
    { intent: 'create-learn', jobMode: 'generate', agent: 'architect', jobType: 'learn' },
  ];

  for (const expected of EXPECTED_DERIVATIONS) {
    it(`${expected.intent} → jobMode=${expected.jobMode}, agent=${expected.agent}, jobType=${expected.jobType}`, () => {
      const derived = deriveFromIntent(expected.intent);
      expect(derived.jobMode).toBe(expected.jobMode);
      expect(derived.agent).toBe(expected.agent);
      expect(derived.jobType).toBe(expected.jobType);
      if (expected.workType) {
        expect(derived.workType).toBe(expected.workType);
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
    expect(derived.jobMode).toBe('generate');
    expect(derived.agent).toBe('architect');
    expect(derived.jobType).toBe('design');
  });
});
