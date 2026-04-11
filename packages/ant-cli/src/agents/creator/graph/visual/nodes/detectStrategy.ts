/**
 * Visual Detect Strategy
 *
 * Lightweight asset type classification using Flash model.
 * Extracted from the former classify node.
 */

import type { DetectStrategy, DetectResult } from '../../../../common/nodes/detect/types.js';
import type { VisualGraphState } from '../types.js';
import type { DetectionReport } from '@ant/shared';
import { synthesizeVisualIntent } from '@ant/shared';
import { accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { parseClassifyResponse } from './classifyParser.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { formatDetectionReportForChat } from '../../../../../core/types/detection.js';
import type { VisualAssetType, JobMode } from '../types.js';

export const visualDetectStrategy: DetectStrategy<VisualGraphState> = {
  async run(state): Promise<DetectResult<VisualGraphState>> {
    if (state.skipClassify) {
      console.log(`⏭️ [Visual:Detect] Skipped (skipClassify=true, assetType=${state.assetType || 'general'})`);
      const mode = (state.jobMode as DetectionReport['detectedMode']) || 'generate';
      const report: DetectionReport = {
        detectedMode: mode,
        detectedModeReasoning: 'Classification skipped — using existing values.',
        sourceJob: 'visual',
        intentId: synthesizeVisualIntent(mode, state.assetType),
      };
      return {
        detectionReport: report,
        stateUpdates: {} as Partial<VisualGraphState>,
      };
    }

    console.log('\n🏷️ [Visual:Detect] Asset type classification...');

    const llm = state.deps.llm;
    const promptPort = state.deps.promptPort;

    const conversationContext = state.conversation
      .slice(-10)
      .map(entry => `[${entry.role}] ${entry.content}`)
      .join('\n');

    const currentDirective = state.overrideDirective || state.directive || '';

    try {
      const classifyPrompt = await promptPort.render('visual/nodes/direct/classify', {
        conversationContext: conversationContext || '(no previous conversation)',
        currentDirective,
      });

      const messages = [{ role: 'user', content: classifyPrompt }];
      let rawContent: string;

      if (llm.invokeWithUsage) {
        const response = await llm.invokeWithUsage(messages);
        if (response.usage) {
          accumulateTokenUsage(state, response.usage, { taskLevel: true, jobLevel: true });
          upsertPhaseTokenUsage(state, 'detect', response.usage);
        }
        rawContent = response.content;
      } else {
        rawContent = await llm.invoke(messages);
      }

      const classified = parseClassifyResponse(rawContent);
      console.log(`🏷️ [Visual:Detect] Result: type=${classified.assetType}, mode=${classified.jobMode} (${classified.reasoning})`);

      // Display in Chat UI when classification changed
      const previousAssetType = state.assetType;
      const previousJobMode = state.jobMode;
      const isUnchanged = previousAssetType === classified.assetType && previousJobMode === classified.jobMode;

      if (!isUnchanged) {
        const chatAPI = getChatAPIClient();
        const chatReport: DetectionReport = {
          detectedMode: classified.jobMode as DetectionReport['detectedMode'],
          detectedModeReasoning: classified.reasoning,
          sourceJob: 'visual',
        };
        const formatted = formatDetectionReportForChat(chatReport, (state._uiLocale as any) || 'ko');
        await chatAPI.sendLLMEvent({ type: 'text', text: formatted });
        await chatAPI.finalizeMessage();
      }

      // Log prompt
      if (state._httpJobId && state.featurePath) {
        try {
          await logPrompt(state.featurePath, state._httpJobId, 'visual', 'detect', classifyPrompt.length, {
            templatePath: 'visual/nodes/direct/classify',
            injectedVariables: { currentDirective, conversationEntries: state.conversation.length },
            hardcodedContent: rawContent,
          });
        } catch { /* non-critical */ }
      }

      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
      }

      const detectionReport: DetectionReport = {
        detectedMode: classified.jobMode as DetectionReport['detectedMode'],
        detectedModeReasoning: classified.reasoning,
        sourceJob: 'visual',
        intentId: classified.intentId || synthesizeVisualIntent(classified.jobMode, classified.assetType),
      };

      return {
        detectionReport,
        stateUpdates: {
          assetType: classified.assetType,
          jobMode: classified.jobMode,
        } as Partial<VisualGraphState>,
      };
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Detect] Classification failed, using defaults: ${err.message}`);
      const fallbackReport: DetectionReport = {
        detectedMode: 'generate',
        detectedModeReasoning: 'Classification failed — using defaults.',
        sourceJob: 'visual',
        intentId: synthesizeVisualIntent('generate'),
      };
      return {
        detectionReport: fallbackReport,
        stateUpdates: {
          assetType: 'general' as VisualAssetType,
          jobMode: 'generate' as JobMode,
        } as Partial<VisualGraphState>,
      };
    }
  },

  synthesizeFallback(report, state) {
    return synthesizeVisualIntent(report.detectedMode, (state as VisualGraphState).assetType);
  },
};
