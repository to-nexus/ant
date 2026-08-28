/**
 * Universal agent node — one LLM round, canonical streaming surface.
 *
 * Stream loop mirrors the canonical execute nodes (planner/code/design):
 * StreamOrchestrator (XMLStreamParser + CommonRenderStrategy) renders
 * thinking blocks / text / tag scrubbing, ToolFileStreamer live-renders
 * file-writing tool calls, and `tool_use` events are forwarded to chat as
 * tool_action cards. Universal-specific concerns kept from D2:
 *   1. Context-window management is INLINE here: the session:main history
 *      runs through compactRun (compactTurns + TurnPruner) with a
 *      model-window-keyed budget before every round.
 *   2. The system prompt = builtin harness (templates/jobs/universal) with
 *      the active custom-job definition appended as an inert, boundary-tagged
 *      block (prose + intent catalog + active prompts) — built by core's promptBlock SSOT,
 *      shared with the settings prompt-preview endpoint.
 */

import { v4 as uuidv4 } from 'uuid';
import type { UniversalGraphState } from '../state';
import { getJobAbortSignal } from '../../../../composition/jobAbort';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../common/graph/conversations';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../common/graph/llmConfig';
import { buildAssistantMessage, buildRoundAssistantMessage } from '../../../common/tool/messageBuilder';
import {
  accumulateTokenUsage,
  maybeUpdatePhaseTokenUsage,
  applyEstimatedInputTokensFromMessages,
  extractTokenUsageFromStreamEvent,
  upsertPhaseTokenUsage,
  broadcastTokenUsageByModel,
  resolveModelIdSafe,
} from '../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { extractLLMInfo } from '../../../../core/ports/workflow';
import { transformAndStrip } from '../../../../core/streaming/OutputTagRegistry';
import { ToolFileStreamer } from '../../../../core/streaming/ToolFileStreamer';
import { TEMPLATE_PATHS } from '../../../../core/prompt/builder/templatePaths';
import { buildCustomJobSystemBlock, DEFINITION_MOUNT_PREFIX } from '../../../../core/customAgents/promptBlock';
import { getToolsByNames } from '../../../common/tool/toolSchemas';
import { ToolName } from '../../../common/tool/toolCatalog';
import { maybeJoinSubagents, ownerKeyFor } from '../../../common/subagent';
import { getActiveCustomAgentScopeRoots, requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../../../core/customAgents/types';
import { requiresApproval, isClarifyEnabled, UNIVERSAL_CLARIFY_BUDGET } from '../../../../core/customAgents/universalToolPolicy';
import { CLARIFY_TOOL_DEFINITION } from '../../../common/clarify/tool';
import { parseChecklistTag, serializeChecklist } from '../../../../core/customAgents/universalChecklist';
import {
  UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET,
  activeStopHooksOf,
  buildStopHookGateMessage,
  checkStopHooks,
  formatStopHookContractLines,
  verifyChecksOnDisk,
} from '../../../../core/customAgents/stopHooks';
import { getUniversalMcp, getOrCreateUniversalTurnStreaming } from '../runtime';
import { compactRun } from '../../../../core/context';
import { TokenBudgetManager } from '../../../../core/utils/tokenBudget';
import { getModelContextWindowOrDefault } from '@ant/shared';
import { buildAttachedContextSection } from './attachedContext';

const DEBUG = process.env.UNIVERSAL_DEBUG === 'true';

/** Reserved headroom for system prompt + tools + current output. */
const HISTORY_RESERVED_TOKENS = 105_000;
const HISTORY_BUDGET_FLOOR = 75_000;
/** Conservative Phase-1 compaction trigger (85% of the history budget). */
const COMPACT_TRIGGER_RATIO = 0.85;

async function buildSystemPrompt(state: UniversalGraphState, resolved: ResolvedCustomJob): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Universal:Agent] PromptBuilder not available');

  const existingChecklist = state.turnChecklist ?? state.restoredChecklist;
  // Active stop-hook contract band — plan turns are exempt (their contract is
  // the plan_complete gate; writes are confined to plan/ anyway).
  const turnStopHooks =
    state.turnContext?.planTurn === true
      ? []
      : formatStopHookContractLines(activeStopHooksOf(resolved.intents, state.turnContext?.intents ?? []));
  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.universalAgent,
    vars: {
      isKorean: state.language === 'ko',
      agentName: resolved.agentName,
      jobName: resolved.jobName,
      artifactsOverview: state.artifactsOverview || '(not scanned)',
      hasMcpServers: Object.keys(resolved.mcpServers).length > 0,
      hasApiServers: Object.keys(resolved.apiServers).length > 0,
      definitionMount: DEFINITION_MOUNT_PREFIX,
      // @plan turn axis: per-turn plan-mode request — writes outside plan/
      // are gated in the tool node while this is set.
      planTurn: state.turnContext?.planTurn === true,
      planDocsDir: `plan/${resolved.agentId}/${resolved.jobId}`,
      // Plan-consumption gate (deterministic half): existing plan docs from
      // resolve's disk listing. Consuming one is the agent's judgment.
      planDocs: state.planDocs?.length ? state.planDocs : undefined,
      // Working checklist carried on the session — continuation turns
      // update this list (full-replace) instead of recreating it.
      existingChecklist: existingChecklist ? serializeChecklist(existingChecklist) : undefined,
      existingChecklistPlan: existingChecklist?.sourcePlanPath,
      // Turn Completion Contract band — the runtime verifies these from
      // actual tool results at the turn's stop point.
      turnStopHooks: turnStopHooks.length > 0 ? turnStopHooks : undefined,
    },
    // Custom definition rides as an inert system-suffix — after template injections,
    // before policy (guardrail-first / policy-last invariants intact).
    inertSystemAppend: buildCustomJobSystemBlock(resolved, state.turnContext?.intents ?? []).text,
  });

  const sections = [result.system, result.user];

  // `@ctx:` mentions — no eager content load (universal has no RAC/pool);
  // directories get a list_files-first instruction, large files an inline
  // outline so read_file's range-refusal has a real target.
  const attachedSection = state.featurePath
    ? buildAttachedContextSection(
        state.featurePath,
        state.turnContext?.context ?? [],
        getActiveCustomAgentScopeRoots(),
      )
    : null;
  if (attachedSection) sections.push(attachedSection);

  return sections.filter(Boolean).join('\n\n---\n\n');
}

/**
 * Builtin allowlist + connected MCP tools, shaped for llm.stream.
 * `includeClarify` appends the clarify CONTROL tool (outside the preset
 * planes) — availability is enforced by ABSENCE from this list (definition
 * knob × session budget), never by stripping emitted calls.
 */
export function buildAdvertisedTools(
  resolved: ResolvedCustomJob,
  opts?: { includeClarify?: boolean },
): Array<{ name: string; description: string; input_schema: any }> {
  const builtinNames = resolved.builtinTools.filter((n): n is ToolName =>
    (Object.values(ToolName) as string[]).includes(n),
  );
  const builtin = getToolsByNames(builtinNames).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const mcp = (getUniversalMcp()?.listToolInfos() ?? []).map((info) => {
    const gated = requiresApproval(info.name, resolved.approval, { mcpReadOnlyHint: info.readOnlyHint });
    return {
      name: info.definition.name,
      description: gated
        ? `${info.definition.description}\n\n⚠️ This tool requires user approval before execution.`
        : info.definition.description,
      input_schema: info.definition.input_schema,
    };
  });

  const clarify = opts?.includeClarify ? [CLARIFY_TOOL_DEFINITION] : [];

  return [...builtin, ...mcp, ...clarify];
}

/** Compact the session history against a model-window-keyed budget. */
export function composeUniversalMessages(state: UniversalGraphState): ConversationMessage[] {
  const history = getConv(state.conversations, CONV_KEYS.SESSION_MAIN) as ConversationMessage[];
  const modelId = resolveModelIdSafe(state as any) ?? 'unknown';
  const windowTokens = getModelContextWindowOrDefault(modelId);
  const historyBudget = Math.max(
    HISTORY_BUDGET_FLOOR,
    Math.min(Math.floor(windowTokens * 0.7), windowTokens - HISTORY_RESERVED_TOKENS),
  );
  const tokenManager = new TokenBudgetManager({
    maxTokens: windowTokens,
    modelId,
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: historyBudget,
    },
  });

  // conversations' ConversationMessage admits 'system'; the session:main
  // channel only ever holds user/assistant turns (system rides separately),
  // so the narrowing cast into core/context's stricter type is sound.
  const { result, wasCompacted } = compactRun(history as any, tokenManager, {
    autoCompactThreshold: Math.floor(historyBudget * COMPACT_TRIGGER_RATIO),
    autoCompactHotTail: 8,
  });
  if (wasCompacted) {
    console.log(`🗜️ [Universal:Agent] History compacted (budget ${historyBudget} tokens)`);
  }

  const messages = [...result];
  // Anthropic requires the conversation to end with a user message.
  if (messages.length === 0 || messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: 'Continue.' });
  }
  return messages;
}

export async function agentNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const llm = state.deps?.llm;
  if (!llm) throw new Error('LLM is required for universal agent node');

  const resolved = requireActiveCustomJob();
  const systemPrompt = await buildSystemPrompt(state, resolved);
  const includeClarify =
    isClarifyEnabled(resolved, state.turnContext?.intents ?? ['general']) &&
    (state.clarifyRoundsUsed ?? 0) < UNIVERSAL_CLARIFY_BUDGET;
  const toolDefinitions = buildAdvertisedTools(resolved, { includeClarify });
  const messages = composeUniversalMessages(state);
  const baseHistory = getConv(state.conversations, CONV_KEYS.SESSION_MAIN) as ConversationMessage[];
  const recursionCount = (state.recursionCount ?? 0) + 1;

  const chatAPI = getChatAPIClient();
  const isFirstEntry = !state.chatMessageStarted && (state.toolCalls?.length ?? 0) === 0;
  // The estimating banner set by the shared resolve node has no clearing
  // owner in universal's graph — the agent round is where real work starts.
  if (isFirstEntry) {
    state.deps?.kanbanUpdate?.clearEstimatingActivity?.();
  }

  const workflowUpdate = state.deps?.workflowUpdate;
  if (workflowUpdate && state._httpJobId) {
    await workflowUpdate.enterNode(
      state._httpJobId, 'agent', 0,
      undefined, extractLLMInfo(llm),
      recursionCount, state.recursionLimit,
    );
  }

  await chatAPI.showChatStatus('placeholder');

  // TURN-scoped streaming pipeline (A14): one parser/renderer for the whole
  // agent→tool→agent loop, so a `<reply>` opened in one round and closed in a
  // later one is recognized instead of leaking raw delimiters. beginRound()
  // clears only the per-round raw accumulator (tag context survives).
  const orchestrator = getOrCreateUniversalTurnStreaming(chatAPI, state.language === 'ko' ? 'ko' : 'en');
  orchestrator.beginRound();
  // Live rendering of file-writing TOOL CALLS (create_file / append_file /
  // edit_file): artifact content streams into its card / editor tab as the
  // arguments generate. Disk writes stay with the tool node (authoritative).
  let toolStreamer = new ToolFileStreamer(chatAPI);

  let responseText = '';
  let streamedAnything = state.chatMessageStarted || false;
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];

  const isFirstCall = baseHistory.filter((m) => m.role === 'assistant').length === 0;

  try {
    try {
      applyEstimatedInputTokensFromMessages(state as any, [
        ...messages,
        { role: 'system', content: systemPrompt },
      ]);

      for await (const event of llm.stream(messages, {
        system: systemPrompt,
        tools: toolDefinitions,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        temperature: LLM_TEMPERATURE.CONVERSATIONAL,
        enableThinking: isFirstCall,
        signal: getJobAbortSignal(),
      })) {
        if (event.type === 'retry') {
          responseText = '';
          toolCalls.length = 0;
          orchestrator.reset();
          toolStreamer = new ToolFileStreamer(chatAPI);
          continue;
        }

        maybeUpdatePhaseTokenUsage(state as any, event);
        await orchestrator.processEvent(event);
        toolStreamer.handleEvent(event);

        if ((event.type === 'text' && event.text) || (event.type === 'thinking' && event.thinking)) {
          streamedAnything = true;
          if (event.type === 'text' && event.text) responseText += event.text;
        }

        if (event.type === 'tool_use' && event.toolUse) {
          const { id, name, input } = event.toolUse;
          // tool_action card — same forward canonical execute nodes do.
          await chatAPI.sendLLMEvent(event);
          toolCalls.push({ id: id || uuidv4(), name, args: input });
          if (DEBUG) console.log(`   → Tool call: ${name}`);
        }

        if (event.type === 'done') {
          const capturedUsage = extractTokenUsageFromStreamEvent(event);
          if (capturedUsage) {
            accumulateTokenUsage(state as any, capturedUsage, {
              taskLevel: true, jobLevel: true, modelId: (llm as any).modelName,
            });
            upsertPhaseTokenUsage(state as any, 'agent', capturedUsage);
          }
          // Per-model breakdown must ride BEFORE the aggregate broadcast —
          // updateTaskQueue snapshots what the broadcaster has seen so far.
          if (state.deps?.kanbanUpdate && state._httpJobId) {
            broadcastTokenUsageByModel(state as any);
            state.deps.kanbanUpdate.updateTaskQueue?.(
              state._httpJobId, null, [], [], recursionCount, state.recursionLimit, state.tokenUsage,
            );
            if (state.phaseTokenUsages) {
              state.deps.kanbanUpdate.updatePhaseTokenUsages?.(state.phaseTokenUsages);
            }
          }
        }
      }
    } catch (error) {
      console.warn('[Universal:Agent] Streaming failed, falling back to invoke:', error);
      if (llm.invokeWithUsage) {
        const result = await llm.invokeWithUsage(messages, {
          system: systemPrompt,
          enableThinking: false,
          temperature: LLM_TEMPERATURE.CONVERSATIONAL,
        });
        responseText = result.content;
        if (result.usage) {
          accumulateTokenUsage(state as any, result.usage, {
            taskLevel: true, jobLevel: true, modelId: (llm as any).modelName,
          });
        }
      } else {
        responseText = await llm.invoke(messages, {
          system: systemPrompt,
          enableThinking: false,
          temperature: LLM_TEMPERATURE.CONVERSATIONAL,
        });
      }
      if (responseText) {
        streamedAnything = true;
        // Invoke fallback bypasses the streaming parser — the text is complete
        // here, so strip/format canonical tags (<reply>, <done>, …) before emit.
        await chatAPI.sendLLMEvent({
          type: 'text',
          text: transformAndStrip(responseText, state.language === 'ko' ? 'ko' : 'en'),
        });
      }
    }

    // Flush queued live-card emissions before any finalize path below.
    await toolStreamer.settle();

    // ── Checklist extraction (post-stream): the agent's `<checklist>` tag is
    // chat-suppressed (registry: consumed) — this is where it lands. Full
    // replace; last occurrence in the round wins. Broadcast keeps the
    // Checklist board live per round.
    const emittedChecklist = parseChecklistTag(responseText, {
      hasExisting: Boolean(state.turnChecklist ?? state.restoredChecklist),
    });
    if (emittedChecklist) {
      state.deps?.kanbanUpdate?.updateUniversalChecklist?.(emittedChecklist);
      console.log(`📋 [Universal:Agent] Checklist updated (${emittedChecklist.items.length} items${emittedChecklist.sourcePlanPath ? `, plan: ${emittedChecklist.sourcePlanPath}` : ''})`);
    }
    const checklistPatch = emittedChecklist
      ? { turnChecklist: emittedChecklist, _checklistEmitRound: state.recursionCount ?? 0 }
      : {};

    // ── Join barrier (explore subagent) — same contract as ask.
    const subagentOwnerKey = ownerKeyFor(state._httpJobId);
    if (toolCalls.length === 0) {
      const joined = await maybeJoinSubagents(state as any, subagentOwnerKey);
      if (joined) {
        // Round continues (redo) — do NOT finalize: flushing the parser here
        // would emit a held-back partial tag as raw text, and the turn-scoped
        // pipeline must keep its tag context for the next round (A14).
        const redoHistory: ConversationMessage[] = [...baseHistory];
        if (responseText) redoHistory.push(buildAssistantMessage({ text: responseText }));
        redoHistory.push({ role: 'user', content: joined.blocks as any });
        return {
          conversations: { [CONV_KEYS.SESSION_MAIN]: redoHistory },
          pendingToolCalls: [],
          response: undefined,
          streamingCompleted: false,
          chatMessageStarted: streamedAnything,
          _subagentJoinRedo: true,
          _hookRedo: false,
          tokenUsage: state.tokenUsage,
          ...checklistPatch,
          ...(joined.tokenDelta as any),
        };
      }
    }

    // ── Stop-hook gate — the turn's ONLY stop point is this node emitting
    // zero tool calls, so the deterministic completion contract is judged
    // here, BEFORE finalize (A14: bouncing after finalize would flush the
    // turn-scoped parser and tear the round into a new message — the same
    // reason the join barrier lives inside this node). Evidence is observed
    // tool results only; plan turns are exempt (plan_complete owns them).
    let hooksUnmetPatch: Partial<UniversalGraphState> = {};
    if (toolCalls.length === 0 && state.turnContext?.planTurn !== true) {
      const activeHooks = activeStopHooksOf(resolved.intents, state.turnContext?.intents ?? []);
      if (activeHooks.length > 0) {
        const rawChecks = checkStopHooks(activeHooks, {
          writes: state._turnToolWrites ?? [],
          actions: state._turnToolActions ?? [],
          ledger: state.restoredHookLedger,
        });
        const fileSystem = state.deps?.fileSystem;
        const checks = fileSystem
          ? await verifyChecksOnDisk(rawChecks, (p) => fileSystem.fileExists(p))
          : rawChecks;
        const unmet = checks.filter((c) => !c.met);
        const bounces = state.hookBounceRounds ?? 0;
        if (unmet.length > 0 && bounces < UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET) {
          // Bounce (join-redo shape): re-enter the agent with the ✓/✗ gate
          // message — no finalize, the turn-scoped pipeline continues (A14).
          console.log(`🎯 [Universal:Agent] Stop hooks unmet (${unmet.length}/${checks.length}) — bounce ${bounces + 1}/${UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET}`);
          const redoHistory: ConversationMessage[] = [...baseHistory];
          if (responseText) redoHistory.push(buildAssistantMessage({ text: responseText }));
          redoHistory.push({
            role: 'user',
            content: buildStopHookGateMessage(checks, bounces + 1, UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET),
          });
          return {
            conversations: { [CONV_KEYS.SESSION_MAIN]: redoHistory },
            pendingToolCalls: [],
            response: undefined,
            streamingCompleted: false,
            chatMessageStarted: streamedAnything,
            _hookRedo: true,
            _subagentJoinRedo: false,
            hookBounceRounds: bounces + 1,
            tokenUsage: state.tokenUsage,
            ...checklistPatch,
          };
        }
        if (unmet.length > 0) {
          // Budget spent — proceed to respond, which recomputes and seals
          // the resumable pause (honest report over a phantom success).
          console.warn(`⚠️ [Universal:Agent] Stop hooks still unmet after ${bounces} bounce(s) — pausing`);
          hooksUnmetPatch = { _hooksUnmet: unmet };
        }
      }
    }

    const hasToolCalls = toolCalls.length > 0;
    if (!hasToolCalls) {
      // done rides before finalize — orchestrator.finalize(false) closes the
      // message (renderStrategy → finalizeMessage), matching canonical order.
      await chatAPI.sendLLMEvent({ type: 'done' });
      // Terminal round of the turn — flush the parser and close the message.
      // Tool rounds skip finalize entirely: the turn-scoped pipeline carries
      // its parser buffer/tag context into the next round (A14), and flushing
      // mid-turn would emit a held-back partial tag as raw text.
      await orchestrator.finalize(false);
    }

    const streamingCompleted = streamedAnything && !hasToolCalls;

    const newHistory: ConversationMessage[] = [...baseHistory];
    const roundMessage = buildRoundAssistantMessage(responseText, toolCalls);
    if (roundMessage) newHistory.push(roundMessage);

    return {
      conversations: { [CONV_KEYS.SESSION_MAIN]: newHistory },
      pendingToolCalls: hasToolCalls ? toolCalls : [],
      response: hasToolCalls ? undefined : responseText,
      streamingCompleted,
      chatMessageStarted: streamedAnything,
      tokenUsage: state.tokenUsage,
      _subagentJoinRedo: false,
      _hookRedo: false,
      ...hooksUnmetPatch,
      ...checklistPatch,
    };
  } finally {
    if (workflowUpdate && state._httpJobId) {
      await workflowUpdate.exitNode(state._httpJobId, 'agent', 0);
    }
  }
}

export function routeAfterAgent(state: UniversalGraphState): 'tool' | 'respond' | 'agent' {
  if (state._subagentJoinRedo) return 'agent';
  if (state._hookRedo) return 'agent';
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) return 'tool';
  return 'respond';
}
