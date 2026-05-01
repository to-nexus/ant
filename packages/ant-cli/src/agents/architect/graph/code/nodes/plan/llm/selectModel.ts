/**
 * Plan-node LLM selector.
 *
 * Re-resolves the LLM client through the workspace-config-aware factory
 * so the plan node can pick a different model (e.g. higher tier) than
 * the graph-default `state.deps.llm`. Falls back to the default LLM
 * when no `workspaceConfig` is attached to the state (test harnesses /
 * legacy callers).
 */

import { LLMClient } from "../../../../../../../core/ports";
import { ArchitectGraphState } from "../../../state";
import { CodeTask } from "../../../../../types/task";

export async function selectLLMForTask(
  defaultLLM: LLMClient,
  _task: CodeTask,
  state: ArchitectGraphState
): Promise<LLMClient> {
  if (!state.workspaceConfig) {
    return defaultLLM;
  }

  const { createLLMClient } = await import('../../../../../../../periphery/adapters/llm/LLMClientFactory');

  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'code', nodeType: 'plan' },
    state.workspaceConfig
  );
}
