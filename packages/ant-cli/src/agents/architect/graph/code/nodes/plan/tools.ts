/**
 * Per-node state-aware tool-set selector for the `plan` phase (read-only
 * exploration tools used to verify existing modules / structure before
 * decomposition).
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 */

import type { ArchitectGraphState } from '../../state';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import { getToolsByNamesWithTemplates, TOOL_SETS, ToolName } from '../../../../../common/tool/toolSchemas';

export async function getTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const names: ToolName[] = [...TOOL_SETS.planExplore];
  if (state.referenceRequests && state.referenceRequests.length > 0) {
    names.push(ToolName.SEARCH_REFERENCE);
  }
  const promptPort = state.deps?.promptBuilder;
  return getToolsByNamesWithTemplates(names, promptPort);
}
