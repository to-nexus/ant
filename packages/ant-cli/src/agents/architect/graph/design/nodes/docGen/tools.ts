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
import { isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';
import { READ_SOURCE_DOC_TOOL } from './sourceSelector';

export interface DocGenToolsOptions {
  useSourceFileTool?: boolean;
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

  if (isExplainMode) return getToolsByNames(TOOL_SETS.designExplain);
  if (isFigmaUiDesign) return getToolsByNames(TOOL_SETS.uiDesignFigma);
  if (intentGroup === 'design-ui') return getToolsByNames(TOOL_SETS.uiDesign);
  if (isSpecFigma) return getToolsByNames(TOOL_SETS.specFigma);
  if (useSourceFileTool) {
    return [...getToolsByNames(TOOL_SETS.design), READ_SOURCE_DOC_TOOL];
  }
  return getToolsByNames(TOOL_SETS.design);
}
