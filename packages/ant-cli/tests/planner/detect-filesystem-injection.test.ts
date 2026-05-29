/**
 * Regression — planner-side detect crash (navy-keeping-polar, 2026-05-29).
 *
 * The infer branch of `createInferDetectNode` calls `inferRacWithTools` which
 * resolves tool paths via `state.deps.fileSystem.getRootPath()`. Pre-fix, the
 * planner orchestrator built `deps` without `fileSystem`, so any free-text
 * chat routed to the planner (rev-plan / gen-prd via chat / explain-plan / ...)
 * crashed with an anonymous `TypeError: Cannot read properties of undefined`.
 *
 * Post-fix, detect/index.ts validates `state.deps.fileSystem` alongside `llm`
 * and `promptBuilder` and throws a self-explanatory error. This test pins that
 * guard so a future agent forgetting the DI gets a clear failure instead of
 * the original anonymous crash.
 */

import { describe, it, expect } from 'vitest';
import { createInferDetectNode } from '../../src/agents/common/graph/nodes/detect';
import type { DetectableState } from '../../src/agents/common/graph/nodes/detect/types';

function buildInferBranchState(overrides: Partial<DetectableState> = {}): DetectableState {
  return {
    triageResult: { resolvedIntentId: 'rev-plan' } as any,
    actionMetadata: undefined,
    resolvedAction: undefined,
    currentAgent: undefined,
    currentJob: undefined,
    workspaceState: { featurePath: '/tmp/feature' } as any,
    featurePath: '/tmp/feature',
    recursionCount: 0,
    recursionLimit: 10,
    ...overrides,
  } as unknown as DetectableState;
}

const stubLLM = { call: async () => '' } as any;
const stubPromptBuilder = { render: async () => '', build: async () => ({}) } as any;
const stubFileSystem = { getRootPath: () => '/tmp/feature' } as any;

describe('createInferDetectNode — fileSystem dep guard', () => {
  it('throws the actionable error when state.deps.fileSystem is missing', async () => {
    const node = createInferDetectNode();
    const state = buildInferBranchState({
      deps: { llm: stubLLM, promptBuilder: stubPromptBuilder /* no fileSystem */ },
    } as any);

    await expect(node(state)).rejects.toThrow(
      /FileSystemPort not available — orchestrator must inject state\.deps\.fileSystem/,
    );
  });

  it('still throws on missing LLM before reaching the fileSystem guard', async () => {
    const node = createInferDetectNode();
    const state = buildInferBranchState({
      deps: { promptBuilder: stubPromptBuilder, fileSystem: stubFileSystem /* no llm */ },
    } as any);

    await expect(node(state)).rejects.toThrow(/LLM not available/);
  });

  it('does NOT throw on the fileSystem guard when all three deps are present', async () => {
    // The infer branch will continue into inferRacWithTools which will fail
    // for unrelated reasons against the stubs (no slot matrix entry / parse
    // errors / etc.) — we only assert the guard itself is satisfied.
    const node = createInferDetectNode();
    const state = buildInferBranchState({
      deps: { llm: stubLLM, promptBuilder: stubPromptBuilder, fileSystem: stubFileSystem },
    } as any);

    await expect(node(state)).rejects.not.toThrow(/FileSystemPort not available/);
  });
});
