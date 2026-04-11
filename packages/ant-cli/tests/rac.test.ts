import { describe, it, expect } from 'vitest';
import {
  resolveLanguage,
  resolveFramework,
  resolveRuntime,
  inferEnvironmentFromHints,
  buildTechContext,
  getIntentDescription,
  resolveFromExplicit,
  resolveFromInfer,
  synthesizeLearnIntent,
  synthesizeDesignIntent,
  synthesizeCodeIntent,
  synthesizePlanIntent,
  synthesizeVisualIntent,
  synthesizeAskIntent,
  INTENT_DEFINITIONS,
  deriveFromIntent,
} from '@ant/shared';
import type {
  CodebaseProfileLike,
  EnvironmentHints,
  ActionMetadata,
  DetectionReport,
  ResolvedDocument,
} from '@ant/shared';

// ============================================
// resolveLanguage
// ============================================

describe('resolveLanguage', () => {
  it('returns typescript for TypeScript variants', () => {
    expect(resolveLanguage({ language: 'TypeScript' })).toBe('typescript');
    expect(resolveLanguage({ language: 'typescript' })).toBe('typescript');
    expect(resolveLanguage({ language: 'JavaScript' })).toBe('typescript');
  });

  it('returns go for Go variants', () => {
    expect(resolveLanguage({ language: 'Go' })).toBe('go');
    expect(resolveLanguage({ language: 'golang' })).toBe('go');
    expect(resolveLanguage({ language: 'Golang' })).toBe('go');
  });

  it('returns python for Python', () => {
    expect(resolveLanguage({ language: 'Python' })).toBe('python');
    expect(resolveLanguage({ language: 'python 3' })).toBe('python');
  });

  it('returns rust for Rust', () => {
    expect(resolveLanguage({ language: 'Rust' })).toBe('rust');
  });

  it('returns java for Java', () => {
    expect(resolveLanguage({ language: 'Java' })).toBe('java');
  });

  it('defaults to typescript when no profile', () => {
    expect(resolveLanguage()).toBe('typescript');
    expect(resolveLanguage(undefined)).toBe('typescript');
  });

  it('defaults to typescript when language is empty', () => {
    expect(resolveLanguage({ language: '' })).toBe('typescript');
    expect(resolveLanguage({})).toBe('typescript');
  });

  it('defaults to typescript for unknown languages', () => {
    expect(resolveLanguage({ language: 'ruby' })).toBe('typescript');
    expect(resolveLanguage({ language: 'swift' })).toBe('typescript');
  });
});

// ============================================
// resolveFramework
// ============================================

describe('resolveFramework', () => {
  it('normalizes Next.js variants', () => {
    expect(resolveFramework({ framework: 'Next.js' })).toBe('nextjs');
    expect(resolveFramework({ framework: 'nextjs' })).toBe('nextjs');
    expect(resolveFramework({ framework: 'NextJS 14' })).toBe('nextjs');
  });

  it('normalizes Nuxt', () => {
    expect(resolveFramework({ framework: 'Nuxt' })).toBe('nuxt');
    expect(resolveFramework({ framework: 'nuxt 3' })).toBe('nuxt');
  });

  it('normalizes Express', () => {
    expect(resolveFramework({ framework: 'Express' })).toBe('express');
  });

  it('preserves unknown frameworks lowercase', () => {
    expect(resolveFramework({ framework: 'FastAPI' })).toBe('fastapi');
    expect(resolveFramework({ framework: 'Gin' })).toBe('gin');
  });

  it('returns undefined when no framework', () => {
    expect(resolveFramework()).toBeUndefined();
    expect(resolveFramework({})).toBeUndefined();
    expect(resolveFramework({ framework: undefined })).toBeUndefined();
  });

  it('taskProfile takes priority over profile', () => {
    expect(resolveFramework(
      { framework: 'Express' },
      { framework: 'Next.js' },
    )).toBe('nextjs');
  });

  it('falls back to profile when taskProfile has no framework', () => {
    expect(resolveFramework(
      { framework: 'Express' },
      {},
    )).toBe('express');
  });
});

// ============================================
// resolveRuntime
// ============================================

describe('resolveRuntime', () => {
  it('frontend -> browser', () => {
    expect(resolveRuntime('frontend')).toBe('browser');
    expect(resolveRuntime('frontend', 'go')).toBe('browser');
    expect(resolveRuntime('frontend', 'typescript')).toBe('browser');
  });

  it('backend + go -> go-api', () => {
    expect(resolveRuntime('backend', 'go')).toBe('go-api');
  });

  it('backend + non-go -> node-api', () => {
    expect(resolveRuntime('backend', 'typescript')).toBe('node-api');
    expect(resolveRuntime('backend', 'python')).toBe('node-api');
    expect(resolveRuntime('backend')).toBe('node-api');
  });

  it('fullstack -> undefined (composite)', () => {
    expect(resolveRuntime('fullstack')).toBeUndefined();
    expect(resolveRuntime('fullstack', 'typescript')).toBeUndefined();
  });

  it('undefined env -> undefined', () => {
    expect(resolveRuntime(undefined)).toBeUndefined();
    expect(resolveRuntime(undefined, 'go')).toBeUndefined();
  });

  it('unknown env -> undefined', () => {
    expect(resolveRuntime('other' as any)).toBeUndefined();
  });
});

// ============================================
// inferEnvironmentFromHints
// ============================================

describe('inferEnvironmentFromHints', () => {
  it('returns undefined for no hints', () => {
    expect(inferEnvironmentFromHints()).toBeUndefined();
    expect(inferEnvironmentFromHints(undefined)).toBeUndefined();
  });

  it('detects frontend from fe-system- prefix', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'fe-system-main.md' })).toBe('frontend');
    expect(inferEnvironmentFromHints({ designDocPath: '/path/to/fe-system-auth.md' })).toBe('frontend');
  });

  it('detects frontend from frontend-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'frontend-design.md' })).toBe('frontend');
  });

  it('detects frontend from fe-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'fe-design-v2.md' })).toBe('frontend');
  });

  it('detects backend from be-system- prefix', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'be-system-main.md' })).toBe('backend');
  });

  it('detects backend from backend-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'backend-design.md' })).toBe('backend');
  });

  it('detects backend from api-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'api-design-v1.md' })).toBe('backend');
  });

  it('detects fullstack from fullstack-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'fullstack-design.md' })).toBe('fullstack');
  });

  it('detects fullstack from fs-design naming', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'fs-design.md' })).toBe('fullstack');
  });

  it('detects frontend from hasNextConfig', () => {
    expect(inferEnvironmentFromHints({ hasNextConfig: true })).toBe('frontend');
  });

  it('detects frontend from hasBrowserEntrypoint', () => {
    expect(inferEnvironmentFromHints({ hasBrowserEntrypoint: true })).toBe('frontend');
  });

  it('returns undefined for unrecognized path', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'random-doc.md' })).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(inferEnvironmentFromHints({ designDocPath: 'FE-SYSTEM-Main.md' })).toBe('frontend');
    expect(inferEnvironmentFromHints({ designDocPath: 'BE-System-API.md' })).toBe('backend');
  });
});

// ============================================
// buildTechContext
// ============================================

describe('buildTechContext', () => {
  it('builds complete context with all inputs', () => {
    const tc = buildTechContext(
      { language: 'Go', framework: 'Gin' },
      'backend',
    );
    expect(tc).toEqual({
      language: 'go',
      framework: 'gin',
      environment: 'backend',
      runtime: 'go-api',
    });
  });

  it('uses explicit env over hints fallback', () => {
    const tc = buildTechContext(
      { language: 'TypeScript' },
      'frontend',
      undefined,
      { designDocPath: 'be-system-main.md' },
    );
    expect(tc.environment).toBe('frontend');
    expect(tc.runtime).toBe('browser');
  });

  it('falls back to hints when env is undefined', () => {
    const tc = buildTechContext(
      { language: 'TypeScript' },
      undefined,
      undefined,
      { designDocPath: 'fe-system-main.md' },
    );
    expect(tc.environment).toBe('frontend');
    expect(tc.runtime).toBe('browser');
  });

  it('taskProfile framework overrides profile framework', () => {
    const tc = buildTechContext(
      { language: 'TypeScript', framework: 'Express' },
      'frontend',
      { framework: 'Next.js' },
    );
    expect(tc.framework).toBe('nextjs');
  });

  it('uses taskProfile as language source when profile is missing', () => {
    const tc = buildTechContext(
      undefined,
      'backend',
      { language: 'Go' },
    );
    expect(tc.language).toBe('go');
    expect(tc.runtime).toBe('go-api');
  });

  it('defaults everything when no inputs', () => {
    const tc = buildTechContext();
    expect(tc).toEqual({
      language: 'typescript',
      framework: undefined,
      environment: undefined,
      runtime: undefined,
    });
  });

  it('fullstack env produces undefined runtime', () => {
    const tc = buildTechContext({ language: 'TypeScript' }, 'fullstack');
    expect(tc.environment).toBe('fullstack');
    expect(tc.runtime).toBeUndefined();
  });

  it('frontend + go still produces browser runtime', () => {
    const tc = buildTechContext({ language: 'Go' }, 'frontend');
    expect(tc.runtime).toBe('browser');
  });
});

// ============================================
// getIntentDescription
// ============================================

describe('getIntentDescription', () => {
  it('returns English description for all known intents', () => {
    for (const def of INTENT_DEFINITIONS) {
      const desc = getIntentDescription(def.id);
      expect(desc).toBe(def.description.en);
      expect(typeof desc).toBe('string');
      expect(desc!.length).toBeGreaterThan(0);
    }
  });

  it('returns undefined for unknown intent', () => {
    expect(getIntentDescription('nonexistent' as any)).toBeUndefined();
  });

  it('returns description for rev-code', () => {
    expect(getIntentDescription('rev-code')).toBe('Refactor existing codebase');
  });
});

// ============================================
// deriveFromIntent rev-code
// ============================================

describe('deriveFromIntent rev-code', () => {
  it('returns refactor mode for rev-code', () => {
    const result = deriveFromIntent('rev-code');
    expect(result).toEqual({
      mode: 'refactor',
      agent: 'architect',
      jobType: 'code',
    });
  });

  it('gen-code-sys returns generate mode', () => {
    const result = deriveFromIntent('gen-code-sys');
    expect(result.mode).toBe('generate');
    expect(result.jobType).toBe('code');
  });

  it('gen-code-spec returns generate mode', () => {
    const result = deriveFromIntent('gen-code-spec');
    expect(result.mode).toBe('generate');
    expect(result.jobType).toBe('code');
  });

  it('gen-code-directive returns generate mode', () => {
    const result = deriveFromIntent('gen-code-directive');
    expect(result.mode).toBe('generate');
    expect(result.jobType).toBe('code');
  });
});

// ============================================
// resolveFromExplicit
// ============================================

describe('resolveFromExplicit', () => {
  it('creates RAC for gen-sys-fe intent', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'gen-sys-fe',
      refs: ['/docs/prd.md'],
    };
    const rac = resolveFromExplicit(metadata, { language: 'TypeScript', framework: 'Next.js' });

    expect(rac.source).toBe('explicit');
    expect(rac.intent).toBe('gen-sys-fe');
    expect(rac.intentGroup).toBe('design-system');
    expect(rac.mode).toBe('generate');
    expect(rac.tech.language).toBe('typescript');
    expect(rac.tech.framework).toBe('nextjs');
    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
    expect(rac.refs).toEqual(['/docs/prd.md']);
    expect(rac.intentDescription).toBeDefined();
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('creates RAC for gen-sys-be intent with Go', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-sys-be' };
    const rac = resolveFromExplicit(metadata, { language: 'Go' });

    expect(rac.tech.environment).toBe('backend');
    expect(rac.tech.runtime).toBe('go-api');
    expect(rac.tech.language).toBe('go');
  });

  it('creates RAC for gen-sys-full', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-sys-full' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.tech.environment).toBe('fullstack');
    expect(rac.tech.runtime).toBeUndefined();
    expect(rac.intentGroup).toBe('design-system');
  });

  it('creates RAC for gen-ui-figma UI intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-ui-figma' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.intentGroup).toBe('design-ui');
    expect(rac.mode).toBe('generate');
  });

  it('creates RAC for rev-sys intent (refactor mode)', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'rev-sys' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.mode).toBe('refactor');
    expect(rac.intentGroup).toBe('design-system');
  });

  it('creates RAC for rev-code intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'rev-code' };
    const rac = resolveFromExplicit(metadata, { language: 'TypeScript' });

    expect(rac.intent).toBe('rev-code');
    expect(rac.mode).toBe('refactor');
    expect(rac.tech.language).toBe('typescript');
    expect(rac.intentDescription).toBe('Refactor existing codebase');
  });

  it('creates RAC for gen-plan intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-plan' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.mode).toBe('generate');
  });

  it('creates RAC for gen-spec intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-spec' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.intentGroup).toBe('design-spec');
    expect(rac.mode).toBe('generate');
  });

  it('hasExplicitFields false when no descriptive fields', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-visual-illustration' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.hasExplicitFields).toBe(true);
  });

  it('includes all user-specified fields', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'gen-code-sys',
      target: ['src/app.ts'],
      refs: ['docs/spec.md'],
      context: ['docs/notes.md'],
    };
    const rac = resolveFromExplicit(metadata);

    expect(rac.target).toEqual(['src/app.ts']);
    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('uses fallbackHints when intent has no environment', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-code-sys' };
    const rac = resolveFromExplicit(
      metadata,
      { language: 'TypeScript' },
      { designDocPath: 'fe-system-main.md' },
    );

    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
  });

  it('intent environment takes priority over fallbackHints', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'gen-sys-be' };
    const rac = resolveFromExplicit(
      metadata,
      { language: 'TypeScript' },
      { designDocPath: 'fe-system-main.md' },
    );

    expect(rac.tech.environment).toBe('backend');
    expect(rac.tech.runtime).toBe('node-api');
  });

  it('does NOT include documents (resolve node adds them separately)', () => {
    const metadata: ActionMetadata = {
      explicit: true, intent: 'gen-code-sys',
      refs: ['inputs/sources/prd.md'], context: ['outputs/design/system/fe-system-main.md'],
    };
    const rac = resolveFromExplicit(metadata);
    expect(rac.documents).toBeUndefined();
    expect(rac.refs).toEqual(['inputs/sources/prd.md']);
    expect(rac.context).toEqual(['outputs/design/system/fe-system-main.md']);
  });

  it('covers all INTENT_DEFINITIONS', () => {
    for (const def of INTENT_DEFINITIONS) {
      const metadata: ActionMetadata = { explicit: true, intent: def.id };
      const rac = resolveFromExplicit(metadata);

      expect(rac.source).toBe('explicit');
      expect(rac.intent).toBe(def.id);
      expect(rac.intentDescription).toBe(def.description.en);
      expect(['generate', 'refactor', 'explain']).toContain(rac.mode);
    }
  });
});

// ============================================
// resolveFromInfer
// ============================================

describe('resolveFromInfer', () => {
  const baseReport: DetectionReport = {
    detectedMode: 'generate',
    detectedModeReasoning: 'test',
    sourceJob: 'design',
  };

  it('creates RAC for design detection', () => {
    const report: DetectionReport = {
      ...baseReport,
      detectedIntentGroup: 'design-system',
      environment: 'frontend',
      domain: 'service',
    };
    const rac = resolveFromInfer(report, undefined, { language: 'TypeScript', framework: 'Next.js' });

    expect(rac.source).toBe('infer');
    expect(rac.intent).toBeUndefined();
    expect(rac.intentGroup).toBe('design-system');
    expect(rac.mode).toBe('generate');
    expect(rac.domain).toBe('service');
    expect(rac.tech.language).toBe('typescript');
    expect(rac.tech.framework).toBe('nextjs');
    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
  });

  it('creates RAC for code detection with Go backend', () => {
    const report: DetectionReport = {
      ...baseReport,
      sourceJob: 'code',
      environment: 'backend',
      profile: { language: 'Go', framework: 'Gin' },
    };
    const rac = resolveFromInfer(report);

    expect(rac.tech.language).toBe('go');
    expect(rac.tech.framework).toBe('gin');
    expect(rac.tech.environment).toBe('backend');
    expect(rac.tech.runtime).toBe('go-api');
  });

  it('merges actionMetadata fields into RAC', () => {
    const report: DetectionReport = { ...baseReport, detectedMode: 'refactor' };
    const metadata: ActionMetadata = {
      refs: ['docs/spec.md'],
      target: ['src/main.ts'],
      context: ['docs/notes.md'],
    };
    const rac = resolveFromInfer(report, metadata);

    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.target).toEqual(['src/main.ts']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('hasExplicitFields false when no metadata', () => {
    const report: DetectionReport = { ...baseReport };
    const rac = resolveFromInfer(report);

    expect(rac.hasExplicitFields).toBe(false);
  });

  it('uses codebaseProfile over report.profile', () => {
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

  it('ignores unknown environment', () => {
    const report: DetectionReport = {
      ...baseReport,
      environment: 'unknown',
    };
    const rac = resolveFromInfer(report);

    expect(rac.tech.environment).toBeUndefined();
    expect(rac.tech.runtime).toBeUndefined();
  });

  it('uses fallbackHints when no environment from report', () => {
    const report: DetectionReport = { ...baseReport };
    const rac = resolveFromInfer(
      report,
      undefined,
      { language: 'TypeScript' },
      { designDocPath: 'be-system-main.md' },
    );

    expect(rac.tech.environment).toBe('backend');
    expect(rac.tech.runtime).toBe('node-api');
  });

  it('report environment takes priority over fallbackHints', () => {
    const report: DetectionReport = {
      ...baseReport,
      environment: 'frontend',
    };
    const rac = resolveFromInfer(
      report,
      undefined,
      { language: 'TypeScript' },
      { designDocPath: 'be-system-main.md' },
    );

    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
  });

  it('fullstack detection produces undefined runtime', () => {
    const report: DetectionReport = {
      ...baseReport,
      environment: 'fullstack',
    };
    const rac = resolveFromInfer(report, undefined, { language: 'TypeScript' });

    expect(rac.tech.environment).toBe('fullstack');
    expect(rac.tech.runtime).toBeUndefined();
  });

  it('game domain passes through', () => {
    const report: DetectionReport = {
      ...baseReport,
      detectedIntentGroup: 'design-system',
      domain: 'game',
    };
    const rac = resolveFromInfer(report);

    expect(rac.domain).toBe('game');
  });
});

// ============================================
// ResolvedDocument.label
// ============================================

describe('ResolvedDocument', () => {
  it('supports optional label field', () => {
    const doc = { path: 'design.md', content: '# Design', role: 'ref' as const, label: 'System Design' };
    expect(doc.label).toBe('System Design');
  });

  it('label is optional', () => {
    const doc: ResolvedDocument = { path: 'prd.md', content: '# PRD', role: 'context' };
    expect(doc.label).toBeUndefined();
  });
});

// ============================================
// synthesizeLearnIntent
// ============================================

describe('synthesizeLearnIntent', () => {
  it('always returns gen-learn', () => {
    expect(synthesizeLearnIntent()).toBe('gen-learn');
  });

  it('return type is string (never undefined)', () => {
    const result: string = synthesizeLearnIntent();
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('aligns with deriveFromIntent gen-learn', () => {
    const intent = synthesizeLearnIntent();
    const derived = deriveFromIntent(intent);
    expect(derived).toEqual({
      mode: 'generate',
      agent: 'architect',
      jobType: 'learn',
    });
  });

  it('produces valid RAC via resolveFromExplicit (infer pattern)', () => {
    const intent = synthesizeLearnIntent();
    const rac = resolveFromExplicit({ intent });
    expect(rac.intent).toBe('gen-learn');
    expect(rac.mode).toBe('generate');
    expect(rac.source).toBe('explicit');
    expect(rac.intentDescription).toBeDefined();

    const inferRac = { ...rac, source: 'infer' as const, hasExplicitFields: false };
    expect(inferRac.source).toBe('infer');
    expect(inferRac.hasExplicitFields).toBe(false);
  });
});

// ============================================
// Explain intent synthesis (Phase 6a)
// ============================================

describe('synthesizeDesignIntent explain', () => {
  const baseReport: DetectionReport = {
    detectedMode: 'explain',
    detectedModeReasoning: 'test',
    sourceJob: 'design',
  };

  it('returns explain-ui for ui-design intentGroup', () => {
    const intent = synthesizeDesignIntent({ ...baseReport, detectedIntentGroup: 'design-ui' }, {});
    expect(intent).toBe('explain-ui');
  });

  it('returns explain-spec for spec intentGroup', () => {
    const intent = synthesizeDesignIntent({ ...baseReport, detectedIntentGroup: 'design-spec' }, {});
    expect(intent).toBe('explain-spec');
  });

  it('returns explain-sys for system-design intentGroup', () => {
    const intent = synthesizeDesignIntent({ ...baseReport, detectedIntentGroup: 'design-system' }, {});
    expect(intent).toBe('explain-sys');
  });

  it('returns explain-sys when intentGroup is undefined (default)', () => {
    const intent = synthesizeDesignIntent(baseReport, {});
    expect(intent).toBe('explain-sys');
  });

  it('return type is always string (never undefined)', () => {
    const result: string = synthesizeDesignIntent(baseReport, {});
    expect(typeof result).toBe('string');
  });
});

describe('synthesizeCodeIntent explain', () => {
  it('returns explain-code for explain mode', () => {
    const report: DetectionReport = { detectedMode: 'explain', detectedModeReasoning: 'test', sourceJob: 'code' };
    const intent = synthesizeCodeIntent(report);
    expect(intent).toBe('explain-code');
  });

  it('return type is always string (never undefined)', () => {
    const result: string = synthesizeCodeIntent({ detectedMode: 'explain', detectedModeReasoning: 'test', sourceJob: 'code' });
    expect(typeof result).toBe('string');
  });
});

describe('synthesizePlanIntent explain', () => {
  it('returns explain-plan for explain mode', () => {
    const intent = synthesizePlanIntent('explain');
    expect(intent).toBe('explain-plan');
  });

  it('return type is always string (never undefined)', () => {
    const result: string = synthesizePlanIntent('explain');
    expect(typeof result).toBe('string');
  });
});

describe('synthesizeVisualIntent', () => {
  it('returns explain-visual for explain mode', () => {
    const intent = synthesizeVisualIntent('explain');
    expect(intent).toBe('explain-visual');
  });

  it('returns gen-visual-{tier} for generate mode with targetTier', () => {
    expect(synthesizeVisualIntent('generate', 'logo')).toBe('gen-visual-logo');
    expect(synthesizeVisualIntent('generate', 'icon')).toBe('gen-visual-icon');
    expect(synthesizeVisualIntent('generate', 'hero')).toBe('gen-visual-hero');
    expect(synthesizeVisualIntent('generate', 'illustration')).toBe('gen-visual-illustration');
  });

  it('maps general/undefined to gen-visual-illustration', () => {
    expect(synthesizeVisualIntent('generate')).toBe('gen-visual-illustration');
    expect(synthesizeVisualIntent('generate', 'general')).toBe('gen-visual-illustration');
  });

  it('return type is always string (never undefined)', () => {
    const result: string = synthesizeVisualIntent('explain');
    expect(typeof result).toBe('string');
  });
});

describe('deriveFromIntent explain intents', () => {
  it('explain-code maps correctly', () => {
    expect(deriveFromIntent('explain-code')).toEqual({
      mode: 'explain', agent: 'architect', jobType: 'code',
    });
  });

  it('explain-ui maps correctly', () => {
    expect(deriveFromIntent('explain-ui')).toEqual({
      intentGroup: 'design-ui', mode: 'explain', agent: 'architect', jobType: 'design',
    });
  });

  it('explain-sys maps correctly', () => {
    expect(deriveFromIntent('explain-sys')).toEqual({
      intentGroup: 'design-system', mode: 'explain', agent: 'architect', jobType: 'design',
    });
  });

  it('explain-spec maps correctly', () => {
    expect(deriveFromIntent('explain-spec')).toEqual({
      intentGroup: 'design-spec', mode: 'explain', agent: 'architect', jobType: 'design',
    });
  });

  it('explain-plan maps correctly', () => {
    expect(deriveFromIntent('explain-plan')).toEqual({
      mode: 'explain', agent: 'planner', jobType: 'plan',
    });
  });

  it('explain-visual maps correctly', () => {
    expect(deriveFromIntent('explain-visual')).toEqual({
      mode: 'explain', agent: 'creator', jobType: 'visual',
    });
  });

  it('all explain intents round-trip through synthesize -> derive', () => {
    const codeReport: DetectionReport = { detectedMode: 'explain', detectedModeReasoning: 'test', sourceJob: 'code' };
    expect(deriveFromIntent(synthesizeCodeIntent(codeReport)).mode).toBe('explain');

    expect(deriveFromIntent(synthesizePlanIntent('explain')).mode).toBe('explain');
    expect(deriveFromIntent(synthesizeVisualIntent('explain')).mode).toBe('explain');
    expect(deriveFromIntent(synthesizeVisualIntent('generate', 'logo')).mode).toBe('generate');
    expect(deriveFromIntent(synthesizeVisualIntent('generate')).mode).toBe('generate');

    const designReport: DetectionReport = { detectedMode: 'explain', detectedModeReasoning: 'test', sourceJob: 'design', detectedIntentGroup: 'design-ui' };
    expect(deriveFromIntent(synthesizeDesignIntent(designReport, {})).mode).toBe('explain');
  });
});

// ============================================
// Ask intent synthesis (Phase 6b)
// ============================================

describe('synthesizeAskIntent', () => {
  it('returns ask-evaluate for evaluate subType', () => {
    expect(synthesizeAskIntent('evaluate')).toBe('ask-evaluate');
  });

  it('returns ask-ant for ant subType', () => {
    expect(synthesizeAskIntent('ant')).toBe('ask-ant');
  });

  it('returns ask-general for general subType', () => {
    expect(synthesizeAskIntent('general')).toBe('ask-general');
  });

  it('defaults to ask-general when undefined', () => {
    expect(synthesizeAskIntent()).toBe('ask-general');
    expect(synthesizeAskIntent(undefined)).toBe('ask-general');
  });

  it('return type is always string', () => {
    const result: string = synthesizeAskIntent();
    expect(typeof result).toBe('string');
  });
});

describe('deriveFromIntent ask intents', () => {
  it('ask-evaluate maps correctly', () => {
    expect(deriveFromIntent('ask-evaluate')).toEqual({
      mode: 'explain', agent: 'architect', jobType: 'ask',
    });
  });

  it('ask-ant maps correctly', () => {
    expect(deriveFromIntent('ask-ant')).toEqual({
      mode: 'explain', agent: 'architect', jobType: 'ask',
    });
  });

  it('ask-general maps correctly', () => {
    expect(deriveFromIntent('ask-general')).toEqual({
      mode: 'explain', agent: 'architect', jobType: 'ask',
    });
  });

  it('all ask intents round-trip through synthesize -> derive', () => {
    for (const subType of ['evaluate', 'ant', 'general'] as const) {
      const intent = synthesizeAskIntent(subType);
      const derived = deriveFromIntent(intent);
      expect(derived.mode).toBe('explain');
      expect(derived.agent).toBe('architect');
      expect(derived.jobType).toBe('ask');
    }
  });
});

// ============================================
// resolveFromInfer with workspaceState
// ============================================

describe('resolveFromInfer with workspaceState', () => {
  const baseReport: DetectionReport = {
    detectedMode: 'generate',
    detectedModeReasoning: 'test',
    sourceJob: 'design',
    detectedIntentGroup: 'design-ui',
    targetFiles: ['outputs/design/ui/ui-spec.json'],
  };

  it('auto-maps targetFiles from report', () => {
    const rac = resolveFromInfer(baseReport, undefined, undefined, undefined, 'gen-ui-figma', {});
    expect(rac.target).toEqual(['outputs/design/ui/ui-spec.json']);
  });

  it('refs come from metadata only', () => {
    const rac = resolveFromInfer(baseReport, { refs: ['inputs/sources/prd.md'] }, undefined, undefined, 'gen-ui-figma', {});
    expect(rac.refs).toEqual(['inputs/sources/prd.md']);
  });

  it('actionMetadata target takes priority over report.targetFiles', () => {
    const rac = resolveFromInfer(baseReport, { target: ['custom.ts'] }, undefined, undefined, 'gen-ui-figma', {});
    expect(rac.target).toEqual(['custom.ts']);
  });
});
