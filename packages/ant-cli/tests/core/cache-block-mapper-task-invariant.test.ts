/**
 * CacheBlockMapper — taskInvariantParts slot tests.
 *
 * Guards the Block 2 cache-promotion axis: content that is fixed for the
 * lifetime of a task lives in Block 2 behind `cache_control` so it is
 * billed once per task instead of once per execute recursion. See
 * docs/tmp/cache-plantext-and-reverify-reuse.md for the background.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCacheableBlocks,
  type CacheBlockOptions,
} from '../../src/core/prompt/builder/CacheBlockMapper';
import type { PromptBuildResult } from '../../src/core/prompt/builder/PromptBuildConfig';

function makeResult(overrides: Partial<PromptBuildResult> = {}): PromptBuildResult {
  return {
    user: 'USER_BASE',
    sections: {
      guardrail: '',
      systemBase: 'SYSTEM_BASE',
      profiles: '',
      rules: '',
      examples: '',
      policy: '',
      injections: 'INJECTIONS',
      failedTemplates: [],
    } as any,
    injections: [],
    ...overrides,
  } as any;
}

describe('CacheBlockMapper — taskInvariantParts', () => {
  it('appends taskInvariantParts to Block 2 AFTER contextParts', () => {
    const blocks = buildCacheableBlocks(makeResult(), {
      contextParts: ['CTX_1'],
      taskInvariantParts: ['INVARIANT_PLAN_JSON'],
    });

    // Block 1: systemBase (cached), Block 2: injections + contextParts + invariant (cached), Block 3: user
    expect(blocks).toHaveLength(3);

    const block2 = blocks[1];
    expect(block2.type).toBe('text');
    expect((block2 as any).cache_control).toEqual({ type: 'ephemeral' });
    const text = (block2 as any).text as string;

    // Order: injections → contextParts → taskInvariantParts
    const iInj = text.indexOf('INJECTIONS');
    const iCtx = text.indexOf('CTX_1');
    const iInv = text.indexOf('INVARIANT_PLAN_JSON');

    expect(iInj).toBeGreaterThanOrEqual(0);
    expect(iCtx).toBeGreaterThan(iInj);
    expect(iInv).toBeGreaterThan(iCtx);
  });

  it('creates Block 2 even when only taskInvariantParts are provided', () => {
    const blocks = buildCacheableBlocks(
      makeResult({
        sections: {
          guardrail: '',
          systemBase: 'SYSTEM_BASE',
          profiles: '',
          rules: '',
          examples: '',
          policy: '',
          injections: '', // no injections
          failedTemplates: [],
        } as any,
      }),
      {
        taskInvariantParts: ['STANDALONE_INVARIANT'],
      },
    );

    // Block 1 (systemBase), Block 2 (invariant only), Block 3 (user)
    expect(blocks).toHaveLength(3);
    expect((blocks[1] as any).text).toContain('STANDALONE_INVARIANT');
    expect((blocks[1] as any).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('omits Block 2 when neither contextParts nor taskInvariantParts nor injections present', () => {
    const blocks = buildCacheableBlocks(
      makeResult({
        sections: {
          guardrail: '',
          systemBase: 'SYSTEM_BASE',
          profiles: '',
          rules: '',
          examples: '',
          policy: '',
          injections: '',
          failedTemplates: [],
        } as any,
      }),
      {},
    );

    // Only Block 1 (systemBase) + Block 3 (user) — no Block 2
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as any).text).toContain('SYSTEM_BASE');
    expect((blocks[1] as any).text).toContain('USER_BASE');
    expect((blocks[1] as any).cache_control).toBeUndefined();
  });

  it('preserves taskInvariantParts even when tokenPreflight drops contextParts', () => {
    const bigContext = 'X'.repeat(10_000);
    const options: CacheBlockOptions = {
      contextParts: [bigContext],
      taskInvariantParts: ['MUST_SURVIVE_INVARIANT'],
      tokenPreflight: {
        maxBlock2Tokens: 100, // force drop
        estimateTokens: (t) => t.length, // 1 char == 1 token for test
      },
    };

    const blocks = buildCacheableBlocks(makeResult(), options);
    const block2Text = (blocks[1] as any).text as string;

    // contextParts dropped, invariant survives
    expect(block2Text).not.toContain(bigContext);
    expect(block2Text).toContain('MUST_SURVIVE_INVARIANT');
  });

  it('filters out empty/falsy taskInvariantParts entries', () => {
    const blocks = buildCacheableBlocks(makeResult(), {
      taskInvariantParts: ['KEPT', '', null as any, undefined as any, 'ALSO_KEPT'],
    });

    const text = (blocks[1] as any).text as string;
    expect(text).toContain('KEPT');
    expect(text).toContain('ALSO_KEPT');
    // No stray blank lines between entries should leak null/undefined tokens
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('does not leak taskInvariantParts into Block 3', () => {
    const blocks = buildCacheableBlocks(makeResult(), {
      taskInvariantParts: ['INVARIANT_ONLY_IN_BLOCK_2'],
      runtimeParts: ['RUNTIME_IN_BLOCK_3'],
    });

    // Block 2 (cached): invariant
    expect((blocks[1] as any).text).toContain('INVARIANT_ONLY_IN_BLOCK_2');
    expect((blocks[1] as any).text).not.toContain('RUNTIME_IN_BLOCK_3');

    // Block 3 (uncached): runtime
    expect((blocks[2] as any).text).toContain('RUNTIME_IN_BLOCK_3');
    expect((blocks[2] as any).text).not.toContain('INVARIANT_ONLY_IN_BLOCK_2');
    expect((blocks[2] as any).cache_control).toBeUndefined();
  });
});
