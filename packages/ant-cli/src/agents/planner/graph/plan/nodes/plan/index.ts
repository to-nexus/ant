/**
 * Plan Node (Planner Job)
 *
 * The research + clarify + seal phase. Mirrors the design/code job's `plan`
 * node role: OBSERVE (codebase / web / live-site), scope gaps, optionally
 * clarify, then seal a directive-anchored brief (inside a `<plan>` tag) and
 * CLEAR the NODE_PLAN transcript. `execute` then authors the document from
 * `directive + planText` on a fresh NODE_EXECUTE channel — the research
 * momentum and any auditor-persona tail never reach authoring.
 *
 * NOTE: this node uses its own streaming loop (not the shared
 * `runPlanWithTools`) because the planner must inspect the raw response text
 * for THREE outcomes the shared helper collapses into an opaque `null`:
 * a `<clarify>` card, an explain-mode `<reply>`, and the `<plan>` brief seal — and
 * it needs control over the StreamOrchestrator finalize (clarify lead-in
 * flush). The transcript-severing boundary (seal clears NODE_PLAN) is what
 * matters, and it is preserved regardless of the loop driver.
 */

import { PlanGraphState, getPlanMode } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../../common/graph/conversations';
import {
  extractTokenUsageFromStreamEvent,
  accumulateTokenUsage,
  upsertPhaseTokenUsage,
  maybeUpdatePhaseTokenUsage,
  applyEstimatedInputTokensFromMessages,
  broadcastTokenUsageByModel,
} from '../../../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';
import { v4 as uuidv4 } from 'uuid';
import { PLANNER_EXPLAIN_TOOLS } from '../tools';
import { getEstimatingLabel } from '../../../../../common/graph/timing/estimatingLabels';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { compactJob } from '../../../../../../core/context';
import { PLAN_COMPACTION_THRESHOLD, PLAN_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS, PLAN_CONVERSATION_HISTORY_BUDGET } from '../../../../../../core/context';
import { buildCacheableBlocks } from '../../../../../../core/prompt/builder/CacheBlockMapper';
import { composeMessages } from '../../../../../../core/utils/messageComposer';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { buildPlanSystemPrompt } from './buildSystemPrompt';
import { applyClarifyGate, consumeAwaitingClarify } from '../../../../../common/clarify';
import type { IntentId } from '@ant/shared';
import { saveConversationToSession } from '../sessionWriter';
import { extractPlanText } from '../../../../../common/graph/nodes/plan/extractPlanText';

const MIN_BRIEF_LENGTH = 40;

export async function planNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const recursionCount = (state.recursionCount || 0) + 1;

  // Clarify continuation: if the previous run paused on a `<clarify>` card,
  // append the user's answer (overrideDirective) to NODE_PLAN before building
  // messages. No-op when awaitingClarify is falsy.
  if (state.awaitingClarify && state.overrideDirective) {
    console.log(`📋 [Planner:Plan] Clarify continuation — appending user response to conversation`);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_PLAN);
  }

  const planMode = getPlanMode(state);
  console.log(`\n🔎 [Planner:Plan] Observing + scoping... (iteration ${recursionCount}/${state.recursionLimit})`);

  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('plan', state._uiLocale || 'en'), 'plan');
  }

  // Per-node model: plan reasons over the codebase → Opus (llmModels.plan.plan),
  // falling back to the job default when unset.
  const llm = state.deps?.planLlm ?? state.deps?.llm;
  if (!llm) throw new Error('LLM is required for plan node');

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'plan', 0,
      undefined, extractLLMInfo(llm),
      recursionCount, state.recursionLimit,
    );
  }

  // Compact prior semantic history (SESSION_MAIN) for multi-turn context.
  const sessionMain = getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const allButLast = state.isConversationContinuation && sessionMain.length
    ? sessionMain.slice(0, -1)
    : [];

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Plan] PromptBuilder not available');

  let compactionResult: { entries: ConversationMessage[]; summary?: string; wasCompacted: boolean; tokenUsage?: import('@ant/shared').TaskTokenUsage };
  try {
    compactionResult = (allButLast.length > 0
      ? await compactJob(allButLast as any, llm, promptBuilder, {
          threshold: PLAN_COMPACTION_THRESHOLD,
          recentWindowSize: PLAN_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        })
      : { entries: [] as ConversationMessage[], wasCompacted: false }) as any;
  } catch (err) {
    console.warn(`⚠️ [Planner:Plan] compactJob failed, using raw entries:`, err);
    compactionResult = { entries: allButLast, wasCompacted: false };
  }
  if (compactionResult.tokenUsage) {
    accumulateTokenUsage(state, compactionResult.tokenUsage, { taskLevel: false, jobLevel: true, modelId: (llm as any).modelName });
  }
  const compactionMeta = compactionResult.wasCompacted
    ? { summary: compactionResult.summary!, summarizedCount: allButLast.length - PLAN_COMPACTION_WINDOW }
    : undefined;

  const built = await buildPlanSystemPrompt(state, compactionResult);
  const systemPrompt = built.prompt;

  if (state._httpJobId && state.featurePath) {
    try {
      await logPrompt(
        state.featurePath, state._httpJobId, 'plan', 'plan',
        systemPrompt.length,
        {
          templatePath: TEMPLATE_PATHS.plannerPlan.base,
          usedTemplates: [
            TEMPLATE_PATHS.plannerPlan.base,
            TEMPLATE_PATHS.plannerPlan.rules!,
            ...built.injectedTemplates,
          ],
          injectedVariables: {
            directive: state.directive || '',
            mode: planMode,
            targets: state.resolvedAction?.target || [],
            domain: state.resolvedAction?.domain ?? '(unset)',
            basisInjected: built.basisInjected,
            hasBasis: !!state.resolvedAction?.basis,
            hasConversation: compactionResult.entries.length > 0,
            isConversationContinuation: !!state.isConversationContinuation,
            isResume: !!state.isResume,
            recursionCount,
          },
        },
      );
    } catch (err) {
      console.warn(`⚠️ [Planner:Plan] Failed to log prompt:`, err);
    }
  }

  // Build messages via the shared cache-aware composer (single owner — the
  // same path code/design execute use). The stable system + injections
  // sections become `cache_control`-marked leading blocks (Block 1/2) so the
  // ~12K prompt prefix is cached across the plan node's tool-loop iterations
  // instead of being re-sent cold as a plain `system` string. The growing
  // NODE_PLAN tool history rides as prior turns (composeMessages runs the same
  // `compactRun` pruning that `pruneConversationHistory` did). The fresh-entry
  // ask (directive, or the last session turn on a conversation continuation)
  // is appended as an uncached Block 3 part.
  const freshAsk = state.isConversationContinuation && sessionMain.length
    ? String(sessionMain[sessionMain.length - 1].content ?? '')
    : (state.directive || '');
  const initialBlocks = buildCacheableBlocks(built.result, {
    runtimeParts: nodePlan.length === 0 ? [freshAsk] : undefined,
  });
  const planTokenManager = new TokenBudgetManager({
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: PLAN_CONVERSATION_HISTORY_BUDGET,
    },
  });
  const { messages } = composeMessages({
    initialBlocks,
    priorTurns: nodePlan as any,
    tokenManager: planTokenManager,
  });

  // Plan phase is read-only research for ALL modes — the edit_file write path
  // belongs to execute (refactor). Explain is read-only too.
  const activeTools = PLANNER_EXPLAIN_TOOLS;
  const toolDefinitions = activeTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  const chatAPI = getChatAPIClient();
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI, state.language === 'ko' ? 'ko' : 'en', undefined, undefined, false, 'plan',
  );
  const orchestrator = new StreamOrchestrator({ parser, renderStrategy, existingFiles: new Set() });

  let responseText = '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  const isFirstCall = nodePlan.length === 0;

  await chatAPI.showChatStatus('placeholder');

  try {
    applyEstimatedInputTokensFromMessages(state as any, messages);
    for await (const event of llm.stream(messages, {
      tools: toolDefinitions,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: isFirstCall,
    })) {
      if (event.type === 'retry') {
        responseText = '';
        toolCalls.length = 0;
        continue;
      }
      maybeUpdatePhaseTokenUsage(state, event);
      await orchestrator.processEvent(event);
      if (event.type === 'text' && event.text) responseText += event.text;
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        await chatAPI.sendLLMEvent(event);
        toolCalls.push({ id: id || uuidv4(), name, args: input });
      }
      if (event.type === 'done') {
        const capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true, modelId: (llm as any).modelName });
          upsertPhaseTokenUsage(state, 'plan', capturedUsage);
        }
        if (state.deps?.kanbanUpdate?.updateTaskQueue && state._httpJobId) {
          broadcastTokenUsageByModel(state as any);
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId, null, [], [], recursionCount, state.recursionLimit, state.tokenUsage,
          );
        }
        if (state.phaseTokenUsages && state.deps?.kanbanUpdate?.updatePhaseTokenUsages) {
          state.deps.kanbanUpdate.updatePhaseTokenUsages(state.phaseTokenUsages);
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ [Planner:Plan] LLM error: ${error.message}`);
    throw error;
  }

  const updatedHistory = [...nodePlan];
  if (nodePlan.length === 0) {
    const recordedMessage = state.isConversationContinuation && sessionMain.length
      ? sessionMain[sessionMain.length - 1].content
      : state.directive;
    updatedHistory.push({ role: 'user', content: recordedMessage || '' });
  }

  // ── Tool-call round: short-circuit to the tool node (stay in plan loop) ──
  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', 0);
    }
    updatedHistory.push(buildAssistantMessage({ text: responseText || undefined, toolCalls }));
    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversations = { ...state.conversations, [CONV_KEYS.NODE_PLAN]: updatedHistory };
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    return {
      conversations: { [CONV_KEYS.NODE_PLAN]: updatedHistory },
      pendingToolCalls: toolCalls,
      tokenUsage: state.tokenUsage,
      recursionCount,
      _activePhase: 'plan',
    };
  }

  // No tool calls — the model produced a terminal text turn. Keep the message
  // open so a clarify card can flush its lead-in before the card.
  await orchestrator.finalize(true);

  // ── Clarify gate ──
  const clarifyIntent = state.resolvedAction?.intent as IntentId | undefined;
  const clarifyGate = clarifyIntent
    ? await applyClarifyGate({
        responseText,
        intent: clarifyIntent,
        // Clarify policy is keyed by ClarifyPhase; the planner's clarify policy
        // was defined for 'generate' (the node clarify moved from), so reuse it
        // to preserve the exact eligibility behavior.
        phase: 'generate',
        clarifyRoundsUsed: state.clarifyRoundsUsed,
        requireOptions: true,
        onBeforeSend: () => chatAPI.finalizeMessage(),
      })
    : { paused: false as const, cleanedText: responseText, blocks: [], stateUpdates: {} };

  if (clarifyGate.paused) {
    console.log(`💬 [Planner:Plan] clarify — pausing (${clarifyGate.blocks.length} block(s))`);
    const cleaned = clarifyGate.cleanedText;
    const clarifyHistory: ConversationMessage[] = [...updatedHistory, { role: 'assistant', content: cleaned }];
    await saveConversationToSession(state, {
      nodeKey: CONV_KEYS.NODE_PLAN,
      responseText: cleaned,
      nodeHistory: clarifyHistory,
      compaction: compactionMeta,
      awaitingClarify: true,
      ...clarifyGate.stateUpdates,
    });
    if (state.deps?.kanbanUpdate?.clearEstimatingActivity) state.deps.kanbanUpdate.clearEstimatingActivity();
    if (state.deps?.workflowUpdate && state._httpJobId) state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', 0);
    return {
      conversations: { [CONV_KEYS.NODE_PLAN]: clarifyHistory },
      pendingToolCalls: [],
      tokenUsage: state.tokenUsage,
      recursionCount,
      awaitingClarify: true,
      ...clarifyGate.stateUpdates,
    };
  }

  // ── Explain mode: the `<reply>` answer already streamed. Persist + END. ──
  if (planMode === 'explain') {
    await chatAPI.finalizeMessage();
    const explainHistory: ConversationMessage[] = [...updatedHistory, { role: 'assistant', content: responseText }];
    await saveConversationToSession(state, {
      nodeKey: CONV_KEYS.NODE_PLAN,
      responseText,
      nodeHistory: explainHistory,
      compaction: compactionMeta,
    });
    if (state.deps?.workflowUpdate && state._httpJobId) state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', 0);
    return {
      conversations: { [CONV_KEYS.NODE_PLAN]: explainHistory },
      pendingToolCalls: [],
      tokenUsage: state.tokenUsage,
      recursionCount,
    };
  }

  // ── Seal: the model emitted the brief inside a `<plan>` tag (reusing the
  //     registered artifact seal tag — suppressed from chat, extracted here).
  //     Clear NODE_PLAN, hand planText to execute on a fresh channel (the
  //     transcript-severing boundary). ──
  await chatAPI.finalizeMessage();
  let planText = extractPlanText(responseText, MIN_BRIEF_LENGTH);
  if (!planText) {
    // Bounded fallthrough: the research loop concluded WITHOUT a formatted
    // `<plan>` brief. Never drop the deliverable — carry the model's synthesis
    // text forward as a best-effort brief so execute can still author. The
    // transcript is still severed; execute re-anchors on directive + this text.
    console.warn(
      `🔁 [Planner:Plan] plan loop concluded with no <plan> brief — sealing best-effort from response text (${responseText.length} chars).`,
    );
    planText = responseText.trim() || '(no observations gathered — author from the directive alone)';
  } else {
    console.log(`✅ [Planner:Plan] Brief sealed (${planText.length} chars) — handing off to execute.`);
  }

  if (state.deps?.workflowUpdate && state._httpJobId) state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', 0);
  if (state.deps?.stateSnapshot) {
    state.deps.stateSnapshot.conversations = { ...state.conversations, [CONV_KEYS.NODE_PLAN]: [] };
    state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
  }

  return {
    planText,
    _activePhase: 'execute',
    conversations: { [CONV_KEYS.NODE_PLAN]: [] },
    pendingToolCalls: [],
    tokenUsage: state.tokenUsage,
    recursionCount,
    recursionLimit: state.recursionLimit,
  };
}

/** Router: decide next node after plan. */
export function routeAfterPlan(state: PlanGraphState): 'tool' | 'execute' | '__end__' {
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) return 'tool';
  if (state.awaitingClarify) return '__end__';
  if (state._activePhase === 'execute') return 'execute';
  return '__end__';
}
