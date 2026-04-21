/**
 * LLM client resolution + chat placeholder display for design decompose.
 *
 * Decompose-phase-local — `detect/strategy.ts` and `docGen/index.ts` have
 * inline `chatAPI.showChatStatus('placeholder')` duplicates but don't
 * route through a helper today; consolidating those is OUT OF SCOPE for
 * this partition.
 */

import type { DesignGraphState } from "../../state";

export async function resolveLLMClient(state: DesignGraphState) {
  const llm = state.deps?.llm;
  if (!state.workspaceConfig) return llm;

  const { createLLMClient } = await import(
    '../../../../../../periphery/adapters/llm/LLMClientFactory'
  );
  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'design', nodeType: 'decompose' },
    state.workspaceConfig,
  );
}

export async function showChatPlaceholder(): Promise<void> {
  const { getChatAPIClient } = await import(
    '../../../../../../core/adapters/ChatAPIClient'
  );
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
}
