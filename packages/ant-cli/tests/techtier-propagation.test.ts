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
  resolveTaskTechTiersFromMap,
  effectiveTechTier,
  resolveLanguage,
  resolveFramework,
  resolveToRAC,
} from '@ant/shared';
import type { TechTier, TechTierConfig, PackageTierEntry, Stack } from '@ant/shared';
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
  });

  it('builds from go backend profile', () => {
    const tier = buildTechTier({ language: 'go' }, 'backend');
    expect(tier.language).toBe('go');
    expect(tier.stack).toBe('backend');
  });

  it('builds from typescript backend profile', () => {
    const tier = buildTechTier({ language: 'typescript', framework: 'express' }, 'backend');
    expect(tier.language).toBe('typescript');
    expect(tier.stack).toBe('backend');
  });

  it('fullstack', () => {
    const tier = buildTechTier({ language: 'typescript' }, 'fullstack');
    expect(tier.stack).toBe('fullstack');
  });

  it('defaults to typescript when no language', () => {
    const tier = buildTechTier(undefined, 'frontend');
    expect(tier.language).toBe('typescript');
  });

  it('uses taskProfile when profile is absent', () => {
    const tier = buildTechTier(undefined, 'backend', { language: 'go', framework: 'gin' });
    expect(tier.language).toBe('go');
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
    ['python', 'typescript'],
    ['rust', 'typescript'],
    ['java', 'typescript'],
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
// resolveTaskTechTiersFromMap
// ============================================

describe('resolveTaskTechTiersFromMap', () => {
  const config: TechTierConfig = {
    stack: 'fullstack',
    frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
    backend: { language: 'typescript', framework: 'nextjs', stack: 'backend' },
  };

  const packageTiers: Record<string, PackageTierEntry> = {
    'fe-main': { language: 'typescript', framework: 'react', stack: 'frontend' },
    'be-api': { language: 'typescript', framework: 'nestjs', stack: 'backend' },
    'be-go': { language: 'go', framework: 'gin', stack: 'backend' },
  };

  it('no packages → all tiers from config', () => {
    const tiers = resolveTaskTechTiersFromMap(undefined, config, packageTiers);
    expect(tiers).toHaveLength(2);
  });

  it('no config → empty', () => {
    expect(resolveTaskTechTiersFromMap(['fe-main'], undefined, packageTiers)).toEqual([]);
  });

  it('uses packageTier entry values over config values', () => {
    const tiers = resolveTaskTechTiersFromMap(['be-api'], config, packageTiers);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].stack).toBe('backend');
    expect(tiers[0].framework).toBe('nestjs');
    expect(tiers[0].language).toBe('typescript');
  });

  it('frontend package gets entry framework', () => {
    const tiers = resolveTaskTechTiersFromMap(['fe-main'], config, packageTiers);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].framework).toBe('react');
  });

  it('mixed packages → two tiers with correct frameworks', () => {
    const tiers = resolveTaskTechTiersFromMap(['fe-main', 'be-api'], config, packageTiers);
    expect(tiers).toHaveLength(2);
    const fe = tiers.find(t => t.stack === 'frontend');
    const be = tiers.find(t => t.stack === 'backend');
    expect(fe?.framework).toBe('react');
    expect(be?.framework).toBe('nestjs');
  });

  it('go backend package uses entry language', () => {
    const tiers = resolveTaskTechTiersFromMap(['be-go'], config, packageTiers);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].language).toBe('go');
    expect(tiers[0].framework).toBe('gin');
  });

  it('unmapped packages → falls back to all config tiers', () => {
    const tiers = resolveTaskTechTiersFromMap(['unknown-pkg'], config, packageTiers);
    expect(tiers).toHaveLength(2);
  });

  it('deduplicates by stack key', () => {
    const tiers = resolveTaskTechTiersFromMap(['fe-main', 'fe-main'], config, packageTiers);
    expect(tiers).toHaveLength(1);
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
    const tier: TechTier = { language: 'go', stack: 'backend' };
    expect(effectiveTechTier([tier])).toEqual(tier);
  });

  it('same stack → preserves that stack', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend' },
      { language: 'typescript', stack: 'frontend', framework: 'react' },
    ];
    const eff = effectiveTechTier(tiers);
    expect(eff.stack).toBe('frontend');
  });

  it('mixed stacks → undefined (fullstack is project-level only)', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend' },
      { language: 'typescript', stack: 'backend' },
    ];
    const eff = effectiveTechTier(tiers);
    expect(eff.stack).toBeUndefined();
  });
});

// ============================================
// AutoInjectionResolver with/without techTier
// ============================================

describe('AutoInjectionResolver: techTier presence', () => {
  it('code job with techTier → tool-calling and preview injections', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTier: tier, data: {},
    });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('code job with techTiers (multi-package) → includes backend safety', () => {
    const tiers: TechTier[] = [
      { language: 'typescript', stack: 'frontend' },
      { language: 'go', stack: 'backend' },
    ];
    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTiers: tiers, data: {},
    });
    expect(injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('code job with no techTier → still includes frontend injections', () => {
    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      data: {},
    });
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('code job with techTier → injections resolved from PromptBuildConfig', () => {
    const tier: TechTier = { language: 'typescript', framework: 'nextjs', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTier: tier, data: {},
    });
    expect(injections.length).toBeGreaterThan(0);
  });

  it('design job: no env rules regardless of techTier', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'design', node: 'execute',
      techTier: tier, data: {},
    });
    const envRules = injections.filter(i => i.includes('/environments/'));
    expect(envRules).toHaveLength(0);
  });

  it('plan node: no env rules even with techTier', () => {
    const tier: TechTier = { language: 'typescript', stack: 'frontend' };
    const injections = resolver.resolve({
      job: 'code', node: 'plan',
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
      job: 'code', node: 'execute', taskType: 'feature',
      techTier: techTier, data: { hasDirective: true },
    });

    expect(injections).toContain('jobs/shared/injections/directive');
    expect(injections).toContain('jobs/shared/injections/visual-source-authority');
    expect(injections).toContain('jobs/code/base/injections/preview-setup');
  });

  it('simulates go backend decompose → execute flow', () => {
    const techTier = buildTechTier({ language: 'go' }, 'backend');

    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTier: techTier, data: {},
    });

    expect(injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
    expect(injections).not.toContain('jobs/code/base/injections/preview-setup');
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
    expect(eff.stack).toBeUndefined();

    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTiers: taskTiers, data: {},
    });

    expect(injections).toContain('jobs/code/nodes/execute/injections/backend-safety');
  });

  it('non-decompose job (ask) works without techTier', () => {
    const rac = resolveToRAC('ask-general');
    const injections = resolver.resolve({
      job: 'code', node: 'execute',
      resolvedAction: rac,
      data: { hasDirective: true },
    });

    expect(injections).toContain('jobs/shared/injections/directive');
    expect(injections).toContain('jobs/shared/injections/action-context');
  });
});
