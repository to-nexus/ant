/**
 * Plan node tool set (read-only exploration).
 * Used when Plan has tools enabled to verify existing modules/structure.
 */

import type { ArchitectGraphState } from '../../state';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import { getToolsByNamesWithTemplates, TOOL_SETS, ToolName } from '../../../../../common/tool/toolSchemas';

export async function getPlanTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const names: ToolName[] = [...TOOL_SETS.planExplore];
  if (state.referenceRequests && state.referenceRequests.length > 0) {
    names.push(ToolName.SEARCH_REFERENCE);
  }
  const promptPort = state.deps?.promptBuilder;
  return getToolsByNamesWithTemplates(names, promptPort);
}
