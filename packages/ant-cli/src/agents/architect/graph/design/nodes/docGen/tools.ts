/**
 * Per-node state-aware tool-set selector for the design-job `docGen` phase.
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 *
 * The selector owns the per-intent dispatch matrix for the design job so
 * that `nodes/docGen/index.ts` stays focused on the streaming / parsing
 * loop. `useSourceFileTool` is plumbed in because it comes from
 * `buildMessages` (default intent) rather than state.
 */

import type { ToolDefinition } from '../../../../../../core/ports/llm';
import type { DesignGraphState } from '../../state';
import { getToolsByNames, TOOL_SETS } from '../../../../../common/tool/toolSchemas';
import { ToolName } from '../../../../../common/tool/toolCatalog';
import { isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';
import { READ_SOURCE_DOC_TOOL } from './sourceSelector';

export interface DocGenToolsOptions {
  useSourceFileTool?: boolean;
}

/**
 * When a sealed `<plan>` is present in `state.planText`, plan node has
 * already done external/architectural exploration. docGen's role is
 * path/symbol/asset verification, not re-derivation, so SEARCH_WEB is
 * dropped from the returned set. Mirrors code job's split where
 * `TOOL_SETS.codeBasic` (execute) omits SEARCH_WEB while
 * `TOOL_SETS.planExplore` (plan) carries it. See plan
 * `docs/architecture/15-design-job.md` and the
 * `plan-docgen-parallel-spring` plan file.
 */
function applyPlanGate(state: DesignGraphState, tools: ToolDefinition[]): ToolDefinition[] {
  const hasSealedPlan = !!state.planText && state.planText.trim().length > 0;
  if (!hasSealedPlan) return tools;
  return tools.filter(t => t.name !== ToolName.SEARCH_WEB);
}

export async function getTools(
  state: DesignGraphState,
  options: DocGenToolsOptions = {},
): Promise<ToolDefinition[]> {
  const { useSourceFileTool = false } = options;
  const intentGroup = state.resolvedAction?.intentGroup;
  const isExplainMode = state.resolvedAction?.mode === 'explain';
  const isFigmaUiDesign =
    intentGroup === 'design-ui' &&
    isFigmaPipeline(
      state.resolvedAction?.intent,
      isFigmaDataPopulated(state.figmaConfig),
    );
  const isSpecFigma = intentGroup === 'design-spec' && state.figmaAvailable === true;

  let tools: ToolDefinition[];
  if (isExplainMode) tools = getToolsByNames(TOOL_SETS.designExplain);
  else if (isFigmaUiDesign) tools = getToolsByNames(TOOL_SETS.uiDesignFigma);
  else if (intentGroup === 'design-ui') tools = getToolsByNames(TOOL_SETS.uiDesign);
  else if (isSpecFigma) tools = getToolsByNames(TOOL_SETS.specFigma);
  else if (useSourceFileTool) tools = [...getToolsByNames(TOOL_SETS.design), READ_SOURCE_DOC_TOOL];
  else tools = getToolsByNames(TOOL_SETS.design);

  return applyPlanGate(state, tools);
}
