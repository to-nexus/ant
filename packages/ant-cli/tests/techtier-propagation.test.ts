/**
 * TechTier Propagation Tests
 *
 * Verifies that:
 * - buildTechTier correctly constructs TechTier from codebase profile
 * - resolveTaskTechTiers maps packages to per-task tiers
 * - effectiveTechTier collapses multiple tiers into one
 * - Jobs without decompose (plan, ask, visual) work without techTier
 * - AutoInjectionResolver behaves correctly with/without techTier
 */

import { describe, it, expect } from 'vitest';
import {
  buildTechTier,
  resolveTaskTechTiers,
  effectiveTechTier,
  resolveLanguage,
  resolveFramework,
  resolveRuntime,
  resolveToRAC,
} from '@ant/shared';
import type { TechTier, PackageTierEntry, Stack } from '@ant/shared';
import { AutoInjectionResolver } from '../src/core/prompt/builder/AutoInjectionResolver';

const resolver = new AutoInjectionResolver();

// ============================================
// buildTechTier
// ============================================

describe('buildTechTier', () => {
  it('builds from typescript frontend profile', () => {
    const tier = buildTechTier({ language: 'typescript', framework: 'nextjs' }, 'frontend');
    expect(tier.language).toBe('typescript');
    expect(tier.framework).toBe('nextjs');
    expect(tier.stack).toBe('frontend');
    expect(tier.runtime).toBe('browser');
  });

  it('builds from go backend profile', () => {
    const tier = buildTechTier({ language: 'go' }, 'backend');
    expect(tier.language).toBe('go');
    expect(tier.stack).toBe('backend');
    expect(tier.runtime).toBe('go-api');
  });

  it('builds from typescript backend profile', () => {
    const tier = buildTechTier({ language: 'typescript', framework: 'express' }, 'backend');
    expect(tier.language).toBe('typescript');
    expect(tier.stack).toBe('backend');
    expect(tier.runtime).toBe('node-api');
  });

  it('fullstack has no runtime (ambiguous)', () => {
    const tier = buildTechTier({ language: 'typescript' }, 'fullstack');
    expect(tier.stack).toBe('fullstack');
    expect(tier.runtime).toBeUndefined();
  });

  it('defaults to typescript when no language', () => {
    const tier = buildTechTier(undefined, 'frontend');
    expect(tier.language).toBe('typescript');
  });

  it('uses taskProfile when profile is absent', () => {
    const tier = buildTechTier(undefined, 'backend', { language: 'go', framework: 'gin' });
    expect(tier.language).toBe('go');
    expect(tier.runtime).toBe('go-api');
  });
});

// ============================================
// resolveLanguage
// ============================================

describe('resolveLanguage', () => {
  it.each([
    ['typescript', 'typescript'],
    ['TypeScript', 'typescript'],
    ['javascript', 'typescript'],
    ['go', 'go'],
    ['golang', 'go'],
    ['python', 'python'],
    ['rust', 'rust'],
    ['java', 'java'],
    ['unknown', 'typescript'],
    [undefined, 'typescript'],
  ])('resolves "%s" to "%s"', (input, expected) => {
    expect(resolveLanguage(input ? { language: input } : undefined)).toBe(expected);
  });
});

// ============================================
// resolveFramework
// ============================================

describe('resolveFramework', () => {
  it('resolves nextjs variants', () => {
    expect(resolveFramework({ framework: 'Next.js' })).toBe('nextjs');
    expect(resolveFramework({ framework: 'NextJS' })).toBe('nextjs');
  });

  it('resolves nuxt', () => {
    expect(resolveFramework({ framework: 'Nuxt' })).toBe('nuxt');
  });

  it('resolves express', () => {
    expect(resolveFramework({ framework: 'Express' })).toBe('express');
  });

  it('returns undefined when absent', () => {
    expect(resolveFramework(undefined)).toBeUndefined();
  });

  it('taskProfile overrides profile', () => {
    expect(resolveFramework({ framework: 'react' }, { framework: 'nextjs' })).toBe('nextjs');
  });
});

// ============================================
// resolveRuntime
// ============================================

describe('resolveRuntime', () => {
  it('frontend → browser', () => {
    expect(resolveRuntime('frontend', 'typescript')).toBe('browser');
  });

  it('backend + typescript → node-api', () => {
    expect(resolveRuntime('backend', 'typescript')).toBe('node-api');
  });

  it('backend + go → go-api', () => {
    expect(resolveRuntime('backend', 'go')).toBe('go-api');
  });

  it('fullstack → undefined', () => {
    expect(resolveRuntime('fullstack', 'typescript')).toBeUndefined();
  });

  it('no stack → undefined', () => {
    expect(resolveRuntime(undefined, 'typescript')).toBeUndefined();
  });
});

// ============================================
// resolveTaskTechTiers
// ============================================

describe('resolveTaskTechTiers', () => {
  const jobTier: TechTier = { language: 'typescript', stack: 'fullstack' };

  const packageTiers: Record<string, PackageTierEntry> = {
    'fe-main': { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
    'be-api': { language: 'typescript', framework: 'express', stack: 'backend' },
    'be-go': { language: 'go', stack: 'backend' },
  };

  it('no packages → falls back to jobTechTier', () => {
    expect(resolveTaskTechTiers(undefined, jobTier, packageTiers)).toEqual([jobTier]);
  });

  it('empty packages → falls back to jobTechTier', () => {
    expect(resolveTaskTechTiers([], jobTier, packageTiers)).toEqual([jobTier]);
  });

  it('no packageTiers map → falls back to jobTechTier', () => {
    expect(resolveTaskTechTiers(['fe-main'], jobTier, undefined)).toEqual([jobTier]);
  });

  it('single frontend package → one frontend tier', () => {
    const tiers = resolveTaskTechTiers(['fe-main'], jobTier, packageTiers);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].stack).toBe('frontend');
    expect(tiers[0].language).toBe('typescript');
    expect(tiers[0].runtime).toBe('browser');
  });

  it('mixed fe+be packages → two tiers', () => {
    const tiers = resolveTaskTechTiers(['fe-main', 'be-api'], jobTier, packageTiers);
    expect(tiers).toHaveLength(2);
    const stacks = tiers.map(t => t.stack);
    expect(stacks).toContain('frontend');
    expect(stacks).toContain('backend');
  });

  it('deduplicates same stack+language', () => {
    const duped: Record<string, PackageTierEntry> = {
      'fe-a': { language: 'typescript', stack: 'frontend' },
      'fe-b': { language: 'typescript', stack: 'frontend' },
    };
    const tiers = resolveTaskTechTiers(['fe-a', 'fe-b'], jobTier, duped);
    expect(tiers).toHaveLength(1);
  });

  it('unmapped packages → falls back to jobTechTier', () => {
    const tiers = resolveTaskTechTiers(['unknown-pkg'], jobTier, packageTiers);
    expect(tiers).toEqual([jobTier]);
  });
});

// ============================================
// effectiveTechTier
// ============================================

describe('effectiveTechTier', () => {
  it('0 tiers → empty object', () => {
    expect(effectiveTechTier([])).toEqual({});
  });

  it('1 tier → as-is', () => {
    const tier: TechTier = { language: 'go', stack: 'backend', runtime: 'go-api' };
    expect(effectiveTechTier([tier])).toEqual(tier);
  });

  it('same stack → preserves that stack', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend', runtime: 'browser' },
      { language: 'typescript', stack: 'frontend', runtime: 'browser', framework: 'react' },
    ];
    const eff = effectiveTechTier(tiers);
    expect(eff.stack).toBe('frontend');
  });

  it('mixed stacks → fullstack, no runtime', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend', runtime: 'browser' },
      { language: 'typescript', stack: 'backend', runtime: 'node-api' },
    ];
    const eff = effectiveTechTier(tiers);
    expect(eff.stack).toBe('fullstack');
    expect(eff.runtime).toBeUndefined();
  });
});

// ============================================
// AutoInjectionResolver with/without techTier
// ============================================

describe('AutoInjectionResolver: techTier presence', () => {
  it('code job with techTier → environment-specific rules', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend', runtime: 'browser' };
    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTier: tier, data: {},
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
  });

  it('code job with techTiers (multi-package) → per-tier env rules', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend', runtime: 'browser' },
      { language: 'go', stack: 'backend', runtime: 'go-api' },
    ];
    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTiers: tiers, data: {},
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
    expect(injections).toContain('code/phases/execute/languages/go/environments/go-api/rules');
  });

  it('code job with no techTier → defaults to typescript/browser', () => {
    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      data: {},
    });
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
  });

  it('code job with techTier + includeTechProfile → profile included in PromptBuildConfig', () => {
    const tier: TechTier = { language: 'typescript', framework: 'nextjs', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTier: tier, data: {},
    });
    expect(injections.length).toBeGreaterThan(0);
  });

  it('design job: no env rules regardless of techTier', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'design', phase: 'execute',
      techTier: tier, data: {},
    });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules).toHaveLength(0);
  });

  it('plan phase: no env rules even with techTier', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'code', phase: 'plan',
      techTier: tier, data: {},
    });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules).toHaveLength(0);
  });
});

// ============================================
// End-to-end: decompose → techTier → injection
// ============================================

describe('E2E: decompose techTier → injection chain', () => {
  it('simulates code decompose → execute flow', () => {
    const profile = { language: 'typescript', framework: 'Next.js' };
    const techTier = buildTechTier(profile, 'frontend');

    expect(techTier.language).toBe('typescript');
    expect(techTier.framework).toBe('nextjs');
    expect(techTier.stack).toBe('frontend');

    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTier: techTier, data: { hasDirective: true },
    });

    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
    expect(injections).toContain('common/injections/directive');
    expect(injections).toContain('common/injections/visual-source-authority');
    expect(injections).toContain('code/base/injections/preview-setup');
  });

  it('simulates go backend decompose → execute flow', () => {
    const techTier = buildTechTier({ language: 'go' }, 'backend');

    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTier: techTier, data: {},
    });

    expect(injections).toContain('code/phases/execute/languages/go/environments/go-api/rules');
    expect(injections).toContain('code/phases/execute/injections/backend-safety');
    expect(injections).not.toContain('code/base/injections/preview-setup');
  });

  it('simulates fullstack multi-package decompose → execute flow', () => {
    const packageTiers: Record<string, PackageTierEntry> = {
      'fe-main': { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
      'be-api': { language: 'typescript', framework: 'express', stack: 'backend' },
    };
    const jobTier = buildTechTier({ language: 'typescript' }, 'fullstack');
    const taskTiers = resolveTaskTechTiers(['fe-main', 'be-api'], jobTier, packageTiers);

    expect(taskTiers).toHaveLength(2);

    const eff = effectiveTechTier(taskTiers);
    expect(eff.stack).toBe('fullstack');

    const injections = resolver.resolve({
      job: 'code', phase: 'execute', taskType: 'feature',
      techTiers: taskTiers, data: {},
    });

    expect(injections).toContain('code/phases/execute/languages/typescript/environments/browser/rules');
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/node-api/rules');
    expect(injections).toContain('code/phases/execute/languages/typescript/environments/fullstack/rules');
    expect(injections).toContain('code/phases/execute/injections/backend-safety');
  });

  it('non-decompose job (ask) works without techTier', () => {
    const rac = resolveToRAC('ask-general');
    const injections = resolver.resolve({
      job: 'code', phase: 'execute',
      resolvedAction: rac,
      data: { hasDirective: true },
    });

    expect(injections).toContain('common/injections/directive');
    expect(injections).toContain('common/injections/action-context');
  });
});
