/**
 * Tool Definitions for CodeGen Node
 * 
 * Uses common tool definitions from shared location.
 */

import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";
import { getToolsByNames, TOOL_SETS } from "../../../../tools/definitions";

/**
 * Get available tools (filtered by state)
 */
export function getAvailableTools(state: ArchitectGraphState): ToolDefinition[] {
  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;
  
  // ✅ Use common tool definitions
  let toolNames = [...TOOL_SETS.codeBasic];
  
  // ✅ Add search_reference_code tool ONLY if references are available
  if (hasReferences) {
    toolNames.push('search_reference_code');
  }
  
  return getToolsByNames(toolNames);
}
