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
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { parseClassifyResponse } from './classifyParser.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';

export async function classifyNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n🏷️ [Visual:Classify] Asset type classification...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('classify', state._uiLocale as any), 'classify');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'classify', 0);
  }

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

    const messages = [
      { role: 'user', content: classifyPrompt },
    ];

    let rawContent: string;
    if (llm.invokeWithUsage) {
      const response = await llm.invokeWithUsage(messages);
      accumulateTokenUsage(state as any, response.usage!, { taskLevel: true, jobLevel: true });
      rawContent = response.content;
    } else {
      rawContent = await llm.invoke(messages);
    }

    const classified = parseClassifyResponse(rawContent);
    console.log(`🏷️ [Visual:Classify] Result: type=${classified.assetType}, mode=${classified.jobMode} (${classified.reasoning})`);

    if (state._httpJobId) {
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

    return {
      assetType: classified.assetType,
      jobMode: classified.jobMode,
      _phaseTimings: { ...state._phaseTimings, classify: Date.now() - phaseStart },
    };
  } catch (err: any) {
    console.warn(`⚠️ [Visual:Classify] Classification failed, using defaults: ${err.message}`);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'classify', 0);
    }

    return {
      assetType: 'general',
      jobMode: 'generate',
      _phaseTimings: { ...state._phaseTimings, classify: Date.now() - phaseStart },
    };
  }
}
