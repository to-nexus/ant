import { describe, it, expect } from 'vitest';
import {
  resolveLanguage,
  resolveFramework,
  getIntentDescription,
  resolveToRAC,
  INTENT_DEFINITIONS,
  deriveFromIntent,
  mergeTechTier,
  mergeTechTierConfigs,
  getTechTier,
  getBasis,
  buildBasisPreset,
} from '@ant/shared';
import type { ResolvedArtifact, TechTier, TechTierConfig, ResolvedActionContext } from '@ant/shared';

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

  it('falls back unsupported languages to typescript', () => {
    expect(resolveLanguage({ language: 'Python' })).toBe('typescript');
    expect(resolveLanguage({ language: 'Rust' })).toBe('typescript');
    expect(resolveLanguage({ language: 'Java' })).toBe('typescript');
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
// resolveToRAC — explicit path
// ============================================

describe('resolveToRAC — explicit path', () => {
  it('creates RAC for gen-sys-fe intent', () => {
    const rac = resolveToRAC('gen-sys-fe', { refs: ['/docs/prd.md'] }, 'explicit');

    expect(rac.source).toBe('explicit');
    expect(rac.intent).toBe('gen-sys-fe');
    expect(rac.intentGroup).toBe('design-system');
    expect(rac.mode).toBe('generate');
    expect(rac.refs).toEqual(['/docs/prd.md']);
    expect(rac.intentDescription).toBeDefined();
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('creates RAC for gen-ui-figma UI intent', () => {
    const rac = resolveToRAC('gen-ui-figma', undefined, 'explicit');

    expect(rac.intentGroup).toBe('design-ui');
    expect(rac.mode).toBe('generate');
  });

  it('creates RAC for rev-sys intent (refactor mode)', () => {
    const rac = resolveToRAC('rev-sys', undefined, 'explicit');

    expect(rac.mode).toBe('refactor');
    expect(rac.intentGroup).toBe('design-system');
  });

  it('creates RAC for rev-code intent', () => {
    const rac = resolveToRAC('rev-code', undefined, 'explicit');

    expect(rac.intent).toBe('rev-code');
    expect(rac.mode).toBe('refactor');
    expect(rac.intentDescription).toBe('Refactor existing codebase');
  });

  it('creates RAC for gen-plan intent', () => {
    const rac = resolveToRAC('gen-plan', undefined, 'explicit');

    expect(rac.mode).toBe('generate');
  });

  it('creates RAC for gen-spec intent', () => {
    const rac = resolveToRAC('gen-spec', undefined, 'explicit');

    expect(rac.intentGroup).toBe('design-spec');
    expect(rac.mode).toBe('generate');
  });

  it('hasExplicitFields false when no slots', () => {
    const rac = resolveToRAC('gen-visual-illustration', undefined, 'explicit');

    expect(rac.hasExplicitFields).toBe(false);
  });

  it('includes all user-specified fields', () => {
    const rac = resolveToRAC('gen-code-sys', {
      target: ['src/app.ts'],
      refs: ['docs/spec.md'],
      context: ['docs/notes.md'],
    }, 'explicit');

    expect(rac.target).toEqual(['src/app.ts']);
    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('does NOT include documents (resolve node adds them separately)', () => {
    const rac = resolveToRAC('gen-code-sys', {
      refs: ['plan/prd.md'],
      context: ['architecture/system/fe-system-main.md'],
    }, 'explicit');

    expect(rac.documents).toBeUndefined();
    expect(rac.refs).toEqual(['plan/prd.md']);
    expect(rac.context).toEqual(['architecture/system/fe-system-main.md']);
  });

  it('covers all INTENT_DEFINITIONS', () => {
    for (const def of INTENT_DEFINITIONS) {
      const rac = resolveToRAC(def.id, undefined, 'explicit');

      expect(rac.source).toBe('explicit');
      expect(rac.intent).toBe(def.id);
      expect(rac.intentDescription).toBe(def.description.en);
      expect(['generate', 'refactor', 'explain']).toContain(rac.mode);
    }
  });
});

// ============================================
// resolveToRAC — infer path
// ============================================

describe('resolveToRAC — infer path', () => {
  it('creates RAC with source=infer by default', () => {
    const rac = resolveToRAC('gen-sys-fe');

    expect(rac.source).toBe('infer');
    expect(rac.intent).toBe('gen-sys-fe');
    expect(rac.intentGroup).toBe('design-system');
    expect(rac.mode).toBe('generate');
  });

  it('slots propagate to RAC', () => {
    const rac = resolveToRAC('gen-code-sys', {
      refs: ['docs/spec.md'],
      target: ['src/main.ts'],
      context: ['docs/notes.md'],
    });

    expect(rac.refs).toEqual(['docs/spec.md']);
    expect(rac.target).toEqual(['src/main.ts']);
    expect(rac.context).toEqual(['docs/notes.md']);
    expect(rac.hasExplicitFields).toBe(true);
  });

  it('hasExplicitFields false when no slots', () => {
    const rac = resolveToRAC('gen-code-sys');

    expect(rac.hasExplicitFields).toBe(false);
  });

  it('domain passes through', () => {
    const rac = resolveToRAC('gen-sys-fe', { domain: 'game' });

    expect(rac.domain).toBe('game');
  });

  it('service domain passes through', () => {
    const rac = resolveToRAC('gen-sys-fe', { domain: 'service' });

    expect(rac.domain).toBe('service');
  });

  it('fullstack intent produces correct intentGroup', () => {
    const rac = resolveToRAC('gen-sys-full');

    expect(rac.intentGroup).toBe('design-system');
  });

  it('intentDescription is populated for infer path', () => {
    const rac = resolveToRAC('gen-plan');

    expect(rac.intentDescription).toBeDefined();
    expect(typeof rac.intentDescription).toBe('string');
  });
});

// ============================================
// ResolvedArtifact.label
// ============================================

describe('ResolvedArtifact', () => {
  it('supports optional label field', () => {
    const doc = { path: 'design.md', content: '# Design', role: 'ref' as const, label: 'System Design' };
    expect(doc.label).toBe('System Design');
  });

  it('label is optional', () => {
    const doc: ResolvedArtifact = { path: 'prd.md', content: '# PRD', role: 'context' };
    expect(doc.label).toBeUndefined();
  });
});

// ============================================
// deriveFromIntent explain intents
// ============================================

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
});

// ============================================
// deriveFromIntent ask intents
// ============================================

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
});

// ============================================
// mergeTechTier
// ============================================

describe('mergeTechTier', () => {
  it('returns inferred when no preset', () => {
    const inferred: TechTier = { language: 'typescript', stack: 'frontend' };
    expect(mergeTechTier(undefined, inferred)).toEqual(inferred);
  });

  it('returns preset when no inferred', () => {
    const preset: TechTier = { language: 'go', framework: 'gin' };
    expect(mergeTechTier(preset, undefined)).toEqual(preset);
  });

  it('returns empty when both undefined', () => {
    expect(mergeTechTier(undefined, undefined)).toEqual({});
  });

  it('preset fields take priority', () => {
    const preset: TechTier = { language: 'go' };
    const inferred: TechTier = { language: 'typescript', framework: 'nextjs', stack: 'frontend' };
    expect(mergeTechTier(preset, inferred)).toEqual({
      language: 'go',
      framework: 'nextjs',
      stack: 'frontend',
      packageManager: undefined,
    });
  });

  it('fills missing preset fields from inferred', () => {
    const preset: TechTier = { language: 'typescript', packageManager: 'pnpm' };
    const inferred: TechTier = { language: 'go', framework: 'gin', stack: 'backend' };
    const merged = mergeTechTier(preset, inferred);
    expect(merged.language).toBe('typescript');
    expect(merged.framework).toBe('gin');
    expect(merged.stack).toBe('backend');
    expect(merged.packageManager).toBe('pnpm');
  });
});

// ============================================
// getTechTier / getBasis (TechTierConfig)
// ============================================

describe('getTechTier', () => {
  it('reads frontend tier from RAC basis (TechTierConfig)', () => {
    const config: TechTierConfig = {
      stack: 'frontend',
      frontend: { language: 'go', stack: 'backend' },
    };
    const state = {
      resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false, basis: { techTier: config } } as ResolvedActionContext,
    };
    expect(getTechTier(state)).toEqual({ language: 'go', stack: 'backend' });
  });

  it('returns backend tier when no frontend', () => {
    const config: TechTierConfig = {
      stack: 'backend',
      backend: { language: 'go', stack: 'backend' },
    };
    const state = {
      resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false, basis: { techTier: config } } as ResolvedActionContext,
    };
    expect(getTechTier(state)).toEqual({ language: 'go', stack: 'backend' });
  });

  it('returns frontend tier for fullstack (frontend priority)', () => {
    const config: TechTierConfig = {
      stack: 'fullstack',
      frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
      backend: { language: 'typescript', framework: 'nestjs', stack: 'backend' },
    };
    const state = {
      resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false, basis: { techTier: config } } as ResolvedActionContext,
    };
    expect(getTechTier(state)?.framework).toBe('nextjs');
  });

  it('returns undefined when basis has no techTier', () => {
    const state = { resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false } as ResolvedActionContext };
    expect(getTechTier(state)).toBeUndefined();
  });

  it('returns undefined when no resolvedAction', () => {
    expect(getTechTier({})).toBeUndefined();
  });

  it('returns undefined when config has no tiers', () => {
    const config: TechTierConfig = { stack: 'frontend' };
    const state = {
      resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false, basis: { techTier: config } } as ResolvedActionContext,
    };
    expect(getTechTier(state)).toBeUndefined();
  });
});

describe('getBasis', () => {
  it('reads basis from RAC', () => {
    const basis = { techTier: { stack: 'backend' as const, backend: { language: 'go' as const, stack: 'backend' as const } } };
    const state = { resolvedAction: { mode: 'generate', source: 'infer', hasExplicitFields: false, basis } as ResolvedActionContext };
    expect(getBasis(state)).toEqual(basis);
  });

  it('returns undefined when no RAC', () => {
    expect(getBasis({})).toBeUndefined();
  });
});

// ============================================
// mergeTechTierConfigs
// ============================================

describe('mergeTechTierConfigs', () => {
  it('returns inferred when no preset', () => {
    const inferred: TechTierConfig = { stack: 'frontend', frontend: { language: 'typescript', stack: 'frontend' } };
    expect(mergeTechTierConfigs(undefined, inferred)).toEqual(inferred);
  });

  it('returns preset when no inferred', () => {
    const preset: TechTierConfig = { stack: 'backend', backend: { language: 'go', stack: 'backend' } };
    expect(mergeTechTierConfigs(preset, undefined)).toEqual(preset);
  });

  it('returns empty when both undefined', () => {
    expect(mergeTechTierConfigs(undefined, undefined)).toEqual({});
  });

  it('preset stack takes priority', () => {
    const preset: TechTierConfig = { stack: 'fullstack', frontend: { language: 'typescript', stack: 'frontend' } };
    const inferred: TechTierConfig = { stack: 'frontend', frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' } };
    const merged = mergeTechTierConfigs(preset, inferred);
    expect(merged.stack).toBe('fullstack');
  });

  it('merges frontend tiers with preset priority', () => {
    const preset: TechTierConfig = { stack: 'frontend', frontend: { language: 'go', stack: 'frontend' } };
    const inferred: TechTierConfig = { stack: 'frontend', frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' } };
    const merged = mergeTechTierConfigs(preset, inferred);
    expect(merged.frontend?.language).toBe('go');
    expect(merged.frontend?.framework).toBe('nextjs');
  });

  it('merges fullstack with both tiers', () => {
    const preset: TechTierConfig = {
      stack: 'fullstack',
      frontend: { language: 'typescript', framework: 'react', stack: 'frontend' },
    };
    const inferred: TechTierConfig = {
      stack: 'fullstack',
      frontend: { language: 'typescript', stack: 'frontend' },
      backend: { language: 'typescript', framework: 'nestjs', stack: 'backend' },
    };
    const merged = mergeTechTierConfigs(preset, inferred);
    expect(merged.frontend?.framework).toBe('react');
    expect(merged.backend?.framework).toBe('nestjs');
  });
});

// ============================================
// buildBasisPreset (new API)
// ============================================

describe('buildBasisPreset', () => {
  it('builds frontend-only preset', () => {
    const basis = buildBasisPreset({
      stack: 'frontend',
      tiers: { frontend: { language: 'typescript', framework: 'nextjs' } },
    });
    expect(basis.techTier?.stack).toBe('frontend');
    expect(basis.techTier?.frontend?.language).toBe('typescript');
    expect(basis.techTier?.frontend?.framework).toBe('nextjs');
    expect(basis.techTier?.frontend?.stack).toBe('frontend');
  });

  it('builds fullstack preset', () => {
    const basis = buildBasisPreset({
      stack: 'fullstack',
      tiers: {
        frontend: { language: 'typescript', framework: 'react' },
        backend: { language: 'typescript', framework: 'nestjs' },
      },
    });
    expect(basis.techTier?.stack).toBe('fullstack');
    expect(basis.techTier?.frontend?.framework).toBe('react');
    expect(basis.techTier?.backend?.framework).toBe('nestjs');
  });

  it('returns undefined techTier when no stack or tiers', () => {
    const basis = buildBasisPreset({});
    expect(basis.techTier).toBeUndefined();
  });

  it('builds with stack only', () => {
    const basis = buildBasisPreset({ stack: 'backend' });
    expect(basis.techTier?.stack).toBe('backend');
    expect(basis.techTier?.frontend).toBeUndefined();
    expect(basis.techTier?.backend).toBeUndefined();
  });

  it('builds with designSystem', () => {
    const basis = buildBasisPreset({ designSystem: 'material' });
    expect(basis.visualTier?.designSystem).toBe('material');
    expect(basis.techTier).toBeUndefined();
  });
});
