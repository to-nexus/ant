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
 * Remove `fileKey` from a Figma tool schema so the LLM doesn't need to supply it.
 * The Code Job tool handler auto-injects `state.figmaFileKey` at runtime.
 */
function removeFigmaFileKeyFromSchema(tool: ToolDefinition): ToolDefinition {
  const FIGMA_TOOLS = ['figma_get_design_context', 'figma_get_screenshot', 'figma_get_variable_defs', 'figma_get_metadata'];
  if (!FIGMA_TOOLS.includes(tool.name)) return tool;

  const schema = tool.input_schema;
  if (!schema?.properties) return tool;

  const { fileKey, ...restProps } = schema.properties as Record<string, any>;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r: string) => r !== 'fileKey')
    : schema.required;

  return {
    ...tool,
    input_schema: { ...schema, properties: restProps, required },
  };
}

/**
 * Get available tools (filtered by state)
 * Loads tool descriptions from templates using PromptPort
 */
export async function getAvailableTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;
  
  let toolNames: ToolName[] = [...TOOL_SETS.codeBasic];
  
  if (hasReferences) {
    toolNames.push('search_reference_code');
  }

  const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
  const figmaToolsEnabled = state.figmaAvailable && !new ArtifactPoolView(state.artifacts || []).hasUi();
  if (figmaToolsEnabled) {
    const taskType = state.currentTask?.type;
    const isFrontendTask = taskType === 'ui' || taskType === 'feature' || taskType === 'design-system';
    if (isFrontendTask) {
      toolNames.push('figma_get_design_context', 'figma_get_screenshot',
        'figma_get_variable_defs', 'figma_get_metadata');
    }
  }

  const promptPort = state.deps?.promptBuilder;
  let tools = await getToolsByNamesWithTemplates(toolNames, promptPort);

  if (figmaToolsEnabled) {
    tools = tools.map(t => removeFigmaFileKeyFromSchema(t));
  }

  return tools;
}
