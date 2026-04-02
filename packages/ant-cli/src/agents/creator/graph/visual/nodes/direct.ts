/**
 * Direct Node (Visual Graph)
 *
 * Art Direction — the creative brain of the visual workflow.
 * Reads state.assetType (set by upstream classify node) to inject
 * the matching asset type guide via Handlebars conditionals.
 *
 * Uses a single model: deps.directLLM.
 */

import { VisualGraphState } from '../types.js';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';

const MAX_CLARIFY = 5;

export async function directNode(state: VisualGraphState): Promise<Partial<VisualGraphState>> {
  const phaseStart = Date.now();

  console.log('\n🎬 [Visual:Direct] Art direction analysis...');

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('direct', state._uiLocale as any), 'direct');
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'direct', 0);
  }

  // Deterministic fast-path for finalize/regenerate (no LLM call needed)
  // Skip deterministic path if safety was blocked — need LLM to revise the prompt
  if (state.draftIntent === 'finalize' && !state.safetyBlocked) {
    console.log(`🎬 [Visual:Direct] Deterministic: finalize draft ${state.selectedDraftIndex} → render`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'direct', 0);
    }
    return {
      routeDecision: 'render',
      engineeredPrompt: state.lastEngineeredPrompt,
      selectedDraftIndex: state.selectedDraftIndex,
      needsSketches: false,
      draftIntent: undefined,
      _phaseTimings: { ...state._phaseTimings, direct: Date.now() - phaseStart },
    };
  }

  if (state.draftIntent === 'regenerate' && !state.safetyBlocked) {
    console.log('🎬 [Visual:Direct] Deterministic: regenerate → sketch (reuse prompt, new seed)');
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'direct', 0);
    }
    return {
      routeDecision: 'sketch',
      engineeredPrompt: state.lastEngineeredPrompt,
      needsSketches: true,
      draftIntent: undefined,
      _phaseTimings: { ...state._phaseTimings, direct: Date.now() - phaseStart },
    };
  }

  if (state.safetyBlocked && (state.draftIntent === 'finalize' || state.draftIntent === 'regenerate')) {
    console.log(`🎬 [Visual:Direct] Safety blocked on ${state.draftIntent} → falling through to LLM for prompt revision`);
  }

  const directLLM = state.deps.directLLM;
  const promptPort = state.deps.promptPort;

  const conversationContext = state.conversation
    .slice(-10)
    .map(entry => `[${entry.role}] ${entry.content}`)
    .join('\n');

  const currentDirective = state.overrideDirective || state.directive || '';

  const assetType = state.assetType || 'general';
  const isRefactor = state.jobMode === 'refactor' && !state.isDraftFeedback;

  console.log(`🎬 [Visual:Direct] jobMode=${state.jobMode || 'generate'}, assetType=${assetType}, isDraftFeedback=${!!state.isDraftFeedback}`);

  const systemPrompt = await promptPort.render('visual/nodes/direct/base', {
    isLogo: assetType === 'logo',
    isIcon: assetType === 'icon',
    isHero: assetType === 'hero',
    isIllustration: assetType === 'illustration',
  });

  const clarifyCount = state.clarifyCount || 0;
  const draftCount = state.availableDraftPaths?.length || 0;

  const userPrompt = await promptPort.render('visual/nodes/direct/context', {
    conversationContext: conversationContext || '(no previous conversation)',
    currentDirective,
    isRefactor,
    isDraftFeedback: state.isDraftFeedback,
    lastEngineeredPrompt: state.lastEngineeredPrompt,
    lastOutputPath: state.lastOutputPath,
    safetyBlocked: state.safetyBlocked,
    visualError: state.visualError,
    defaultAspectRatio: state.visualSettings?.defaultAspectRatio || '1:1',
    candidateCount: state.visualSettings?.candidateCount || 3,
    clarifyCount,
    maxClarify: MAX_CLARIFY,
    clarifyBudgetExhausted: clarifyCount >= MAX_CLARIFY,
    availableDraftCount: draftCount > 0 ? draftCount : undefined,
    lastDraftIndex: draftCount > 0 ? draftCount - 1 : undefined,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const chatAPI = getChatAPIClient();
  await chatAPI.startMessage();

  let result: any;

  try {
    let rawContent: string;
    if (directLLM.invokeWithUsage) {
      const response = await directLLM.invokeWithUsage(messages);
      accumulateTokenUsage(state as any, response.usage!, { taskLevel: true, jobLevel: true });
      rawContent = response.content;
    } else {
      rawContent = await directLLM.invoke(messages);
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new SyntaxError(`No JSON object found in response: ${rawContent.slice(0, 200)}`);
    }
    result = JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    if (err instanceof SyntaxError || err.name === 'SyntaxError') {
      console.warn(`⚠️ [Visual:Direct] JSON parse failed, falling back to clarify: ${err.message}`);
      const fallbackMsg = 'I had trouble processing that request. Could you describe the visual asset you want more specifically?';
      await chatAPI.sendLLMEvent({ type: 'text', text: fallbackMsg });
      await chatAPI.finalizeMessage();
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'direct', 0);
      }
      return {
        routeDecision: 'clarify',
        visualError: `Art direction response was malformed. Retrying.`,
        conversation: [
          ...state.conversation,
          {
            role: 'assistant' as const,
            content: fallbackMsg,
            timestamp: new Date().toISOString(),
          },
        ],
        _phaseTimings: { ...state._phaseTimings, direct: Date.now() - phaseStart },
      };
    }
    console.error('❌ [Visual:Direct] LLM call failed:', err.message);
    await chatAPI.finalizeMessage();
    throw err;
  }

  // Enforce clarify hard limit
  if (result.route === 'clarify' && clarifyCount >= MAX_CLARIFY) {
    console.log(`🎬 [Visual:Direct] Clarify budget exhausted (${clarifyCount}/${MAX_CLARIFY}) → forcing sketch`);
    result.route = 'sketch';
  }

  console.log(`🎬 [Visual:Direct] Route: ${result.route}`);
  console.log(`🎬 [Visual:Direct] Reasoning: ${result.reasoning}`);

  if (result.reasoning) {
    await chatAPI.sendLLMEvent({ type: 'text', text: result.reasoning });
  }

  if (state._httpJobId) {
    try {
      await logPrompt(state.featurePath, state._httpJobId, 'visual', 'direct', systemPrompt.length + userPrompt.length, {
        templatePath: 'visual/nodes/direct/base',
        usedTemplates: ['visual/nodes/direct/base', 'visual/nodes/direct/rules', 'visual/nodes/direct/context'],
        injectedVariables: { assetType, isRefactor, currentDirective, conversationEntries: state.conversation.length },
        hardcodedContent: JSON.stringify({ route: result.route, engineeredPrompt: result.engineeredPrompt, reasoning: result.reasoning }),
      });
    } catch { /* non-critical */ }
  }

  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage as any);
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'direct', 0);
  }

  // When isDraftFeedback, classify the LLM route into refine_explore or refine_finalize
  let resolvedDraftIntent: VisualGraphState['draftIntent'];
  if (state.isDraftFeedback) {
    resolvedDraftIntent = result.route === 'render' ? 'refine_finalize' : 'refine_explore';
    console.log(`🎬 [Visual:Direct] Draft feedback resolved: ${resolvedDraftIntent} (LLM route=${result.route})`);
  }

  const updates: Partial<VisualGraphState> = {
    engineeredPrompt: result.engineeredPrompt,
    routeDecision: result.route,
    resolvedAspectRatio: result.aspectRatio || undefined,
    selectedDraftIndex: result.selectedDraftIndex ?? state.selectedDraftIndex,
    draftIntent: resolvedDraftIntent || state.draftIntent,
    visualError: undefined,
    safetyBlocked: false,
    _phaseTimings: { ...state._phaseTimings, direct: Date.now() - phaseStart },
  };

  if (result.route === 'sketch') {
    updates.needsSketches = true;
  } else if (result.route === 'engrave') {
    updates.isSvgRequest = true;
  }

  if (result.route === 'clarify' && result.clarifyQuestion) {
    updates.clarifyCount = clarifyCount + 1;
    updates.conversation = [
      ...state.conversation,
      {
        role: 'assistant' as const,
        content: result.clarifyQuestion,
        timestamp: new Date().toISOString(),
      },
    ];
    await chatAPI.sendLLMEvent({ type: 'text', text: result.clarifyQuestion });
  }

  await chatAPI.finalizeMessage();
  return updates;
}

/**
 * Router after direct node
 */
export function routeAfterDirect(state: VisualGraphState): string {
  const route = state.routeDecision;

  if (!route) {
    console.log('[DirectRouter] No route decision → __end__');
    return '__end__';
  }

  switch (route) {
    case 'sketch':
      console.log('[DirectRouter] → sketch');
      return 'sketch';
    case 'render':
      console.log('[DirectRouter] → render');
      return 'render';
    case 'engrave':
      console.log('[DirectRouter] → engrave');
      return 'engrave';
    case 'clarify':
      console.log('[DirectRouter] → __end__ (clarify sent)');
      return '__end__';
    case 'end':
      console.log('[DirectRouter] → __end__');
      return '__end__';
    default:
      console.log(`[DirectRouter] Unknown route "${route}" → __end__`);
      return '__end__';
  }
}
