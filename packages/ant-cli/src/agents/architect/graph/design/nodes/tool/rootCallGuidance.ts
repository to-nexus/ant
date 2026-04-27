/**
 * Root-call guidance — design-only pre-check for figma tools.
 *
 * When the LLM calls a figma tool with the root nodeId (`0:1` / `0-1`)
 * while a `nodeSummary` is available from `figmaExplore`, we short-circuit
 * the MCP call and return a guidance JSON listing the top-level frames so
 * the LLM redirects to specific nodes instead of pulling the entire canvas.
 *
 * Lives in the design tool layer because it depends on
 * `ctx.figmaExplorationResult.nodeSummary` (a design-only artifact populated
 * by the design `figmaExplore` phase). Code job's figma usage doesn't run
 * `figmaExplore` and thus never carries `nodeSummary` — the guard is a
 * no-op there. Keeping the policy in design rather than `common/tool/`
 * preserves the common handler's domain neutrality.
 */

import type { ToolExecutionContext } from '../../../../../common/tool/types';

const ROOT_NODE_IDS = new Set(['0:1', '0-1']);

/**
 * Return a guidance JSON string when the call should be redirected, or
 * `null` to let the call proceed via the common figma handler.
 */
export function maybeRootCallGuidance(
  ctx: ToolExecutionContext,
  args: Record<string, any>,
  toolName: string,
): string | null {
  if (toolName === 'figma_get_screenshot') return null;

  const nodeId = (args as any)?.nodeId as string | undefined;
  if (!nodeId || !ROOT_NODE_IDS.has(nodeId)) return null;

  const nodeSummary = ctx.figmaExplorationResult?.nodeSummary;
  if (!nodeSummary || nodeSummary.length === 0) return null;

  const topFrames = nodeSummary
    .filter((n: any) => n.depth <= 1 && (n.type === 'FRAME' || n.type === 'SECTION'))
    .map((n: any) => `  - ${n.name} (nodeId: ${n.nodeId}, type: ${n.type}, children: ${n.childCount})`)
    .join('\n');

  return JSON.stringify({
    warning: 'Root node query returns too much data. Use specific nodeIds instead.',
    guidance: `Query individual frames/sections for detailed data. Available top-level nodes:\n${topFrames || '  (no top-level frames found)'}`,
    tool: toolName,
    availableNodeCount: nodeSummary.length,
  });
}
