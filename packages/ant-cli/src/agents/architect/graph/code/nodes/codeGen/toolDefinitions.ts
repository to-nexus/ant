/**
 * Tool Definitions for CodeGen Node
 * 
 * Uses common tool definitions from shared location.
 * Tool descriptions are loaded from templates via PromptPort.render()
 */

import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";
import { getToolsByNamesWithTemplates, TOOL_SETS, ToolName } from "../../../../tools/definitions";

/**
 * Get available tools (filtered by state)
 * Loads tool descriptions from templates using PromptPort
 */
export async function getAvailableTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;
  
  // ✅ Use common tool definitions
  let toolNames: ToolName[] = [...TOOL_SETS.codeBasic];
  
  // ✅ Add search_reference_code tool ONLY if references are available
  if (hasReferences) {
    toolNames.push('search_reference_code');
  }
  
  // ✅ Load tool descriptions from templates using PromptPort
  const promptPort = state.deps?.promptEngine?.deps?.promptPort;
  return getToolsByNamesWithTemplates(toolNames, promptPort);
}
