/**
 * Execute-loop cache stability regression.
 *
 * Before the verification-loop postmortem fix, the execute node mid-loop
 * merged streamedFiles/registryFiles into `state.projectCodeContext.filePaths`
 * before returning it on every turn (see the removed block near
 * `execute/index.ts:470-482` and `:663-682`). That caused the block2
 * `retrieved-code.md` / file-tree render surface to mutate turn-over-turn
 * and invalidated Anthropic prompt-cache keys — observed as
 * `cache_instability` events on ui-landing-visual (×4) and test-landing
 * (×2) in the `faint-lining-shelf` job debug log.
 *
 * The minimal-invasive fix: execute does NOT return `projectCodeContext`
 * at all. LangGraph's `LastValue` reducer preserves the plan-set snapshot
 * across turns. LLM awareness of newly-written files reaches the prompt
 * via conversation `tool_result` blocks — this is redundant-path removal,
 * not information removal.
 *
 * These tests lock the two invariants that make that fix sound:
 *  (1) `buildCacheableBlocks` with identical inputs produces identical
 *      block text (hash-stable — LangGraph ports rely on this for cache
 *      hits across turns).
 *  (2) `buildRuntimeContext` / `generateFileTree` are pure w.r.t.
 *      `state.projectCodeContext`: repeated calls with the same input
 *      produce the same output.
 */

import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';
import { buildCacheableBlocks } from '../src/core/prompt/builder/CacheBlockMapper';
import {
  buildRuntimeContext,
  generateFileTree,
} from '../src/agents/architect/graph/code/nodes/execute/buildMessages';

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex').slice(0, 12);
}

function makeState(overrides: Record<string, any> = {}): any {
  return {
    currentTask: { id: 'task-1', name: 'T', description: 'd' },
    projectCodeContext: {
      source: 'plan',
      filePaths: ['codebase/src/a.ts', 'codebase/src/b.ts'],
      files: [
        { path: 'codebase/src/a.ts', content: 'export const a = 1;' },
        { path: 'codebase/src/b.ts', content: 'export const b = 2;' },
      ],
      stats: { filesLoaded: 2, estimatedTokens: 100 },
    },
    context: {},
    ...overrides,
  };
}

describe('execute-loop cache stability', () => {
  it('buildCacheableBlocks — identical PromptBuildResult produces identical block text', () => {
    const result = {
      system: '',
      user: 'USER MESSAGE',
      sections: {
        systemBase: 'BASE',
        rules: 'RULES',
        injections: 'INJECTIONS_BODY',
        profiles: '',
        examples: '',
        guardrail: '',
        policy: '',
        failedTemplates: [],
      },
      injections: [] as string[],
      buildTimeMs: 0,
    };

    const blocks1 = buildCacheableBlocks(result, {});
    const blocks2 = buildCacheableBlocks(result, {});

    const b1text1 = blocks1[0]?.type === 'text' ? blocks1[0].text : '';
    const b1text2 = blocks2[0]?.type === 'text' ? blocks2[0].text : '';
    const b2text1 = blocks1[1]?.type === 'text' ? blocks1[1].text : '';
    const b2text2 = blocks2[1]?.type === 'text' ? blocks2[1].text : '';

    expect(md5(b1text1)).toBe(md5(b1text2));
    expect(md5(b2text1)).toBe(md5(b2text2));
  });

  it('buildRuntimeContext — identical state produces identical output', () => {
    const state1 = makeState();
    const state2 = makeState(); // same structure
    expect(buildRuntimeContext(state1)).toBe(buildRuntimeContext(state2));
  });

  it('generateFileTree — identical state.projectCodeContext produces identical output', () => {
    const state = makeState();
    const a = generateFileTree(state);
    const b = generateFileTree(state);
    expect(a).toBe(b);
  });

  it('generateFileTree — additional filePaths change output (controls the stability guarantee)', () => {
    // Positive control: the function IS sensitive to projectCodeContext.filePaths,
    // so keeping that field stable across execute turns (Fix C invariant) is
    // what preserves block3/runtimeContext stability. If the execute node
    // started mutating projectCodeContext again, output would drift.
    const before = generateFileTree(makeState());
    const after = generateFileTree(makeState({
      projectCodeContext: {
        source: 'plan',
        filePaths: ['codebase/src/a.ts', 'codebase/src/b.ts', 'codebase/src/c.ts'],
        files: [
          { path: 'codebase/src/a.ts', content: 'export const a = 1;' },
          { path: 'codebase/src/b.ts', content: 'export const b = 2;' },
        ],
        stats: { filesLoaded: 2, estimatedTokens: 100 },
      },
    }));
    expect(before).not.toBe(after);
  });
});
