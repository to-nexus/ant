/**
 * Golden Snapshot: Design Job techTier Injection Paths
 *
 * Locks the path-decision output of the design job's framework-augmentation
 * logic so that the Phase 2-6d relocation (from scattered branches in
 * `docGen/intent/system.ts` to `AutoInjectionResolver.resolveTechTierInjections`)
 * does not change the emitted template list for any of the three priority
 * branches:
 *
 *   Priority 0: task-level techTiers
 *   Priority 1: graph-level techTier (state.resolvedAction.basis.techTier)
 *   Priority 2: text-search fallback over source docs + directive
 *
 * The inputs cover the matrix of (frontend doc, backend doc) × (nextjs tier,
 * go tier, no tier). If the goldens break, verify the resolver signature and
 * the pseudo-techTier shape the docGen logging path feeds in.
 */

import { describe, it, expect } from 'vitest';
import { AutoInjectionResolver } from '../../src/core/prompt/builder/AutoInjectionResolver';
import type { TechTier } from '@ant/shared';

const resolver = new AutoInjectionResolver();

function paths(tiers: TechTier[], taskType?: string): string[] {
  return resolver.resolveTechTierInjections('design', tiers, taskType);
}

describe('Design job techTier injection — golden snapshot', () => {
  it('nextjs task-level tier → framework/nextjs', () => {
    expect(
      paths([{ framework: 'nextjs', stack: 'frontend' }]),
    ).toEqual(['jobs/design/basis/techTier/framework/nextjs']);
  });

  it('Next.js variant (Next.JS) normalizes to nextjs', () => {
    expect(
      paths([{ framework: 'Next.JS', stack: 'frontend' }]),
    ).toEqual(['jobs/design/basis/techTier/framework/nextjs']);
  });

  it('go task-level tier (framework=go) → framework/go', () => {
    expect(
      paths([{ framework: 'go', stack: 'backend' }]),
    ).toEqual(['jobs/design/basis/techTier/framework/go']);
  });

  it('go language on backend (no framework) → framework/go synonym', () => {
    // Historical file naming: `framework/go.md` = "Go API backend".
    // A pseudo-techTier with language='go' must resolve to the same file
    // so the Priority 2 text-search fallback keeps its prior output.
    expect(paths([{ language: 'go', stack: 'backend' }])).toEqual([
      'jobs/design/basis/techTier/framework/go',
    ]);
  });

  it('pseudo-techTier for nextjs (Priority 2 text-search result)', () => {
    expect(
      paths([{ framework: 'nextjs', stack: 'frontend' }]),
    ).toEqual(['jobs/design/basis/techTier/framework/nextjs']);
  });

  it('unsupported framework is dropped (no fallback injection)', () => {
    expect(paths([{ framework: 'svelte', stack: 'frontend' }])).toEqual([]);
  });

  it('no tiers → no injections', () => {
    expect(paths([])).toEqual([]);
  });

  it('design job ignores code-only task type gating', () => {
    // Code job scopes injection to verification/error/ui; design has no
    // such scope. Passing an arbitrary taskType must not alter the output.
    expect(paths([{ framework: 'nextjs', stack: 'frontend' }], 'setup'))
      .toEqual(['jobs/design/basis/techTier/framework/nextjs']);
    expect(paths([{ framework: 'nextjs', stack: 'frontend' }], 'feature'))
      .toEqual(['jobs/design/basis/techTier/framework/nextjs']);
  });
});

describe('Code job techTier injection — golden snapshot', () => {
  function codePaths(tiers: TechTier[], taskType?: string): string[] {
    return resolver.resolveTechTierInjections('code', tiers, taskType);
  }

  it('verification task with nextjs frontend tier → framework + language', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], 'verification'),
    ).toEqual([
      'jobs/code/basis/techTier/framework/nextjs',
      'jobs/code/basis/techTier/language/typescript-browser',
    ]);
  });

  it('error task with go backend tier → framework (gin mapping absent) + language', () => {
    expect(
      codePaths([{ language: 'go', stack: 'backend' }], 'error'),
    ).toEqual([
      'jobs/code/basis/techTier/language/go',
    ]);
  });

  it('ui task with gin backend tier → framework/gin + language/go', () => {
    expect(
      codePaths([{ framework: 'gin', language: 'go', stack: 'backend' }], 'ui'),
    ).toEqual([
      'jobs/code/basis/techTier/framework/gin',
      'jobs/code/basis/techTier/language/go',
    ]);
  });

  it('setup task with nextjs tier → framework + language (prevention at write time)', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], 'setup'),
    ).toEqual([
      'jobs/code/basis/techTier/framework/nextjs',
      'jobs/code/basis/techTier/language/typescript-browser',
    ]);
  });

  it('feature task with nextjs tier → framework + language (prevention at write time)', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], 'feature'),
    ).toEqual([
      'jobs/code/basis/techTier/framework/nextjs',
      'jobs/code/basis/techTier/language/typescript-browser',
    ]);
  });

  it('test-code task → both framework + language hints injected (test config is framework-sensitive)', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], 'test-code'),
    ).toEqual([
      'jobs/code/basis/techTier/framework/nextjs',
      'jobs/code/basis/techTier/language/typescript-browser',
    ]);
  });

  it('doc task → no hint injection (not relevant to documentation authoring)', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], 'doc'),
    ).toEqual([]);
  });

  it('unknown task type → no injection', () => {
    expect(
      codePaths([{ framework: 'nextjs', language: 'typescript', stack: 'frontend' }], undefined),
    ).toEqual([]);
  });
});
