/**
 * Direct Node (Visual Graph)
 *
 * Art Direction — the creative brain of the visual workflow.
 * Reads state.assetType (set by upstream classify node) to inject
 * the matching asset type guide via Handlebars conditionals.
 *
 * Uses a single model: deps.directLLM.
 */

import { VisualGraphState, DraftVariation } from '../types.js';
import { accumulateTokenUsage, TokenUsage } from '../../../../common/graph/llmHelpers.js';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels.js';
import { logPrompt } from '../../../../../core/utils/promptLogger.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';
import type { LLMClient, LLMStreamEvent, ToolDefinition, MessageContentBlock, ToolUseContentBlock } from '../../../../../core/ports/llm.js';
import { VISUAL_DRAFT_TOOLS, executeDraftTool } from './draftTools.js';

const MAX_CLARIFY = 5;
const MAX_TOOL_ROUNDS = 5;

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
    const idx = state.selectedDraftIndex ?? 0;
    const variation = state.draftVariations?.[idx];
    const prompt = (state.basePrompt && variation)
      ? `${state.basePrompt} ${variation.prompt}`
      : state.lastEngineeredPrompt;

    console.log(`🎬 [Visual:Direct] Deterministic: finalize draft ${idx} → render (prompt=${prompt?.substring(0, 60)}...)`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'direct', 0);
    }
    return {
      routeDecision: 'render',
      engineeredPrompt: prompt,
      selectedDraftIndex: idx,
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
      basePrompt: state.basePrompt,
      draftVariations: state.draftVariations,
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

  const { compactJob, VISUAL_COMPACTION_THRESHOLD, VISUAL_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS } = await import('../../../../../core/context');
  const allButLast = state.conversation.length > 1
    ? state.conversation.slice(0, -1)
    : [];
  let recentConv: typeof state.conversation;
  let convSummary: string | undefined;
  let compactionMeta: import('../../../../../core/context').ConversationCompaction | undefined;
  try {
    const result = allButLast.length > 0
      ? await compactJob(allButLast, directLLM, promptPort, {
          threshold: VISUAL_COMPACTION_THRESHOLD,
          recentWindowSize: VISUAL_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        })
      : { entries: allButLast, summary: undefined, wasCompacted: false };
    recentConv = result.entries;
    convSummary = result.summary;
    compactionMeta = result.wasCompacted
      ? { summary: result.summary!, summarizedCount: allButLast.length - VISUAL_COMPACTION_WINDOW }
      : undefined;
  } catch (err) {
    console.warn(`⚠️ [Visual:Direct] compactJob failed, using raw entries:`, err);
    recentConv = allButLast;
    convSummary = undefined;
    compactionMeta = undefined;
  }
  const summaryBlock = convSummary ? `[Earlier conversation summary]\n${convSummary}\n\n` : '';
  const conversationContext = summaryBlock + recentConv
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

  const draftVariationList = state.isDraftFeedback && state.draftVariations?.length
    ? state.draftVariations.map((v, i) => ({
        number: i + 1,
        label: v.label || `Draft ${i + 1}`,
        prompt: v.prompt,
      }))
    : undefined;

  const hasDrafts = draftCount > 0;

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
    availableDraftCount: hasDrafts ? draftCount : undefined,
    draftVariationList,
  });

  const messages: Array<{ role: string; content: string | MessageContentBlock[] }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const chatAPI = getChatAPIClient();
  await chatAPI.startMessage();

  const tools = hasDrafts ? VISUAL_DRAFT_TOOLS : undefined;

  let result: any;

  try {
    const { text: rawContent, usage } = await streamWithToolLoop(
      directLLM, messages, tools, state, MAX_TOOL_ROUNDS,
    );
    if (usage) {
      accumulateTokenUsage(state as any, usage, { taskLevel: true, jobLevel: true });
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
    routeDecision: result.route,
    resolvedAspectRatio: result.aspectRatio || undefined,
    selectedDraftIndex: result.selectedDraftIndex ?? state.selectedDraftIndex,
    draftIntent: resolvedDraftIntent || state.draftIntent,
    visualError: undefined,
    safetyBlocked: false,
    _conversationCompaction: compactionMeta,
    _phaseTimings: { ...state._phaseTimings, direct: Date.now() - phaseStart },
  };

  if (result.route === 'sketch' || result.route === 'engrave') {
    // Variation-based routes: basePrompt + variations[]
    const variations: DraftVariation[] = Array.isArray(result.variations) ? result.variations : [];
    updates.basePrompt = result.basePrompt || result.engineeredPrompt || '';
    updates.draftVariations = variations;
    updates.variationAxis = result.variationAxis || undefined;
    // Compose a representative engineeredPrompt for logging/session (base + first variation)
    updates.engineeredPrompt = variations.length > 0
      ? `${updates.basePrompt} ${variations[0].prompt}`
      : updates.basePrompt;

    if (result.route === 'sketch') {
      updates.needsSketches = true;
    } else {
      updates.isSvgRequest = true;
    }
    console.log(`🎬 [Visual:Direct] Variation axis: ${updates.variationAxis || 'N/A'}, ${variations.length} variations`);
  } else if (result.route === 'render') {
    updates.engineeredPrompt = result.engineeredPrompt;
    updates.basePrompt = undefined;
    updates.draftVariations = undefined;
    updates.variationAxis = undefined;
  } else {
    updates.engineeredPrompt = result.engineeredPrompt;
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
 * Stream LLM with tool loop — collects tool_use events, executes draft tools,
 * appends results, and re-streams until the LLM produces final text or rounds
 * are exhausted.
 */
async function streamWithToolLoop(
  llm: LLMClient,
  messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
  tools: ToolDefinition[] | undefined,
  state: VisualGraphState,
  maxRounds: number,
): Promise<{ text: string; usage?: TokenUsage }> {
  let currentMessages = [...messages];
  let accUsage: TokenUsage | undefined;

  for (let round = 0; round < maxRounds; round++) {
    let text = '';
    const toolUses: Array<{ id: string; name: string; input: Record<string, any>; thoughtSignature?: string }> = [];

    for await (const event of llm.stream(currentMessages, { tools })) {
      if (event.type === 'text' && event.text) {
        text += event.text;
      }
      if (event.type === 'tool_use' && event.toolUse) {
        toolUses.push({
          id: event.toolUse.id,
          name: event.toolUse.name,
          input: event.toolUse.input,
          thoughtSignature: event.toolUse.thoughtSignature,
        });
      }
      if (event.type === 'done' && event.usage) {
        if (!accUsage) {
          accUsage = { ...event.usage };
        } else {
          accUsage.inputTokens += event.usage.inputTokens || 0;
          accUsage.outputTokens += event.usage.outputTokens || 0;
          accUsage.totalTokens += event.usage.totalTokens || 0;
        }
      }
    }

    if (toolUses.length === 0) {
      return { text, usage: accUsage };
    }

    console.log(`🔧 [Visual:Direct] Tool round ${round + 1}: ${toolUses.map(t => t.name).join(', ')}`);

    const assistantBlocks: MessageContentBlock[] = [];
    if (text) {
      assistantBlocks.push({ type: 'text', text });
    }
    for (const tu of toolUses) {
      assistantBlocks.push({
        type: 'tool_use', id: tu.id, name: tu.name, input: tu.input,
        ...(tu.thoughtSignature ? { thoughtSignature: tu.thoughtSignature } : {}),
      } as ToolUseContentBlock);
    }

    const toolResultBlocks: MessageContentBlock[] = toolUses.map(tu =>
      executeDraftTool(tu.id, tu.name, tu.input, state),
    );

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: assistantBlocks },
      { role: 'user', content: toolResultBlocks },
    ];
  }

  console.warn(`⚠️ [Visual:Direct] Tool loop exhausted after ${maxRounds} rounds`);
  return { text: '', usage: accUsage };
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
