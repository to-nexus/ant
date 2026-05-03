/**
 * Per-node tool-set selector for the design-job `plan` phase.
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 *
 * Plan-phase tools are strictly read-only:
 * - `designPlanExplore` is the default set (read_file, list_files,
 *   search_code, read_source_doc, search_web).
 * - When Figma data is available (UI / spec tasks against a Figma file),
 *   `designPlanFigma` adds the read-only Figma MCP tools.
 *
 * File-write tools (create_file / edit_file / append) and download_asset
 * are intentionally NOT exposed here — the plan node decides the
 * solution; docGen writes the document and downloads assets.
 */

import type { ToolDefinition } from '../../../../../../core/ports/llm';
import type { DesignGraphState } from '../../state';
import { getToolsByNames, TOOL_SETS } from '../../../../../common/tool/toolSchemas';
import { isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';

export async function getTools(state: DesignGraphState): Promise<ToolDefinition[]> {
  const intentGroup = state.resolvedAction?.intentGroup;
  const figmaActive =
    state.figmaAvailable === true ||
    (intentGroup === 'design-ui' &&
      isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig)));

  if (figmaActive) {
    return getToolsByNames(TOOL_SETS.designPlanFigma);
  }
  return getToolsByNames(TOOL_SETS.designPlanExplore);
}
