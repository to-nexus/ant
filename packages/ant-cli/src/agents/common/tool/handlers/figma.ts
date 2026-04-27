/**
 * Figma MCP handlers — context-injected version
 *
 * Side effects (figmaSuccess/figmaError) allow the calling node's hooks
 * to maintain error counters without coupling the handler to graph state.
 *
 * `nodeName` enrichment is gated on `ctx.figmaExplorationResult?.nodeSummary`
 * presence — design jobs populate it via `buildContext`, code jobs leave it
 * undefined and fall back to nodeId-only chat status meta. This keeps the
 * handler common-shaped while preserving the design UX of showing node
 * names ("phase1") in chat status without leaking design state shape into
 * the tool transport layer.
 */

import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';

export async function handleFigmaTool(
  ctx: ToolExecutionContext,
  args: Record<string, any>,
  toolName: string,
): Promise<ToolResult> {
  const { callFigmaMCPTool, isFigmaImageResult, isFigmaCompositeResult, saveFigmaScreenshot } =
    await import('../../../../periphery/adapters/figma/figmaMCPHandler');

  if (!ctx.figmaFileKey) {
    return { content: 'Figma fileKey not configured', error: 'Figma fileKey not configured' };
  }

  const nodeId = args.nodeId as string | undefined;
  const nodeName = nodeId
    ? ctx.figmaExplorationResult?.nodeSummary?.find((n: any) => n.nodeId === nodeId)?.name
    : undefined;
  const statusMeta = { toolName, nodeId, nodeName };
  const mergeIdx = await ctx.chatStatus.showStatus('figma_calling', statusMeta);

  try {
    const mcpResult = await callFigmaMCPTool(
      { userId: ctx.userId, redis: ctx.redis, taskId: ctx.taskId },
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
