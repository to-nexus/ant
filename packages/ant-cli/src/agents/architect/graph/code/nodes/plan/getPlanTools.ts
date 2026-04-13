/**
 * Plan node tool set (read-only exploration).
 * Used when Plan has tools enabled to verify existing modules/structure.
 */

import type { ArchitectGraphState } from '../../state';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import { getToolsByNamesWithTemplates, TOOL_SETS, type ToolName } from '../../../../tools/definitions';

export async function getPlanTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const names: ToolName[] = [...TOOL_SETS.planExplore];
  if (state.referenceRequests && state.referenceRequests.length > 0) {
    names.push('search_reference_code');
  }
  const promptPort = state.deps?.promptBuilder;
  return getToolsByNamesWithTemplates(names, promptPort);
}
