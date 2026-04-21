/**
 * Per-node state-aware tool-set selector for the `direct` phase (single-turn
 * ReAct loop used for oneshot / exploratory complexity).
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 *
 * Tool policy:
 *   - explain mode → `TOOL_SETS.codeExplain` (read-only)
 *   - generate / refactor → `TOOL_SETS.codeBasic` (full code set)
 */

import type { ArchitectGraphState } from '../../state';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import {
  getToolsByNamesWithTemplates,
  TOOL_SETS,
  ToolName,
} from '../../../../../common/tool/toolSchemas';

export async function getTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Direct/tools] PromptBuilder not available');
  }

  const isExplainMode = state.resolvedAction?.mode === 'explain';
  const toolNames: ToolName[] = isExplainMode
    ? [...TOOL_SETS.codeExplain]
    : [...TOOL_SETS.codeBasic];

  return getToolsByNamesWithTemplates(toolNames, promptBuilder);
}
