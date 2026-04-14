import { DesignGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { FigmaRateLimitError, classifyFigmaError } from '../../../../../../../periphery/adapters/figma/errors';
import { callFigmaMCPTool, isFigmaImageResult, isFigmaCompositeResult, saveFigmaScreenshot } from '../../../../../../../periphery/adapters/figma/figmaMCPHandler';
import type { FigmaMCPResult } from '../../../../../../../periphery/adapters/figma/figmaMCPHandler';
import { parseFigmaUrl } from '../../../../../../../core/ports/figma';

/**
 * Handle figma_get_metadata / figma_get_design_context / figma_get_screenshot / figma_get_variable_defs
 */
export async function handleFigmaTool(
  name: string,
  state: DesignGraphState,
  args: Record<string, any>,
): Promise<any> {
  const figmaChatAPI = getChatAPIClient();
  const figmaNodeId = (args as any).nodeId as string | undefined;
  const figmaNodeName = figmaNodeId
    ? state.figmaExplorationResult?.nodeSummary?.find(n => n.nodeId === figmaNodeId)?.name
    : undefined;
  const figmaStatusMeta = { toolName: name, nodeId: figmaNodeId, nodeName: figmaNodeName };
  const figmaMergeIdx = await figmaChatAPI.showChatStatus('figma_calling', figmaStatusMeta);
  try {
    const figmaArgs = args as { fileKey: string; nodeId: string };

    let safeFileKey = figmaArgs.fileKey;
    if (state.figmaConfig?.file) {
      const parsed = parseFigmaUrl(state.figmaConfig.file);
      if (parsed?.fileKey && parsed.fileKey !== figmaArgs.fileKey) {
        console.warn(`⚠️  [Tool] LLM provided invalid fileKey "${figmaArgs.fileKey}", using "${parsed.fileKey}"`);
        safeFileKey = parsed.fileKey;
      }
    }

    const mcpResult: FigmaMCPResult = await callFigmaMCPTool(
      { userId: state.context?.userId, redis: state.deps?.redis, taskId: (state.currentTask as any)?.id },
      name, safeFileKey, figmaArgs.nodeId,
    );

    state._figmaConsecutiveErrors = 0;

    let imagePath: string | undefined;
    const imageData = isFigmaImageResult(mcpResult)
      ? mcpResult
      : isFigmaCompositeResult(mcpResult) ? mcpResult.image : null;
    if (imageData && state.context?.featurePath && figmaArgs.nodeId) {
      try {
        imagePath = await saveFigmaScreenshot(state.context.featurePath, figmaArgs.nodeId, imageData.base64, imageData.mimeType);
      } catch { /* non-critical: preview unavailable */ }
    }
    await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, imagePath, _mergeIndex: figmaMergeIdx });

    if (isFigmaImageResult(mcpResult)) {
      return { __figmaImage: true, base64: mcpResult.base64, mimeType: mcpResult.mimeType };
    } else if (isFigmaCompositeResult(mcpResult)) {
      const isRootNode = figmaNodeId === '0:1' || figmaNodeId === '0-1';
      const hasSummary = (state.figmaExplorationResult?.nodeSummary?.length ?? 0) > 0;
      if (isRootNode && hasSummary && name !== 'figma_get_screenshot') {
        return buildRootCallGuidance(state, name);
      } else {
        return {
          __figmaComposite: true,
          text: mcpResult.text,
          base64: mcpResult.image.base64,
          mimeType: mcpResult.image.mimeType,
        };
      }
    } else {
      let result = mcpResult;
      if ((figmaNodeId === '0:1' || figmaNodeId === '0-1') && result && name !== 'figma_get_screenshot') {
        const hasSummary = (state.figmaExplorationResult?.nodeSummary?.length ?? 0) > 0;
        if (hasSummary) {
          result = buildRootCallGuidance(state, name);
        }
      }
      return result;
    }
  } catch (err: any) {
    if (err instanceof FigmaRateLimitError) throw err;
    const errCategory = classifyFigmaError(err);
    if (errCategory === 'connection' || errCategory === 'environment') {
      state._figmaConsecutiveErrors = (state._figmaConsecutiveErrors || 0) + 1;
      const { isFigmaPipeline, isFigmaDataPopulated } = await import('@ant/shared');
      if ((isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig)) || state.figmaAvailable) && state._figmaConsecutiveErrors >= 3) {
        console.error(`❌ [Tool] Figma MCP unavailable (${errCategory}): ${state._figmaConsecutiveErrors} consecutive failures — flagging connection lost`);
        state._figmaConnectionLost = true;
      }
    } else {
      console.warn(`⚠️ [Tool] Figma MCP data error: ${err.message} — not counting toward connection failures`);
    }
    await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, error: true, _mergeIndex: figmaMergeIdx });
    return JSON.stringify({ error: err.message });
  }
}

export function buildRootCallGuidance(state: DesignGraphState, toolName: string): string {
  const nodeSummary = state.figmaExplorationResult?.nodeSummary;
  const topFrames = nodeSummary
    ? nodeSummary
        .filter(n => n.depth <= 1 && (n.type === 'FRAME' || n.type === 'SECTION'))
        .map(n => `  - ${n.name} (nodeId: ${n.nodeId}, type: ${n.type}, children: ${n.childCount})`)
        .join('\n')
    : '  (nodeSummary not available)';

  return JSON.stringify({
    warning: 'Root node query returns too much data. Use specific nodeIds instead.',
    guidance: `Query individual frames/sections for detailed data. Available top-level nodes:\n${topFrames}`,
    tool: toolName,
    availableNodeCount: nodeSummary?.length ?? 0,
  });
}
