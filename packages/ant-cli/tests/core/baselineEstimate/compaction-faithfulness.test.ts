/**
 * Compaction faithfulness — core regression guard.
 *
 * The plan's key invariant: the estimator's per-node compaction call
 * MUST produce the SAME artifact form as production. Drift here is what
 * causes baseline ↔ live divergence (the 170%→25% gauge swing the plan's
 * "왜곡 시나리오" describes).
 *
 * Strategy: same-source-truth.
 *   - For `decompose`, `applyNodeCompaction(fixture, 'decompose')` must
 *     return the same artifact set (by path + body length) as a direct
 *     `prepareRacInjection({ artifacts: fixture })` call.
 *   - For non-decompose nodes, it must match
 *     `compactArtifacts(fixture, { threshold: 30_000 })`.
 *
 * Bonus: an explicit "raw body sum ≠ estimator result" assertion locks
 * out a regression where someone removes compaction and the baseline
 * silently inflates.
 */

import { describe, it, expect } from 'vitest';
import type { ResolvedArtifact } from '@ant/shared';
import { applyNodeCompaction } from '../../../src/core/baselineEstimate/applyNodeCompaction';
import { compactArtifacts } from '../../../src/core/artifact/ArtifactPipeline';
import { prepareRacInjection } from '../../../src/agents/architect/graph/code/nodes/decompose/designSelector';

function ref(path: string, sizeChars: number): ResolvedArtifact {
  return { path, role: 'ref', content: 'r'.repeat(sizeChars) };
}
function ctx(path: string, sizeChars: number): ResolvedArtifact {
  return { path, role: 'context', content: 'c'.repeat(sizeChars) };
}

function sumChars(arts: ResolvedArtifact[]): number {
  return arts.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
}

describe('compaction faithfulness — decompose path', () => {
  it('matches prepareRacInjection output character-count and path set', () => {
    const fixture: ResolvedArtifact[] = [
      ref('src/big.ts', 50_000),
      ref('src/medium.ts', 6_000),
      ctx('docs/overview.md', 3_000),
      ctx('docs/tiny.md', 500),
    ];
    const fromEstimator = applyNodeCompaction(fixture, 'decompose');
    const direct = prepareRacInjection({ artifacts: fixture } as any);
    const directCombined = [...direct.refs, ...direct.context];

    // Same path set + content lengths (per-path) — production output.
    const sortByPath = (a: ResolvedArtifact, b: ResolvedArtifact) =>
      a.path.localeCompare(b.path);
    const left = [...fromEstimator].sort(sortByPath);
    const right = [...directCombined].sort(sortByPath);
    expect(left.map(a => a.path)).toEqual(right.map(a => a.path));
    expect(left.map(a => a.content.length)).toEqual(
      right.map(a => a.content.length),
    );
  });

  it('shrinks the raw 60K+ payload below the compaction-aware total', () => {
    const fixture: ResolvedArtifact[] = [
      ref('src/big.ts', 50_000),
      ctx('docs/giant.md', 20_000),
    ];
    const rawTotal = sumChars(fixture);
    const compactedTotal = sumChars(applyNodeCompaction(fixture, 'decompose'));
    expect(rawTotal).toBeGreaterThan(60_000);
    // Plan's anti-pattern: estimator that returns the raw body sum.
    // We must come in DRAMATICALLY under that.
    expect(compactedTotal).toBeLessThan(rawTotal);
    expect(compactedTotal).toBeLessThan(15_000);
  });
});

describe('compaction faithfulness — plan/execute/docGen path', () => {
  it('matches compactArtifacts(30_000) for the plan node', () => {
    const fixture: ResolvedArtifact[] = [
      ref('src/a.ts', 40_000),
      ctx('docs/b.md', 35_000),
      ref('src/c.ts', 4_000),
    ];
    const fromEstimator = applyNodeCompaction(fixture, 'plan');
    const direct = compactArtifacts(fixture, { threshold: 30_000 });
    expect(fromEstimator.map(a => a.path)).toEqual(direct.map(a => a.path));
    expect(fromEstimator.map(a => a.content.length)).toEqual(
      direct.map(a => a.content.length),
    );
  });

  it('matches compactArtifacts(30_000) for execute and docGen', () => {
    const fixture: ResolvedArtifact[] = [ref('src/a.ts', 80_000)];
    for (const node of ['execute', 'docGen']) {
      const fromEstimator = applyNodeCompaction(fixture, node);
      const direct = compactArtifacts(fixture, { threshold: 30_000 });
      expect(fromEstimator[0].content.length, `node=${node}`).toBe(
        direct[0].content.length,
      );
    }
  });
});
