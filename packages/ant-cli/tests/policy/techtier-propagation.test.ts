/**
 * TechTier Propagation Tests
 *
 * Verifies that:
 * - buildTechTier correctly constructs TechTier from codebase profile
 * - resolveTaskTechTierFromStack maps a task's `stack` pointer to its tier
 * - applyExplicitTechTierOverrides preserves explicit basis over LLM emit
 * - effectiveTechTier collapses multiple tiers into one
 * - Jobs without decompose (plan, ask, visual) work without techTier
 * - AutoInjectionResolver behaves correctly with/without techTier
 */

import { describe, it, expect } from 'vitest';
import {
  buildTechTier,
  resolveTaskTechTierFromStack,
  applyExplicitTechTierOverrides,
  effectiveTechTier,
  resolveToRAC,
} from '@ant/shared';
import type { TechTier, TechTierConfig } from '@ant/shared';
import { AutoInjectionResolver } from '../../src/core/prompt/builder/AutoInjectionResolver';

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

// `resolveLanguage` / `resolveFramework` unit tests live in
// tests/core/rac.test.ts (the @ant/shared normalisation SSOT).

// ============================================
// resolveTaskTechTierFromStack — per-task stack pointer → config slot
// ============================================

describe('resolveTaskTechTierFromStack', () => {
  // Fullstack config with DISTINCT frameworks per tier — the non-collapse
  // invariant (Next front + Express back must not merge into one framework).
  const fullstack: TechTierConfig = {
    stack: 'fullstack',
    frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
    backend: { language: 'typescript', framework: 'express', stack: 'backend' },
  };

  it('stack=frontend → [config.frontend] (framework not collapsed)', () => {
    const tiers = resolveTaskTechTierFromStack('frontend', fullstack);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].stack).toBe('frontend');
    expect(tiers[0].framework).toBe('nextjs');
  });

  it('stack=backend → [config.backend] (distinct from frontend)', () => {
    const tiers = resolveTaskTechTierFromStack('backend', fullstack);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].stack).toBe('backend');
    expect(tiers[0].framework).toBe('express');
  });

  it('fullstack frameworks do NOT collapse: fe=nextjs ≠ be=express', () => {
    const fe = resolveTaskTechTierFromStack('frontend', fullstack)[0];
    const be = resolveTaskTechTierFromStack('backend', fullstack)[0];
    expect(fe.framework).not.toBe(be.framework);
  });

  it('no config → []', () => {
    expect(resolveTaskTechTierFromStack('frontend', undefined)).toEqual([]);
  });

  it('stack omitted on single-stack config → the sole tier', () => {
    const single: TechTierConfig = {
      stack: 'frontend',
      frontend: { language: 'typescript', framework: 'react', stack: 'frontend' },
    };
    const tiers = resolveTaskTechTierFromStack(undefined, single);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].framework).toBe('react');
  });

  it('stack given but that slot empty → []', () => {
    const single: TechTierConfig = {
      stack: 'frontend',
      frontend: { language: 'typescript', stack: 'frontend' },
    };
    expect(resolveTaskTechTierFromStack('backend', single)).toEqual([]);
  });

  it('stack omitted on fullstack config → contract-violation fallback to frontend', () => {
    const tiers = resolveTaskTechTierFromStack(undefined, fullstack);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].stack).toBe('frontend');
  });
});

// ============================================
// applyExplicitTechTierOverrides
//
// Policy: explicit basis from `actionMetadata.basis.techTier` is authoritative.
// Mirrors the visualTier / gameArtTier / gameContentTier invariant — preset
// fields win over LLM-emitted `<techTier>` values for the same stack.
// ============================================

describe('applyExplicitTechTierOverrides', () => {
  const taskTiers: TechTier[] = [
    { language: 'typescript', framework: 'react', stack: 'frontend' },
    { language: 'typescript', framework: 'express', stack: 'backend' },
  ];

  it('explicit undefined → input unchanged (infer path: monorepo divergence preserved)', () => {
    expect(applyExplicitTechTierOverrides(taskTiers, undefined)).toEqual(taskTiers);
  });

  it('explicit empty config → input unchanged', () => {
    const out = applyExplicitTechTierOverrides(taskTiers, {});
    expect(out).toEqual(taskTiers);
  });

  it('explicit frontend framework wins over conflicting LLM-emitted react', () => {
    const explicit: TechTierConfig = {
      stack: 'frontend',
      frontend: { framework: 'nextjs', stack: 'frontend' },
    };
    const out = applyExplicitTechTierOverrides(taskTiers, explicit);
    const fe = out.find(t => t.stack === 'frontend');
    expect(fe?.framework).toBe('nextjs');
    expect(fe?.language).toBe('typescript');
  });

  it('explicit only on frontend leaves backend tier untouched', () => {
    const explicit: TechTierConfig = {
      frontend: { framework: 'nextjs', stack: 'frontend' },
    };
    const out = applyExplicitTechTierOverrides(taskTiers, explicit);
    const be = out.find(t => t.stack === 'backend');
    expect(be?.framework).toBe('express');
  });

  it('explicit field absent → existing tier value kept (?? semantics)', () => {
    const explicit: TechTierConfig = {
      frontend: { stack: 'frontend' /* no framework / language */ },
    };
    const out = applyExplicitTechTierOverrides(taskTiers, explicit);
    const fe = out.find(t => t.stack === 'frontend');
    expect(fe?.framework).toBe('react');
    expect(fe?.language).toBe('typescript');
  });

  it('explicit language overrides task language', () => {
    const explicit: TechTierConfig = {
      backend: { language: 'go', stack: 'backend' },
    };
    const out = applyExplicitTechTierOverrides(taskTiers, explicit);
    const be = out.find(t => t.stack === 'backend');
    expect(be?.language).toBe('go');
  });

  it('explicit gameEngine propagates to matching stack', () => {
    const ts: TechTier[] = [{ language: 'typescript', framework: 'react', stack: 'frontend' }];
    const explicit: TechTierConfig = {
      frontend: { stack: 'frontend', gameEngine: 'phaser' },
    };
    const out = applyExplicitTechTierOverrides(ts, explicit);
    expect(out[0].gameEngine).toBe('phaser');
  });

  it('end-to-end: explicit nextjs survives a config frontend framework of react', () => {
    // Config (LLM-derived) has react on frontend; explicit basis pins nextjs.
    const config: TechTierConfig = {
      stack: 'frontend',
      frontend: { language: 'typescript', framework: 'react', stack: 'frontend' },
    };
    const explicit: TechTierConfig = {
      stack: 'frontend',
      frontend: { framework: 'nextjs', stack: 'frontend' },
    };
    const resolved = resolveTaskTechTierFromStack('frontend', config);
    const final = applyExplicitTechTierOverrides(resolved, explicit);
    expect(final).toHaveLength(1);
    expect(final[0].framework).toBe('nextjs');
    expect(final[0].stack).toBe('frontend');
  });

  it('end-to-end without explicit: per-stack framework divergence preserved', () => {
    const config: TechTierConfig = {
      stack: 'fullstack',
      frontend: { language: 'typescript', framework: 'react', stack: 'frontend' },
      backend: { language: 'typescript', framework: 'express', stack: 'backend' },
    };
    const fe = applyExplicitTechTierOverrides(resolveTaskTechTierFromStack('frontend', config), undefined);
    const be = applyExplicitTechTierOverrides(resolveTaskTechTierFromStack('backend', config), undefined);
    expect(fe[0].framework).toBe('react');
    expect(be[0].framework).toBe('express');
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

  it('simulates fullstack decompose → per-stack task tiers → execute flow', () => {
    const config: TechTierConfig = {
      stack: 'fullstack',
      frontend: { language: 'typescript', framework: 'nextjs', stack: 'frontend' },
      backend: { language: 'typescript', framework: 'express', stack: 'backend' },
    };
    // Each task narrows to a single stack via its `stack` pointer.
    const feTiers = resolveTaskTechTierFromStack('frontend', config);
    const beTiers = resolveTaskTechTierFromStack('backend', config);
    expect(feTiers[0].framework).toBe('nextjs');
    expect(beTiers[0].framework).toBe('express');

    // A backend task surfaces the backend-safety injection.
    const injections = resolver.resolve({
      job: 'code', node: 'execute', taskType: 'feature',
      techTiers: beTiers, data: {},
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
