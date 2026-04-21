/**
 * Per-node state-aware tool-set selector for the `execute` phase.
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 *
 * Tool policy:
 *   - explain mode → `TOOL_SETS.codeExplain` (read-only)
 *   - generate / refactor → `TOOL_SETS.codeBasic` (+ reference / figma gating)
 *
 * Responsible for:
 *   - Base tool-set selection from `TOOL_SETS` in `common/tool/toolSchemas`.
 *   - State-aware filtering (explain mode, reference search availability, figma gating).
 *   - Template-driven description rendering via `PromptPort`.
 */

import { ArchitectGraphState } from "../../state";
import type { ToolDefinition } from "../../../../../../core/ports/llm";
import { getToolsByNamesWithTemplates, TOOL_SETS, ToolName } from "../../../../../common/tool/toolSchemas";
import { isUiTask } from "../../tasks/ui/model/is";
import { isFeatureTask } from "../../tasks/feature/model/is";
import { isDesignSystemTask } from "../../tasks/design-system/model/is";

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
 * Get tools available to the `execute` node for the given state.
 * Loads tool descriptions from templates using PromptPort.
 */
export async function getTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const promptPort = state.deps?.promptBuilder;

  if (state.resolvedAction?.mode === 'explain') {
    return getToolsByNamesWithTemplates([...TOOL_SETS.codeExplain], promptPort);
  }

  const hasReferences = state.referenceRequests && state.referenceRequests.length > 0;

  let toolNames: ToolName[] = [...TOOL_SETS.codeBasic];

  if (hasReferences) {
    toolNames.push(ToolName.SEARCH_REFERENCE);
  }

  const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
  const figmaToolsEnabled = state.figmaAvailable && !new ArtifactPoolView(state.artifacts || []).hasUi();
  if (figmaToolsEnabled) {
    // R1 — phase layer is blind to `task.type`; delegate to the per-task
    // predicates defined in `tasks/{ui,feature,design-system}/model/is.ts`.
    // The three predicates together enumerate every frontend-oriented
    // task type that the Figma MCP toolset is allowed to surface for.
    const currentTask = state.currentTask;
    const isFrontendTask =
      isUiTask(currentTask) || isFeatureTask(currentTask) || isDesignSystemTask(currentTask);
    if (isFrontendTask) {
      toolNames.push(ToolName.FIGMA_DESIGN_CTX, ToolName.FIGMA_SCREENSHOT,
        ToolName.FIGMA_VARIABLES, ToolName.FIGMA_METADATA);
    }
  }

  let tools = await getToolsByNamesWithTemplates(toolNames, promptPort);

  if (figmaToolsEnabled) {
    tools = tools.map(t => removeFigmaFileKeyFromSchema(t));
  }

  return tools;
}
