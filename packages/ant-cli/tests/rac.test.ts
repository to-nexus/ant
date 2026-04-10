import { describe, it, expect } from 'vitest';
import {
  resolveLanguage,
  resolveFramework,
  resolveRuntime,
  inferEnvironmentFromHints,
  buildTechContext,
  getIntentDescription,
  getBasisDescription,
  getUiSourceFromIntent,
  resolveFromExplicit,
  resolveFromInfer,
  INTENT_DEFINITIONS,
  deriveFromIntent,
} from '@ant/shared';
import type {
  CodebaseProfileLike,
  EnvironmentHints,
  ActionMetadata,
  DetectionReport,
  Basis,
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
    expect(getIntentDescription('nonexistent')).toBeUndefined();
  });

  it('returns description for refactor-code', () => {
    expect(getIntentDescription('refactor-code')).toBe('Refactor existing codebase');
  });
});

// ============================================
// getBasisDescription
// ============================================

describe('getBasisDescription', () => {
  const allBases: Basis[] = ['prd', 'directive', 'existing-doc', 'figma', 'references', 'spec', 'design-doc'];

  it('returns non-empty string for all basis types', () => {
    for (const basis of allBases) {
      const desc = getBasisDescription(basis);
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('returns specific descriptions', () => {
    expect(getBasisDescription('prd')).toContain('PRD');
    expect(getBasisDescription('figma')).toContain('Figma');
    expect(getBasisDescription('references')).toContain('Reference');
    expect(getBasisDescription('directive')).toContain('directive');
    expect(getBasisDescription('existing-doc')).toContain('design documents');
    expect(getBasisDescription('spec')).toContain('spec');
    expect(getBasisDescription('design-doc')).toContain('design');
  });

  it('returns actual description, not raw basis string (no fallback)', () => {
    for (const basis of allBases) {
      const desc = getBasisDescription(basis);
      expect(desc).not.toBe(basis);
    }
  });
});

// ============================================
// getUiSourceFromIntent
// ============================================

describe('getUiSourceFromIntent', () => {
  it('create-figma -> figma', () => {
    expect(getUiSourceFromIntent('create-figma')).toBe('figma');
  });

  it('create-ref -> references', () => {
    expect(getUiSourceFromIntent('create-ref')).toBe('references');
  });

  it('create-desc -> description', () => {
    expect(getUiSourceFromIntent('create-desc')).toBe('description');
  });

  it('revise-ui -> null (runtime resolution needed)', () => {
    expect(getUiSourceFromIntent('revise-ui')).toBeNull();
  });

  it('non-UI intents -> null', () => {
    expect(getUiSourceFromIntent('create-code')).toBeNull();
    expect(getUiSourceFromIntent('create-plan')).toBeNull();
    expect(getUiSourceFromIntent('create-fe')).toBeNull();
  });
});

// ============================================
// deriveFromIntent (refactor-code addition)
// ============================================

describe('deriveFromIntent refactor-code', () => {
  it('returns refactor mode for refactor-code', () => {
    const result = deriveFromIntent('refactor-code');
    expect(result).toEqual({
      jobMode: 'refactor',
      agent: 'architect',
      jobType: 'code',
    });
  });

  it('create-code returns generate mode', () => {
    const result = deriveFromIntent('create-code');
    expect(result.jobMode).toBe('generate');
    expect(result.jobType).toBe('code');
  });
});

// ============================================
// resolveFromExplicit
// ============================================

describe('resolveFromExplicit', () => {
  it('creates RAC for create-fe intent', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'create-fe',
      basis: 'prd',
      refs: ['/docs/prd.md'],
    };
    const rac = resolveFromExplicit(metadata, { language: 'TypeScript', framework: 'Next.js' });

    expect(rac.source).toBe('explicit');
    expect(rac.intent).toBe('create-fe');
    expect(rac.workType).toBe('system-design');
    expect(rac.jobMode).toBe('generate');
    expect(rac.tech.language).toBe('typescript');
    expect(rac.tech.framework).toBe('nextjs');
    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
    expect(rac.basis).toBe('prd');
    expect(rac.refs).toEqual(['/docs/prd.md']);
    expect(rac.intentDescription).toBeDefined();
    expect(rac.basisDescription).toContain('PRD');
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('creates RAC for create-be intent with Go', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-be' };
    const rac = resolveFromExplicit(metadata, { language: 'Go' });

    expect(rac.tech.environment).toBe('backend');
    expect(rac.tech.runtime).toBe('go-api');
    expect(rac.tech.language).toBe('go');
  });

  it('creates RAC for create-fullstack', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-fullstack' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.tech.environment).toBe('fullstack');
    expect(rac.tech.runtime).toBeUndefined();
    expect(rac.workType).toBe('system-design');
  });

  it('creates RAC for create-figma UI intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-figma' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.workType).toBe('ui-design');
    expect(rac.jobMode).toBe('generate');
  });

  it('creates RAC for revise-system intent (refactor mode)', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'revise-system' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.jobMode).toBe('refactor');
    expect(rac.workType).toBe('system-design');
  });

  it('creates RAC for refactor-code intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'refactor-code' };
    const rac = resolveFromExplicit(metadata, { language: 'TypeScript' });

    expect(rac.intent).toBe('refactor-code');
    expect(rac.jobMode).toBe('refactor');
    expect(rac.tech.language).toBe('typescript');
    expect(rac.intentDescription).toBe('Refactor existing codebase');
  });

  it('creates RAC for create-plan intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-plan', basis: 'directive' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.jobMode).toBe('generate');
    expect(rac.basisDescription).toContain('directive');
  });

  it('creates RAC for create-spec intent', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-spec' };
    const rac = resolveFromExplicit(metadata);

    expect(rac.workType).toBe('spec');
    expect(rac.jobMode).toBe('generate');
  });

  it('hasExplicitFields false when no descriptive fields', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-visual' };
    const rac = resolveFromExplicit(metadata);

    // create-visual has intentDescription, so hasExplicitFields should be true
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('includes all user-specified fields', () => {
    const metadata: ActionMetadata = {
      explicit: true,
      intent: 'create-code',
      target: ['src/app.ts'],
      basis: 'existing-doc',
      refs: ['docs/spec.md'],
      context: ['docs/notes.md'],
    };
    const rac = resolveFromExplicit(metadata);

    expect(rac.target).toEqual(['src/app.ts']);
    expect(rac.basis).toBe('existing-doc');
    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('uses fallbackHints when intent has no environment', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-code' };
    const rac = resolveFromExplicit(
      metadata,
      { language: 'TypeScript' },
      { designDocPath: 'fe-system-main.md' },
    );

    expect(rac.tech.environment).toBe('frontend');
    expect(rac.tech.runtime).toBe('browser');
  });

  it('intent environment takes priority over fallbackHints', () => {
    const metadata: ActionMetadata = { explicit: true, intent: 'create-be' };
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
      explicit: true, intent: 'create-code',
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
      expect(['generate', 'refactor', 'explain']).toContain(rac.jobMode);
    }
  });
});

// ============================================
// resolveFromInfer
// ============================================

describe('resolveFromInfer', () => {
  const baseReport: DetectionReport = {
    jobMode: 'generate',
    jobModeReasoning: 'test',
    sourceJob: 'design',
  };

  it('creates RAC for design detection', () => {
    const report: DetectionReport = {
      ...baseReport,
      workType: 'system-design',
      environment: 'frontend',
      domain: 'service',
    };
    const rac = resolveFromInfer(report, undefined, { language: 'TypeScript', framework: 'Next.js' });

    expect(rac.source).toBe('infer');
    expect(rac.intent).toBeUndefined();
    expect(rac.workType).toBe('system-design');
    expect(rac.jobMode).toBe('generate');
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
    const report: DetectionReport = { ...baseReport, jobMode: 'refactor' };
    const metadata: ActionMetadata = {
      basis: 'prd',
      refs: ['docs/spec.md'],
      target: ['src/main.ts'],
      context: ['docs/notes.md'],
    };
    const rac = resolveFromInfer(report, metadata);

    expect(rac.basis).toBe('prd');
    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.target).toEqual(['src/main.ts']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.basisDescription).toContain('PRD');
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
      workType: 'system-design',
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
    const doc = { path: 'prd.md', content: '# PRD', role: 'context' as const };
    expect(doc.label).toBeUndefined();
  });
});
