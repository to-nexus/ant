/**
 * Visual Detect Strategy
 *
 * Lightweight asset type classification using Flash model.
 * Extracted from the former classify node.
 */

import type { DetectStrategy, DetectResult } from '../../../../common/graph/nodes/detect/types.js';
import type { VisualGraphState } from '../types.js';
import type { InferredAction } from '@ant/shared';
import { accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { parseClassifyResponse } from './classifyParser.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import type { VisualAssetType } from '../types.js';
import type { Mode } from '@ant/shared';

function mapVisualIntentId(mode: string, assetType?: string): string {
  if (mode === 'explain') return 'explain-visual';
  switch (assetType) {
    case 'logo': return 'gen-visual-logo';
    case 'icon': return 'gen-visual-icon';
    case 'hero': return 'gen-visual-hero';
    case 'illustration': return 'gen-visual-illustration';
    default: return 'gen-visual-illustration';
  }
}

export const visualDetectStrategy: DetectStrategy<VisualGraphState> = {
  async run(state): Promise<DetectResult<VisualGraphState>> {
    if (state.skipClassify) {
      console.log(`⏭️ [Visual:Detect] Skipped (skipClassify=true, assetType=${state.assetType || 'general'})`);
      const mode = state.jobMode || 'generate';
      const inferred: InferredAction = {
        intentId: mapVisualIntentId(mode, state.assetType),
        reasoning: { intent: 'Classification skipped — using existing values.' },
        sourceJob: 'visual',
      };
      return {
        inferred,
        stateUpdates: {} as Partial<VisualGraphState>,
      };
    }

    console.log('\n🏷️ [Visual:Detect] Asset type classification...');

    const llm = state.deps.llm;
    const pb = state.deps.promptBuilder;

    const conversationContext = state.conversation
      .slice(-10)
      .map(entry => `[${entry.role}] ${entry.content}`)
      .join('\n');

    const currentDirective = state.overrideDirective || state.directive || '';

    try {
      const classifyPrompt = await pb.render('visual/nodes/direct/classify', {
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

      const inferred: InferredAction = {
        intentId: classified.intentId || mapVisualIntentId(classified.jobMode, classified.assetType),
        reasoning: { intent: classified.reasoning },
        sourceJob: 'visual',
      };

      return {
        inferred,
        stateUpdates: {
          assetType: classified.assetType,
          jobMode: classified.jobMode,
        } as Partial<VisualGraphState>,
      };
    } catch (err: any) {
      console.warn(`⚠️ [Visual:Detect] Classification failed, using defaults: ${err.message}`);
      const fallbackInferred: InferredAction = {
        intentId: mapVisualIntentId('generate'),
        reasoning: { intent: 'Classification failed — using defaults.' },
        sourceJob: 'visual',
      };
      return {
        inferred: fallbackInferred,
        stateUpdates: {
          assetType: 'general' as VisualAssetType,
          jobMode: 'generate' as Mode,
        } as Partial<VisualGraphState>,
      };
    }
  },
};
