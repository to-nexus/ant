/**
 * Design Tool Adapters
 *
 * Wraps Design-specific handlers (old state-based signature) into unified
 * ToolHandler signature (ctx: ToolExecutionContext, args) => ToolResult.
 *
 * These adapters bridge the gap during migration. The handlers themselves
 * remain in ./handlers/ with their original signatures.
 */

import type { ToolHandler, ToolResult } from '../../../../../common/tool/types';
import type { DesignGraphState } from '../../state';
import {
  handleReadFile,
  handleListFiles,
  handleSearchCode,
  handleDeleteFile,
  handleEditFile,
  handleMkdir,
  handleHallucinatedFileWrite,
  handleFigmaTool,
  handleReadSourceFileFromState,
  handleDownloadAsset,
  handleListAssets,
} from './handlers';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';

function wrapStringResult(result: string | string[]): ToolResult {
  const content = Array.isArray(result) ? result.join('\n') : result;
  const isError = content.startsWith('Error:');
  return { content, error: isError ? content : undefined };
}

/**
 * Create Design-specific tool handlers adapted to ToolHandler signature.
 *
 * Handlers receive ToolExecutionContext (populated by buildContext in tool/index.ts)
 * and construct minimal state-like proxies for legacy handler signatures.
 * No getState() closure — all data flows through ctx.
 */
export function createDesignToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  /** Build a minimal state proxy from ctx for legacy handlers */
  function stateFromCtx(ctx: import('../../../../../common/tool/types').ToolExecutionContext): DesignGraphState {
    return {
      context: { featurePath: ctx.featurePath || ctx.workingDir, projectName: ctx.project, featureFolder: ctx.featureFolder },
      deps: { fileSystem: ctx.fileSystem, git: ctx.git, redis: ctx.redis, fileTreeUpdate: ctx.fileTreeUpdate },
      artifacts: ctx.sourceDocuments,
      uiAssetsList: ctx.uiAssetsList,
      existingDesignDocs: ctx.existingDesignDocs,
      figmaExplorationResult: ctx.figmaExplorationResult,
      figmaAvailable: ctx.figmaAvailable,
      figmaFileKey: ctx.figmaFileKey,
      figmaConfig: ctx.figmaConfig,
    } as any;
  }

  // read_source_doc: reads from artifact pool, needs ChatAPI for source reading UI
  handlers.set('read_source_doc', async (ctx, args) => {
    const state = stateFromCtx(ctx);
    const { filename, startLine, endLine } = args as { filename: string; startLine?: number; endLine?: number };
    const chatAPI = getChatAPIClient();
    const readIdx = await chatAPI.addReadingSource(filename, startLine, endLine);
    const result = handleReadSourceFileFromState(state, { filename, startLine, endLine });
    const totalMatch = typeof result === 'string' ? result.match(/of (\d+)\]/) : null;
    const totalLines = totalMatch ? Number(totalMatch[1]) : undefined;
    const isError = typeof result === 'string' && result.startsWith('Error:');
    await chatAPI.addReadSourceComplete(filename, readIdx, {
      error: isError ? result : undefined,
      startLine, endLine, totalLines,
    });
    return { content: result, error: isError ? result : undefined };
  });

  // download_asset: needs ChatAPI for download status UI
  handlers.set('download_asset', async (ctx, args) => {
    const state = stateFromCtx(ctx);
    const dlChatAPI = getChatAPIClient();
    const dlFilename = (args as any).filename || 'asset';
    const dlMergeIdx = await dlChatAPI.showChatStatus('downloading', { filename: dlFilename });
    try {
      const result = await handleDownloadAsset(state, args as { url: string; filename: string; category?: string });
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      const sizeKB = parsed?.sizeBytes ? (parsed.sizeBytes / 1024).toFixed(1) : undefined;
      const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(parsed?.path || '');
      await dlChatAPI.showChatStatus('downloaded', {
        filename: dlFilename, sizeKB, _mergeIndex: dlMergeIdx,
        ...(isImage && parsed?.path ? { imagePath: parsed.path } : {}),
      });
      return { content: result };
    } catch (err: any) {
      await dlChatAPI.showChatStatus('downloaded', { filename: dlFilename, error: true, _mergeIndex: dlMergeIdx });
      return { content: JSON.stringify({ error: err.message }), error: err.message };
    }
  });

  // list_assets
  handlers.set('list_assets', async (ctx, args) => {
    const state = stateFromCtx(ctx);
    const result = await handleListAssets(state, args as any);
    return wrapStringResult(result);
  });

  // Figma tools: ctx carries figmaExplorationResult, figmaConfig, etc.
  for (const figmaToolName of ['figma_get_metadata', 'figma_get_design_context', 'figma_get_screenshot', 'figma_get_variable_defs']) {
    handlers.set(figmaToolName, async (ctx, args) => {
      const state = stateFromCtx(ctx);
      const result = await handleFigmaTool(figmaToolName, state, args);

      if (result && typeof result === 'object' && result.__figmaImage) {
        return {
          content: [
            { type: 'image', source: { type: 'base64', media_type: result.mimeType, data: result.base64 } },
            { type: 'text', text: '✅ Figma screenshot captured.\n\nAnalyze the visual layout, spacing, colors, typography, and component structure visible above.' },
          ],
          sideEffects: [{ type: 'figmaSuccess' as const }],
        };
      }
      if (result && typeof result === 'object' && result.__figmaComposite) {
        return {
          content: [
            { type: 'image', source: { type: 'base64', media_type: result.mimeType, data: result.base64 } },
            { type: 'text', text: result.text },
          ],
          sideEffects: [{ type: 'figmaSuccess' as const }],
        };
      }
      const textResult = typeof result === 'string' ? result : JSON.stringify(result);
      const isError = textResult.includes('"error"') || textResult.startsWith('Error:');
      return {
        content: textResult,
        error: isError ? textResult : undefined,
        sideEffects: isError ? [] : [{ type: 'figmaSuccess' as const }],
      };
    });
  }

  // Hallucinated file writes (shadow aliases)
  for (const hName of ['write_file', 'append_file']) {
    handlers.set(hName, async (ctx, args) => {
      const state = stateFromCtx(ctx);
      const isAppend = hName === 'append_file';
      const { path: filePath, content } = args as { path: string; content: string };
      if (!content) {
        return { content: `${hName} called without content. Use ${isAppend ? '<append>' : '<file>'} XML tag instead.`, error: 'No content' };
      }
      const result = await handleHallucinatedFileWrite(state, filePath, content, isAppend);
      console.warn(`⚠️  [Tool] LLM hallucinated ${hName} → auto-converted to file ${isAppend ? 'append' : 'write'} for ${filePath}`);
      return wrapStringResult(result);
    });
  }

  // Filesystem tools (delegate to old handlers with state proxy)
  const fsHandlerMap: Record<string, (state: DesignGraphState, args: any) => Promise<string>> = {
    'read_file': handleReadFile,
    'list_files': handleListFiles,
    'search_code': handleSearchCode,
    'delete_file': handleDeleteFile,
    'edit_file': handleEditFile,
    'mkdir': handleMkdir,
  };
  for (const [toolName, handler] of Object.entries(fsHandlerMap)) {
    handlers.set(toolName, async (ctx, args) => {
      const state = stateFromCtx(ctx);
      const result = await handler(state, args);
      return wrapStringResult(result);
    });
  }

  return handlers;
}
