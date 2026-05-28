/**
 * Visual Detect Strategy
 *
 * Lightweight asset type classification using Flash model.
 * Extracted from the former classify node.
 */

import type { DetectStrategy, DetectResult } from '../../../../common/graph/nodes/detect/types.js';
import type { VisualGraphState } from '../types.js';
import type { InferredAction } from '@ant/shared';
import { runEstimatingLLM, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { parseClassifyResponse } from './classifyParser.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import type { VisualAssetType } from '../types.js';
import type { Mode } from '@ant/shared';
import { ExecutionTierId } from '../../../../../core/executionTier/index.js';

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

/** Inverse of mapVisualIntentId — intent → assetType. */
function deriveAssetType(intentId: string): VisualAssetType {
  switch (intentId) {
    case 'gen-visual-logo': return 'logo';
    case 'gen-visual-icon': return 'icon';
    case 'gen-visual-hero': return 'hero';
    case 'gen-visual-illustration': return 'illustration';
    default: return 'general';
  }
}

export const visualDetectStrategy: DetectStrategy<VisualGraphState> = {
  /**
   * Explicit-branch hook — LLM classify is skipped, derive visual state from
   * intent. Symmetric to `onResume` (both signal "LLM skipped, set
   * job-specific state"). Tier defaults to Reflex since the user committed
   * intent → no LLM judgment needed.
   */
  onExplicit(_state, intentId): Partial<VisualGraphState> {
    const jobMode: Mode = intentId === 'explain-visual' ? 'explain' : 'generate';
    return {
      assetType: deriveAssetType(intentId),
      jobMode,
      executionTier: ExecutionTierId.Reflex,
    };
  },

  async run(state): Promise<DetectResult<VisualGraphState>> {
    if (state.skipClassify) {
      console.log(`⏭️ [Visual:Detect] Skipped (skipClassify=true, assetType=${state.assetType || 'general'})`);
      const mode = state.jobMode || 'generate';
      const inferred: InferredAction = {
        intentId: mapVisualIntentId(mode, state.assetType),
        reasoning: { intent: 'Classification skipped — using existing values.' },
        sourceJob: 'visual',
      };
      // Skip path has no LLM judgment — default to Tier 0 Reflex (safe
      // read-only). Callers that need a specific tier must not set
      // `skipClassify`.
      return {
        inferred,
        stateUpdates: {
          executionTier: ExecutionTierId.Reflex,
        } as Partial<VisualGraphState>,
      };
    }

    console.log('\n🏷️ [Visual:Detect] Asset type classification...');

    const llm = state.deps.llm;
    const pb = state.deps.promptBuilder;

    // featureContext is auto-enriched by PromptBuilder.enrichFeatureContextVars,
    // so the Handlebars template can iterate `featureContext.userTurns` directly.
    const featureContext = (state as any).featureContext;
    const currentDirective = state.overrideDirective || state.directive || '';

    try {
      const classifyPrompt = await pb.render('jobs/visual/nodes/direct/variants/default/classify', {
        currentDirective,
      });

      const messages = [{ role: 'user', content: classifyPrompt }];
      let rawContent: string;

      if (llm.invokeWithUsage) {
        const { content, usage } = await runEstimatingLLM(
          state as any,
          'detect',
          () => llm.invokeWithUsage!(messages),
          { subNode: 'visual', promptChars: classifyPrompt.length },
        );
        if (usage) {
          upsertPhaseTokenUsage(state, 'detect', usage);
        }
        rawContent = content;
      } else {
        rawContent = await llm.invoke(messages);
      }

      const classified = parseClassifyResponse(rawContent);
      console.log(`🏷️ [Visual:Detect] Result: type=${classified.assetType}, mode=${classified.jobMode}, tier=${classified.executionTier} (${classified.reasoning})`);

      if (state._httpJobId && state.featurePath) {
        try {
          await logPrompt(state.featurePath, state._httpJobId, 'visual', 'detect', classifyPrompt.length, {
            templatePath: 'jobs/visual/nodes/direct/variants/default/classify',
            injectedVariables: { currentDirective, conversationEntries: featureContext?.userTurns?.length ?? 0 },
            hardcodedContent: rawContent,
          });
        } catch { /* non-critical */ }
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
          executionTier: classified.executionTier,
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
          executionTier: ExecutionTierId.Reflex,
        } as Partial<VisualGraphState>,
      };
    }
  },
};
