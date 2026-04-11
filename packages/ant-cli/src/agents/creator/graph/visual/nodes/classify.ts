/**
 * Classify Node (Visual Graph)
 *
 * Lightweight asset type classification using Flash model.
 * Runs BEFORE the direct node so that art direction receives
 * a normalized assetType for conditional guide injection.
 *
 * Pattern: same as code job's detectEnvironment node.
 */

import { VisualGraphState } from '../types.js';
import { accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { parseClassifyResponse } from './classifyParser.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { formatVisualClassifyForChat } from '../../../../../core/types/detection.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';
import { synthesizeVisualIntent, resolveFromInfer } from '@ant/shared';
import type { DetectionReport, ResolvedActionContext } from '@ant/shared';

/**
 * Build RAC from classify result when resolve didn't create one (infer path).
 * Returns undefined when RAC already exists (explicit path).
 */
function buildVisualRAC(
  state: VisualGraphState,
  jobMode: string,
): ResolvedActionContext | undefined {
  if (state.resolvedAction) return undefined;

  const intent = synthesizeVisualIntent(jobMode);

  const minimalReport: DetectionReport = {
    detectedMode: jobMode as DetectionReport['detectedMode'],
    detectedModeReasoning: 'Visual classify LLM',
    sourceJob: 'code',
  };

  const rac = resolveFromInfer(minimalReport, state.actionMetadata, undefined, undefined, intent);
  console.log(`📋 [Visual:Classify] RAC created (infer): intent=${rac.intent}, mode=${rac.mode}`);
  return rac;
}

export async function classifyNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  if (state.skipClassify) {
    console.log(`⏭️ [Visual:Classify] Skipped (skipClassify=true, assetType=${state.assetType || 'general'}, jobMode=${state.jobMode || 'generate'})`);
    return { _phaseTimings: { ...state._phaseTimings, classify: Date.now() - phaseStart } };
  }

  console.log('\n🏷️ [Visual:Classify] Asset type classification...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('classify', state._uiLocale as any), 'classify');
  }

  const llm = state.deps.llm;

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'classify', 0, undefined, llm ? extractLLMInfo(llm) : undefined);
  }
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

    const messages = [
      { role: 'user', content: classifyPrompt },
    ];

    let rawContent: string;
    if (llm.invokeWithUsage) {
      const response = await llm.invokeWithUsage(messages);
      if (response.usage) {
        accumulateTokenUsage(state, response.usage, { taskLevel: true, jobLevel: true });
        upsertPhaseTokenUsage(state, 'classify', response.usage);
      }
      rawContent = response.content;
    } else {
      rawContent = await llm.invoke(messages);
    }

    const classified = parseClassifyResponse(rawContent);
    console.log(`🏷️ [Visual:Classify] Result: type=${classified.assetType}, mode=${classified.jobMode} (${classified.reasoning})`);

    const previousAssetType = state.assetType;
    const previousJobMode = state.jobMode;
    const isUnchanged = previousAssetType && previousAssetType === classified.assetType
      && previousJobMode && previousJobMode === classified.jobMode;

    if (!isUnchanged) {
      const chatAPI = getChatAPIClient();
      const formattedReport = formatVisualClassifyForChat(
        classified.assetType,
        classified.jobMode,
        classified.reasoning,
        (state._uiLocale as any) || 'ko'
      );
      await chatAPI.sendLLMEvent({ type: 'text', text: formattedReport });
      await chatAPI.finalizeMessage();
    }

    if (state._httpJobId && state.featurePath) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'classify', classifyPrompt.length, {
          templatePath: 'visual/nodes/direct/classify',
          injectedVariables: { currentDirective, conversationEntries: state.conversation.length },
          hardcodedContent: rawContent,
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
      state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'classify', 0);
    }

    // RAC: skip if already created in resolve (explicit path)
    const resolvedAction = buildVisualRAC(state, classified.jobMode);

    return {
      assetType: classified.assetType,
      jobMode: classified.jobMode,
      _phaseTimings: { ...state._phaseTimings, classify: Date.now() - phaseStart },
      ...(resolvedAction ? { resolvedAction } : {}),
    };
  } catch (err: any) {
    console.warn(`⚠️ [Visual:Classify] Classification failed, using defaults: ${err.message}`);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'classify', 0);
    }

    const fallbackRAC = buildVisualRAC(state, 'generate');

    return {
      assetType: 'general',
      jobMode: 'generate',
      _phaseTimings: { ...state._phaseTimings, classify: Date.now() - phaseStart },
      ...(fallbackRAC ? { resolvedAction: fallbackRAC } : {}),
    };
  }
}
