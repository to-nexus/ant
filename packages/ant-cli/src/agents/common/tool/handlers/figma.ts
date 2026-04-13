/**
 * Figma MCP handlers — context-injected version
 *
 * Side effects (figmaSuccess/figmaError) allow the calling node's hooks
 * to maintain error counters without coupling the handler to graph state.
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';

export async function handleFigmaTool(
  ctx: ToolExecutionContext,
  args: Record<string, any>,
  toolName: string,
): Promise<ToolResult> {
  const { callFigmaMCPTool, isFigmaImageResult, isFigmaCompositeResult, saveFigmaScreenshot } =
    await import('../../../architect/tools/figmaMCPHandler');

  if (!ctx.figmaFileKey) {
    return { content: 'Figma fileKey not configured', error: 'Figma fileKey not configured' };
  }

  const nodeId = args.nodeId as string | undefined;
  const statusMeta = { toolName, nodeId };
  const mergeIdx = await ctx.chatStatus.showStatus('figma_calling', statusMeta);

  try {
    const mcpResult = await callFigmaMCPTool(
      { userId: ctx.userId, redis: ctx.redis, taskId: undefined },
      toolName,
      ctx.figmaFileKey,
      args.nodeId,
    );

    let imagePath: string | undefined;
    const imageData = isFigmaImageResult(mcpResult)
      ? mcpResult
      : isFigmaCompositeResult(mcpResult) ? mcpResult.image : null;

    if (imageData && ctx.featurePath && args.nodeId) {
      try {
        imagePath = await saveFigmaScreenshot(ctx.featurePath, args.nodeId, imageData.base64, imageData.mimeType);
      } catch { /* non-critical */ }
    }

    await ctx.chatStatus.showStatus('figma_called', { ...statusMeta, imagePath, _mergeIndex: mergeIdx });

    const sideEffects: ToolSideEffect[] = [{ type: 'figmaSuccess' }];

    if (isFigmaImageResult(mcpResult)) {
      return {
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mcpResult.mimeType, data: mcpResult.base64 },
          },
          {
            type: 'text',
            text: '✅ Figma screenshot captured.\n\nAnalyze the visual layout, spacing, colors, typography, and component structure visible above.',
          },
        ],
        sideEffects,
      };
    }

    if (isFigmaCompositeResult(mcpResult)) {
      return {
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mcpResult.image.mimeType, data: mcpResult.image.base64 },
          },
          {
            type: 'text',
            text: mcpResult.text,
          },
        ],
        sideEffects,
      };
    }

    // Text-only result
    const textResult = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult);
    return { content: textResult, sideEffects };
  } catch (err: any) {
    const { isFigmaRateLimitError, classifyFigmaError } = await import('../../../../periphery/adapters/figma/errors');

    if (isFigmaRateLimitError(err)) throw err;

    await ctx.chatStatus.showStatus('figma_called', { ...statusMeta, error: true, _mergeIndex: mergeIdx });

    const category = classifyFigmaError(err);
    const sideEffects: ToolSideEffect[] = [{ type: 'figmaError', category }];

    return {
      content: JSON.stringify({ error: err.message }),
      error: err.message,
      sideEffects,
    };
  }
}
