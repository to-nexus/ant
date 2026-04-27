/**
 * Design Tool Adapters
 *
 * Returns a Map<toolName, ToolHandler> of *design-only* handlers that the
 * design tool node registers on top of the catalog-derived registry
 * (`createDesignToolRegistry()`). Common fs / figma / web-search handlers
 * already live in the catalog and need no override here.
 *
 * All handlers use the unified `(ctx, args) => Promise<ToolResult>`
 * signature — no `stateFromCtx` proxy, no state-shaped legacy. State data
 * the handlers need (artifact pool, asset pool root, figma exploration
 * result, …) is injected by the design tool node's `buildContext` into
 * `ToolExecutionContext`.
 *
 * Figma tools delegate to the common handler with a thin design-only
 * pre-check (`maybeRootCallGuidance`) that short-circuits root-node
 * queries when a `nodeSummary` is loaded.
 */

import type { ToolHandler } from '../../../../../common/tool/types';
import { handleFigmaTool as commonHandleFigmaTool } from '../../../../../common/tool/handlers/figma';
import { handleCreateFile } from '../../../../../common/tool/handlers';
import { maybeRootCallGuidance } from './rootCallGuidance';
import {
  handleReadSourceDoc,
  handleDownloadAsset,
  handleListAssets,
  handleAppendFile,
} from './handlers';

const FIGMA_TOOLS = [
  'figma_get_metadata',
  'figma_get_design_context',
  'figma_get_screenshot',
  'figma_get_variable_defs',
] as const;

export function createDesignToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  // Artifact pool reader (RAC-scoped).
  handlers.set('read_source_doc', handleReadSourceDoc as ToolHandler);

  // Asset pool — domain-keyed (D22).
  handlers.set('download_asset', handleDownloadAsset as ToolHandler);
  handlers.set('list_assets', handleListAssets as ToolHandler);

  // Hallucinated shadow-aliases. `write_file` reuses the common
  // create_file handler (overwrites or creates). `append_file` is the
  // design-only appender — common has no equivalent.
  handlers.set('write_file', handleCreateFile as ToolHandler);
  handlers.set('append_file', handleAppendFile as ToolHandler);

  // Figma tools — design pre-check + common handler.
  for (const toolName of FIGMA_TOOLS) {
    handlers.set(toolName, async (ctx, args) => {
      const guidance = maybeRootCallGuidance(ctx, args, toolName);
      if (guidance) {
        // No MCP call, no figma sideEffect — purely an LLM redirection hint.
        return { content: guidance };
      }
      return commonHandleFigmaTool(ctx, args, toolName);
    });
  }

  return handlers;
}
