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
import { allowsPersistentProcesses } from '../../tasks/_shared/verify/persistentProcessGate';

export async function getTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const names: ToolName[] = [...TOOL_SETS.planExplore];
  if (state.referenceRequests && state.referenceRequests.length > 0) {
    names.push(ToolName.SEARCH_REFERENCE);
  }
  // Runtime route-verification tool — reproducer plan tool-loop may probe a
  // live server. Gate via the shared SSOT predicate (R1, never task.type).
  if (allowsPersistentProcesses(state)) {
    names.push(ToolName.HTTP_REQUEST);
  }
  const promptPort = state.deps?.promptBuilder;
  return getToolsByNamesWithTemplates(names, promptPort);
}
