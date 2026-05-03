/**
 * Plan-phase LLM client resolver for design jobs.
 *
 * Re-resolves the LLM client through the workspace-config-aware factory
 * so the plan node can pick a different model (e.g. higher tier) than
 * the graph-default `state.deps.llm`. Falls back to the default LLM
 * when no `workspaceConfig` is attached to the state.
 *
 * Mirrors `decompose/llmClient.ts` so design-job per-node selection
 * stays consistent.
 */

import type { LLMClient } from '../../../../../../core/ports';
import type { DesignGraphState } from '../../state';

export async function resolveLLMClient(state: DesignGraphState): Promise<LLMClient | undefined> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!state.workspaceConfig) return llm;

  const { createLLMClient } = await import(
    '../../../../../../periphery/adapters/llm/LLMClientFactory'
  );

  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'design', nodeType: 'plan' },
    state.workspaceConfig,
  );
}
