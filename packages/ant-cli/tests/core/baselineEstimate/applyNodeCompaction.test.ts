/**
 * applyNodeCompaction dispatch — regression guard.
 *
 * Locks the two SSOT branches:
 *   - `node === 'decompose'` → role-scoped compaction (refs 8K / ctx 2K)
 *     via `prepareRacInjection`.
 *   - everything else        → uniform 30K compaction via `compactArtifacts`.
 *
 * Critical: there is no raw-body fall-through path. The plan's "왜곡 회귀
 * 1차 가드" requires that no node skips compaction — otherwise large
 * artifacts inflate the baseline 5-10× over the live first-call value.
 */

import { describe, it, expect } from 'vitest';
import type { ResolvedArtifact } from '@ant/shared';
import { applyNodeCompaction } from '../../../src/core/baselineEstimate/applyNodeCompaction';

function makeRef(path: string, sizeChars: number): ResolvedArtifact {
  return {
    path,
    role: 'ref',
    content: 'a'.repeat(sizeChars),
  };
}

function makeContext(path: string, sizeChars: number): ResolvedArtifact {
  return {
    path,
    role: 'context',
    content: 'a'.repeat(sizeChars),
  };
}

describe('applyNodeCompaction', () => {
  it('returns the input unchanged when artifacts are empty', () => {
    const out = applyNodeCompaction([], 'decompose');
    expect(out).toEqual([]);
  });

  it('plan: large body is compacted (uniform 30K threshold)', () => {
    const big = makeRef('big.md', 60_000);
    const out = applyNodeCompaction([big], 'plan');
    expect(out.length).toBe(1);
    expect(out[0].content.length).toBeLessThan(big.content.length);
    expect(out[0].wasCompacted).toBe(true);
  });

  it('execute: same uniform 30K threshold as plan', () => {
    const big = makeContext('big.ctx.md', 50_000);
    const out = applyNodeCompaction([big], 'execute');
    expect(out[0].wasCompacted).toBe(true);
  });

  it('docGen: same uniform 30K threshold', () => {
    const big = makeContext('big.gen.md', 40_000);
    const out = applyNodeCompaction([big], 'docGen');
    expect(out[0].wasCompacted).toBe(true);
  });

  it('unknown node (detect / agent / sketch / explain): also compacts (no raw fall-through)', () => {
    const big = makeRef('huge.md', 70_000);
    for (const node of ['detect', 'agent', 'sketch', 'explain', 'generate']) {
      const out = applyNodeCompaction([big], node);
      expect(out[0].wasCompacted, `node=${node}`).toBe(true);
    }
  });

  it('decompose: small artifacts pass through (under role thresholds)', () => {
    const smallRef = makeRef('small.ref.md', 500);
    const smallCtx = makeContext('small.ctx.md', 500);
    const out = applyNodeCompaction([smallRef, smallCtx], 'decompose');
    // Path / count preserved; bodies untouched at this size.
    expect(out.length).toBe(2);
    expect(out.find(a => a.path === 'small.ref.md')?.content.length).toBe(500);
    expect(out.find(a => a.path === 'small.ctx.md')?.content.length).toBe(500);
  });

  it('decompose: oversized context (>2K) gets demoted/outlined', () => {
    const bigCtx = makeContext('big.ctx.md', 20_000);
    const out = applyNodeCompaction([bigCtx], 'decompose');
    // The role-scoped pipeline either compacts or restructures — what
    // matters is the body shrank from the raw 20K. (Lower bound: <10K.)
    const totalChars = out.reduce((sum, a) => sum + (a.content?.length ?? 0), 0);
    expect(totalChars).toBeLessThan(10_000);
  });
});
