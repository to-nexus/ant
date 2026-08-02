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
import { getJobAbortSignal } from '../../../../../../composition/jobAbort';
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
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../../../common/graph/llmConfig';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { buildPlanSystemPrompt } from './buildSystemPrompt';
import { applyPlanDrainFinalization } from '../drainFinalize';
import { applyClarifyGate, consumeAwaitingClarify, type ClarifyConsumePatch } from '../../../../../common/clarify';
import { sanitizeDocSlug, collisionFreeDocFilename } from '../../../../../common/naming/docSlug';
import { isTemplateContent } from '../../../../../../core/utils/templateDetector';
import { getCanonicalPlanPath } from '@ant/shared';
import type { IntentId } from '@ant/shared';
import { saveConversationToSession } from '../sessionWriter';
import { extractPlanText } from '../../../../../common/graph/nodes/plan/extractPlanText';

const MIN_BRIEF_LENGTH = 40;

export async function planNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const recursionCount = (state.recursionCount || 0) + 1;

  // Clarify continuation: if the previous run paused on a `<clarify>` card,
  // append the user's answer (overrideDirective) to NODE_PLAN before building
  // messages. No-op when awaitingClarify is falsy.
  //
  // `clarifyPatch` is what actually clears the channel — the helper's in-place
  // mutation is node-local, so every non-pause return below MUST spread it.
  // Without it `routeAfterPlan` reads a stale `true` and discards the sealed
  // brief (execute never runs) while the session stays stuck in continuation.
  let clarifyPatch: ClarifyConsumePatch = {};
  if (state.awaitingClarify && state.overrideDirective) {
    console.log(`📋 [Planner:Plan] Clarify continuation — appending user response to conversation`);
    clarifyPatch = consumeAwaitingClarify(state, CONV_KEYS.NODE_PLAN);
  }

  const planMode = getPlanMode(state);

  // Revise (rev-plan) stale-target repair: the matrix no-ref fallback resolves
  // `rev-plan` to the suggested `plan/prd.md`, which may not exist now that the
  // plan job authors LLM-named docs. When the bound target is missing from the
  // real (non-template) plan files, re-pick the primary so refactor edits a
  // file that actually exists instead of no-oping on a phantom `prd.md`.
  const repairedTarget = repairRevisePlanTarget(state);
  if (repairedTarget) {
    state.resolvedAction = { ...state.resolvedAction!, target: repairedTarget };
    console.warn(`🔁 [Planner:Plan] rev-plan target repaired → ${repairedTarget.join(', ')}`);
  }

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

  // No-output salvage: after NO_OUTPUT_HARD_CAP − MARGIN tool rounds with no
  // <plan> seal, strip tools so the model must seal now (a tool-less round
  // seals a best-effort brief). cyan-catching-cedar follow-up.
  const { tools: streamToolDefinitions, toolChoice: drainToolChoice } = applyPlanDrainFinalization(state, messages, toolDefinitions, 'plan');

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
      tools: streamToolDefinitions,
      ...(drainToolChoice && streamToolDefinitions.length > 0 ? { toolChoice: drainToolChoice } : {}),
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      temperature: LLM_TEMPERATURE.PLAN_GENERATION,
      enableThinking: isFirstCall,
      signal: getJobAbortSignal(),
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
      tokenUsageByModel: state.tokenUsageByModel,
      recursionCount,
      _activePhase: 'plan',
      // No forward output this round (research only) — advance the no-output
      // window; at CAP − MARGIN the next call's tools are stripped.
      _noOutputCallCount: (state._noOutputCallCount || 0) + 1,
      ...clarifyPatch,
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
    // The clarify questions ship as a choice card, not as assistant text, so
    // `cleaned` is empty when the model emitted only the <clarify> block.
    // Never store an empty assistant turn: on resume it becomes an empty text
    // block that Anthropic rejects (400). Anchor the NODE_PLAN turn with the
    // questions the model asked (also gives it self-context on continuation).
    const clarifyAnchor =
      cleaned.trim() ||
      clarifyGate.blocks.map(b => b.question).filter(Boolean).join('\n') ||
      '(clarifying questions asked)';
    const clarifyHistory: ConversationMessage[] = [...updatedHistory, { role: 'assistant', content: clarifyAnchor }];
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
      tokenUsageByModel: state.tokenUsageByModel,
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
      tokenUsageByModel: state.tokenUsageByModel,
      recursionCount,
      ...clarifyPatch,
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

  // ── LLM-named target file(s): the sealed brief's `targetFiles` decides the
  //    document filename(s). Applied UNLESS the user explicitly bound a target
  //    (a lone `plan/prd.md` counts as the soft default and is overridable;
  //    any other/multi selection is user-bound and wins). Non-JSON best-effort
  //    briefs leave the target untouched. ──
  // Prefer the brief-derived target; otherwise persist the rev-plan repair
  // (state.resolvedAction was already patched above) so it survives the turn.
  const resolvedAction = (await resolvePlanTargetFromBrief(state, planText))
    ?? (repairedTarget ? state.resolvedAction : undefined);

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
    tokenUsageByModel: state.tokenUsageByModel,
    recursionCount,
    recursionLimit: state.recursionLimit,
    // Brief sealed = forward progress; hand execute a fresh no-output budget.
    _noOutputCallCount: 0,
    ...(resolvedAction ? { resolvedAction } : {}),
    ...clarifyPatch,
  };
}

/**
 * Repair a stale rev-plan target. Returns a corrected `plan/<file>` target
 * list when the current refactor target is absent from the real (non-template)
 * plan files, else `undefined` (keep the resolved target). Uses
 * `workspaceState.planFileNames` (already template-filtered) — no disk I/O.
 */
function repairRevisePlanTarget(state: PlanGraphState): string[] | undefined {
  if (getPlanMode(state) !== 'refactor') return undefined;
  const planFiles = state.workspaceState?.planFileNames ?? [];
  if (planFiles.length === 0) return undefined; // nothing to revise — let downstream surface it
  const target = state.resolvedAction?.target ?? [];
  const targetExists =
    target.length > 0 && target.every((t) => planFiles.includes(t.split('/').pop() ?? t));
  if (targetExists) return undefined;
  const primary = planFiles.includes('prd.md') ? 'prd.md' : planFiles[0];
  return [`plan/${primary}`];
}

/**
 * Resolve the plan document's target file(s) from the sealed `<plan>` brief's
 * `targetFiles`. Returns an updated `resolvedAction` (with a concrete
 * `plan/<name>.md` target list) when the brief names files AND the current
 * target is unbound or the soft default; otherwise returns `undefined` (keep
 * whatever resolve/detect set — including an explicit user selection).
 */
async function resolvePlanTargetFromBrief(
  state: PlanGraphState,
  planText: string,
): Promise<PlanGraphState['resolvedAction'] | undefined> {
  if (!state.resolvedAction) return undefined;
  // Refactor (rev-plan) edits an existing doc in place — never rename it from
  // the brief. The target was already bound to the revised file by resolve.
  if (getPlanMode(state) === 'refactor') return undefined;

  let briefFiles: string[] = [];
  try {
    const brief = JSON.parse(planText);
    if (Array.isArray(brief?.targetFiles)) {
      briefFiles = brief.targetFiles.filter((f: unknown): f is string => typeof f === 'string' && f.length > 0);
    }
  } catch {
    return undefined; // best-effort non-JSON brief — keep current target
  }
  if (briefFiles.length === 0) return undefined;

  const softDefault = getCanonicalPlanPath(); // 'plan/prd.md'
  const current = state.resolvedAction?.target ?? [];
  const userBound = current.length > 0 && !(current.length === 1 && current[0] === softDefault);
  if (userBound) return undefined;

  const fs = state.deps?.fileSystem;
  const planDirAbs = state.featurePath ? `${state.featurePath}/plan` : undefined;

  // Collision probe: an existing REAL (non-template) doc blocks the name;
  // an `ant:template` stub or a missing file is treated as absent (usable).
  const isTaken = async (filename: string): Promise<boolean> => {
    if (!fs || !planDirAbs) return false;
    const abs = `${planDirAbs}/${filename}`;
    if (!(await fs.fileExists(abs))) return false;
    const content = await fs.readFile(abs);
    return !isTemplateContent(content ?? '');
  };

  const names: string[] = [];
  for (const raw of briefFiles) {
    const base = (raw.split('/').pop() ?? raw).replace(/\.md$/i, '');
    const slug = sanitizeDocSlug(base, `plan-${names.length + 1}`);
    names.push(`plan/${await collisionFreeDocFilename(slug, isTaken)}`);
  }

  return { ...state.resolvedAction, target: names };
}

/** Router: decide next node after plan. */
export function routeAfterPlan(state: PlanGraphState): 'tool' | 'execute' | '__end__' {
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) return 'tool';
  if (state.awaitingClarify) return '__end__';
  if (state._activePhase === 'execute') return 'execute';
  return '__end__';
}
