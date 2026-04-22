/**
 * Explain Node (Visual Graph)
 *
 * Text-only Q&A for visual design topics.
 * Handles questions, analysis, and consultation — no image generation.
 * Uses the explainLLM model (same tier as direct by default).
 */

import { VisualGraphState } from '../types.js';
import { CONV_KEYS, getConv } from '../../../../common/graph/conversations.js';
import { accumulateTokenUsage, beginNodePhase } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';

export async function explainNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  beginNodePhase(state as any, 'explain', 'Explain');
  const phaseStart = Date.now();

  console.log('\n💡 [Visual:Explain] Answering visual design question...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('explain', state._uiLocale as any), 'explain');
  }

  const llm = state.deps.explainLLM;

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'explain', 0, undefined, llm ? extractLLMInfo(llm) : undefined);
  }
  const pb = state.deps.promptBuilder;

  const sessionMain = getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
  const conversationContext = sessionMain
    .slice(-10)
    .map(entry => `[${entry.role}] ${entry.content}`)
    .join('\n');

  const currentDirective = state.overrideDirective || state.directive || '';

  const sketchVariationList = state.sketchVariations?.length
    ? state.sketchVariations.map((v, i) => ({
        number: i + 1,
        label: v.label || `Sketch ${i + 1}`,
        prompt: v.prompt,
      }))
    : undefined;

  const sketchCount = state.availableSketchPaths?.length || 0;

  try {
    const systemPrompt = await pb.render('jobs/visual/nodes/explain/variants/default/base', {});

    const userPrompt = await pb.render('jobs/visual/nodes/explain/variants/default/context', {
      conversationContext: conversationContext || '(no previous conversation)',
      currentDirective,
      lastEngineeredPrompt: state.lastEngineeredPrompt,
      lastOutputPath: state.lastOutputPath,
      sketchVariationList,
      availableSketchCount: sketchCount > 0 ? sketchCount : undefined,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const chatAPI = getChatAPIClient();
    await chatAPI.startMessage();

    let responseText = '';

    if (llm.stream) {
      for await (const event of llm.stream(messages)) {
        if (event.type === 'text' && event.text) {
          responseText += event.text;
          await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
        }
        if (event.type === 'done' && event.usage) {
          accumulateTokenUsage(state, event.usage, { taskLevel: true, jobLevel: true });
        }
      }
    } else if (llm.invokeWithUsage) {
      const response = await llm.invokeWithUsage(messages);
      responseText = response.content;
      if (response.usage) {
        accumulateTokenUsage(state, response.usage, { taskLevel: true, jobLevel: true });
      }
      await chatAPI.sendLLMEvent({ type: 'text', text: responseText });
    } else {
      responseText = await llm.invoke(messages);
      await chatAPI.sendLLMEvent({ type: 'text', text: responseText });
    }

    await chatAPI.finalizeMessage();

    console.log(`💡 [Visual:Explain] Response: ${responseText.length} chars`);

    if (state._httpJobId && state.featurePath) {
      try {
        await logPrompt(state.featurePath, state._httpJobId, 'visual', 'explain', systemPrompt.length + userPrompt.length, {
          templatePath: 'jobs/visual/nodes/explain/variants/default/base',
          usedTemplates: ['jobs/visual/nodes/explain/variants/default/base', 'jobs/visual/nodes/explain/variants/default/context'],
          injectedVariables: { currentDirective, conversationEntries: sessionMain.length, hasSketchContext: !!sketchVariationList },
          hardcodedContent: responseText.substring(0, 500),
        });
      } catch { /* non-critical */ }
    }

    if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
      state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'explain', 0);
    }

    return {
      conversations: { [CONV_KEYS.SESSION_MAIN]: [
        ...sessionMain,
        {
          role: 'assistant' as const,
          content: responseText,
          timestamp: new Date().toISOString(),
        },
      ] },
      _phaseTimings: { ...state._phaseTimings, explain: Date.now() - phaseStart },
    };
  } catch (err: any) {
    console.error('❌ [Visual:Explain] Failed:', err.message);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'explain', 0);
    }

    const chatAPI = getChatAPIClient();
    try {
      if (!chatAPI.hasActiveMessage()) await chatAPI.startMessage();
      await chatAPI.sendLLMEvent({ type: 'text', text: `I encountered an error while processing your question. Please try again.` });
      await chatAPI.finalizeMessage();
    } catch { /* cleanup */ }

    return {
      visualError: `Explain failed: ${err.message}`,
      _phaseTimings: { ...state._phaseTimings, explain: Date.now() - phaseStart },
    };
  }
}
