/**
 * Universal agent node — one LLM round.
 *
 * Mirrors the ask agent node's stream loop (thinking / text / tool_use /
 * retry / done), plus the two universal-specific concerns:
 *   1. Context-window management is INLINE here (D2): the session:main
 *      history runs through compactRun (compactTurns + TurnPruner) with a
 *      model-window-keyed budget before every round.
 *   2. The system prompt = builtin harness (templates/jobs/universal) with
 *      the active custom-job definition appended as an inert, boundary-tagged
 *      block (prose + injections TOC + outputs vocabulary).
 */

import { v4 as uuidv4 } from 'uuid';
import type { UniversalGraphState } from '../state';
import { getJobAbortSignal } from '../../../../composition/jobAbort';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../common/graph/conversations';
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../../../common/graph/llmConfig';
import { buildAssistantMessage } from '../../../common/tool/messageBuilder';
import {
  accumulateTokenUsage,
  maybeUpdatePhaseTokenUsage,
  applyEstimatedInputTokensFromMessages,
  resolveModelIdSafe,
} from '../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { TEMPLATE_PATHS } from '../../../../core/prompt/builder/templatePaths';
import { wrapCustomJobContent } from '../../../../core/prompt/builder/InputSanitizer';
import { getToolsByNames } from '../../../common/tool/toolSchemas';
import { ToolName } from '../../../common/tool/toolCatalog';
import { maybeJoinSubagents, ownerKeyFor } from '../../../common/subagent';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import type { ResolvedCustomJob } from '../../../../core/customAgents/types';
import { requiresApproval } from '../../../../core/customAgents/universalToolPolicy';
import { getUniversalMcp, DEFINITION_MOUNT_PREFIX } from '../runtime';
import { compactRun } from '../../../../core/context';
import { TokenBudgetManager } from '../../../../core/utils/tokenBudget';
import { getModelContextWindowOrDefault } from '@ant/shared';

const DEBUG = process.env.UNIVERSAL_DEBUG === 'true';

/** Reserved headroom for system prompt + tools + current output. */
const HISTORY_RESERVED_TOKENS = 105_000;
const HISTORY_BUDGET_FLOOR = 75_000;
/** Conservative Phase-1 compaction trigger (85% of the history budget). */
const COMPACT_TRIGGER_RATIO = 0.85;

/**
 * Render the custom definition as one inert boundary-tagged block:
 * merged base prose → injections TOC (progressive disclosure via read_file on
 * the read-only definition mount) → outputs contract vocabulary.
 */
export function buildCustomJobSystemBlock(resolved: ResolvedCustomJob): string {
  const parts: string[] = [resolved.prose];

  if (resolved.injectionsToc.length > 0) {
    const toc = resolved.injectionsToc
      .map((e) => `- \`${DEFINITION_MOUNT_PREFIX}injections/${e.file}\` — ${e.summary}`)
      .join('\n');
    parts.push(
      `## Conditional Instructions (load on demand)\n` +
      `The following instruction files exist. When the base instructions above say a situation applies, load the file with \`read_file\` before acting:\n${toc}`,
    );
  }

  if (resolved.outputs.mode === 'contract' && resolved.outputs.artifacts?.length) {
    const rows = resolved.outputs.artifacts.map((a) => {
      const naming = a.naming === 'llm' ? 'you name the file (topic/date-appropriate)' : `fixed pattern: ${a.naming}`;
      const update = a.update === 'in-place'
        ? 'when asked to revise an existing artifact, UPDATE that file — do not mint a new one'
        : 'each production may create a new file';
      return `- **${a.kind}**: written under \`${a.dir}\` as \`.${a.format}\`; ${naming}; ${update}`;
    });
    parts.push(
      `## Output Contract\n` +
      `Not every turn produces an artifact — conversation-only turns are normal. WHEN you produce one of the following, it MUST follow its convention:\n${rows.join('\n')}`,
    );
  } else if (resolved.outputs.mode === 'none') {
    parts.push(`## Output Contract\nThis job is chat-only: do not write files.`);
  }

  return wrapCustomJobContent(parts.join('\n\n'), `${resolved.agentId}/${resolved.jobId}`);
}

async function buildSystemPrompt(state: UniversalGraphState, resolved: ResolvedCustomJob): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Universal:Agent] PromptBuilder not available');

  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.universalAgent,
    vars: {
      isKorean: state.language === 'ko',
      agentName: resolved.agentName,
      jobName: resolved.jobName,
      jobDescription: resolved.description,
      artifactsOverview: state.artifactsOverview || '(not scanned)',
      workspaceAccess: resolved.workspace,
      hasMcpServers: Object.keys(resolved.mcpServers).length > 0,
      definitionMount: DEFINITION_MOUNT_PREFIX,
    },
    // Custom definition rides as an inert system-suffix — after injections,
    // before policy (guardrail-first / policy-last invariants intact).
    inertSystemAppend: buildCustomJobSystemBlock(resolved),
  });

  return [result.system, result.user].filter(Boolean).join('\n\n---\n\n');
}

/** Builtin allowlist + connected MCP tools, shaped for llm.stream. */
export function buildAdvertisedTools(resolved: ResolvedCustomJob): Array<{ name: string; description: string; input_schema: any }> {
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

  return [...builtin, ...mcp];
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
  const toolDefinitions = buildAdvertisedTools(resolved);
  const messages = composeUniversalMessages(state);
  const baseHistory = getConv(state.conversations, CONV_KEYS.SESSION_MAIN) as ConversationMessage[];

  const chatAPI = getChatAPIClient();
  let streamingStarted = state.chatMessageStarted || false;
  let responseText = '';
  let thinkingText = '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];

  const isFirstCall = baseHistory.filter((m) => m.role === 'assistant').length === 0;

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
        thinkingText = '';
        toolCalls.length = 0;
        continue;
      }

      maybeUpdatePhaseTokenUsage(state as any, event);

      if (event.type === 'thinking' && event.thinking) {
        if (!streamingStarted) {
          await chatAPI.startMessage();
          streamingStarted = true;
        }
        await chatAPI.sendLLMEvent({ type: 'thinking', thinking: event.thinking });
        thinkingText += event.thinking;
      }

      if (event.type === 'text' && event.text) {
        if (!streamingStarted) {
          await chatAPI.startMessage();
          streamingStarted = true;
        }
        await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
        responseText += event.text;
      }

      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        toolCalls.push({ id: id || uuidv4(), name, args: input });
        if (DEBUG) console.log(`   → Tool call: ${name}`);
      }

      if (event.type === 'done' && event.usage) {
        accumulateTokenUsage(state as any, event.usage, { taskLevel: true, jobLevel: true });
      }
    }

    if (DEBUG && thinkingText) console.log(`   💭 Thinking: ${thinkingText.substring(0, 100)}...`);
  } catch (error) {
    console.warn('[Universal:Agent] Streaming failed, falling back to invoke:', error);
    if (llm.invokeWithUsage) {
      const result = await llm.invokeWithUsage(messages, {
        system: systemPrompt,
        enableThinking: false,
        temperature: LLM_TEMPERATURE.CONVERSATIONAL,
      });
      responseText = result.content;
      if (result.usage) accumulateTokenUsage(state as any, result.usage, { taskLevel: true, jobLevel: true });
    } else {
      responseText = await llm.invoke(messages, {
        system: systemPrompt,
        enableThinking: false,
        temperature: LLM_TEMPERATURE.CONVERSATIONAL,
      });
    }
  }

  // ── Join barrier (explore subagent) — same contract as ask.
  const subagentOwnerKey = ownerKeyFor(state._httpJobId);
  if (toolCalls.length === 0) {
    const joined = await maybeJoinSubagents(state as any, subagentOwnerKey);
    if (joined) {
      const redoHistory: ConversationMessage[] = [...baseHistory];
      if (responseText) redoHistory.push(buildAssistantMessage({ text: responseText }));
      redoHistory.push({ role: 'user', content: joined.blocks as any });
      return {
        conversations: { [CONV_KEYS.SESSION_MAIN]: redoHistory },
        pendingToolCalls: [],
        response: undefined,
        streamingCompleted: false,
        chatMessageStarted: streamingStarted,
        _subagentJoinRedo: true,
        tokenUsage: state.tokenUsage,
        ...(joined.tokenDelta as any),
      };
    }
  }

  const streamingCompleted = streamingStarted && toolCalls.length === 0;
  if (streamingCompleted) {
    await chatAPI.finalizeMessage();
  }

  const newHistory: ConversationMessage[] = [...baseHistory];
  if (toolCalls.length > 0) {
    newHistory.push(buildAssistantMessage({ toolCalls }));
  } else if (responseText) {
    newHistory.push(buildAssistantMessage({ text: responseText }));
  }

  return {
    conversations: { [CONV_KEYS.SESSION_MAIN]: newHistory },
    pendingToolCalls: toolCalls.length > 0 ? toolCalls : [],
    response: toolCalls.length > 0 ? undefined : responseText,
    streamingCompleted,
    chatMessageStarted: streamingStarted,
    tokenUsage: state.tokenUsage,
    _subagentJoinRedo: false,
  };
}

export function routeAfterAgent(state: UniversalGraphState): 'tool' | 'respond' | 'agent' {
  if (state._subagentJoinRedo) return 'agent';
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) return 'tool';
  return 'respond';
}
