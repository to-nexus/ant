/**
 * Generic LLM tool-use loop.
 *
 * Streams `llm.stream(messages, { tools })` round-by-round until the LLM
 * produces a final response without tool calls (or `maxRounds` is reached).
 * Each `tool_use` event is dispatched to the caller-supplied `toolHandler`
 * and the result is appended to the conversation for the next round.
 *
 * Used by decompose (code/design jobs) and detect (`inferRacWithTools`).
 * Lives in `common/llm/` so it is not tied to a single subgraph.
 */

import type { LLMClient, ToolDefinition, MessageContentBlock } from '../../../core/ports/llm';
import type { TaskTokenUsage } from '@ant/shared';
import type { TokenTrackingState } from '../graph/llmHelpers';

/**
 * Cumulative character budget for tool results within one tool-loop session.
 * 300K chars ≈ ~150K tokens at worst-case ratio — prevents prompt overflow
 * on subsequent rounds.
 */
const TOOL_RESULT_BUDGET = 300_000;

function mergeTokenUsage(
  a: TaskTokenUsage | undefined,
  b: TaskTokenUsage | undefined,
): TaskTokenUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
    cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
    cacheCreationTokens: (a.cacheCreationTokens || 0) + (b.cacheCreationTokens || 0),
  };
}

export interface ToolLoopOptions {
  temperature: number;
  maxTokens: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  maxRounds?: number;
  /**
   * Optional graph state. When supplied, `usage_partial` events from the
   * underlying LLM adapter overwrite `state.currentPhaseTokenUsage` so the
   * chat-input token gauge reflects in-flight usage during the tool loop.
   * Requires the caller to have seeded the snapshot via `beginNodePhase()`.
   */
  state?: TokenTrackingState;

  /**
   * Optional per-task callback. Called once for every `<task>...</task>`
   * element observed in the streaming text of any round. The argument is
   * the raw JSON body (without the wrapper tags). Used by decompose to
   * push partial Kanban broadcasts.
   */
  onTaskParsed?: (rawJson: string) => void | Promise<void>;
}

/**
 * Run an LLM call with a multi-round tool-use loop.
 *
 * The LLM can call the supplied tools (e.g. `read_source_doc`, `read_file`,
 * `list_files`) to fetch documents on-demand. Loop continues until the LLM
 * produces a final text response without tool calls, or `maxRounds` is reached.
 */
export async function callLLMWithToolLoop(
  llm: LLMClient,
  messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
  tools: ToolDefinition[],
  toolHandler: (name: string, args: Record<string, any>) => string | Promise<string>,
  options: ToolLoopOptions,
): Promise<{ response: string; usage?: TaskTokenUsage }> {
  const { extractTokenUsageFromStreamEvent, maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } = await import('../graph/llmHelpers');
  const maxRounds = options.maxRounds ?? 10;
  let allMessages = [...messages];
  let totalUsage: TaskTokenUsage | undefined;
  let cumulativeToolResultChars = 0;

  let xmlParser: import('../../../core/streaming/parsers/XMLStreamParser').XMLStreamParser | null = null;
  let xmlState: import('../../../core/streaming/state/StreamState').StreamState | null = null;
  if (options.onTaskParsed) {
    const { XMLStreamParser } = await import('../../../core/streaming/parsers/XMLStreamParser');
    const { StreamState } = await import('../../../core/streaming/state/StreamState');
    xmlParser = new XMLStreamParser();
    xmlState = new StreamState();
  }
  const onTaskParsedHook = options.onTaskParsed;

  for (let round = 0; round < maxRounds; round++) {
    const isLastRound = round === maxRounds - 1;
    const roundTools = isLastRound ? [] : tools;

    let response = '';
    let thinking = '';
    let thinkingSignature = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    let roundUsage: TaskTokenUsage | undefined;

    if (isLastRound) {
      console.warn(`⚠️ [ToolLoop] Final round (${round + 1}/${maxRounds}) — tools stripped, forcing final response`);
    }

    if (options.state) {
      applyEstimatedInputTokensFromMessages(options.state, allMessages);
    }

    for await (const event of llm.stream(allMessages, {
      tools: roundTools.length > 0 ? roundTools : undefined,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      enableThinking: options.enableThinking,
      thinkingBudget: options.thinkingBudget,
    })) {
      if (event.type === 'retry') {
        response = '';
        thinking = '';
        thinkingSignature = '';
        toolCalls.length = 0;
        roundUsage = undefined;
        if (xmlParser) xmlParser.reset();
        if (xmlState) xmlState.reset();
        continue;
      }
      if (options.state) {
        maybeUpdatePhaseTokenUsage(options.state, event);
      }
      if (event.text) {
        response += event.text;
        if (xmlParser && xmlState && onTaskParsedHook) {
          const actions = xmlParser.parse(event, xmlState);
          for (const action of actions) {
            if (action.type === 'task_added' && action.data.rawJson) {
              await onTaskParsedHook(action.data.rawJson);
            }
          }
        }
      }
      if (event.thinking) thinking += event.thinking;
      if (event.signature) thinkingSignature = event.signature;
      if (event.type === 'tool_use' && event.toolUse) {
        toolCalls.push({
          id: event.toolUse.id,
          name: event.toolUse.name,
          input: event.toolUse.input,
        });
      }
      const u = extractTokenUsageFromStreamEvent(event);
      if (u) roundUsage = u;
    }

    totalUsage = mergeTokenUsage(totalUsage, roundUsage);

    if (toolCalls.length === 0) {
      return { response, usage: totalUsage };
    }

    if (isLastRound) {
      console.warn(`⚠️ [ToolLoop] LLM returned tool calls on final round despite tools being stripped — returning partial response`);
      return { response: response || '', usage: totalUsage };
    }

    console.log(`🔧 [ToolLoop] Round ${round + 1}: ${toolCalls.length} tool call(s)`);

    const assistantContent: MessageContentBlock[] = [];
    if (response) {
      assistantContent.push({ type: 'text', text: response });
    }
    if (thinking) {
      assistantContent.push({ type: 'thinking', thinking, signature: thinkingSignature });
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }

    const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    const { normalizeToCodebasePath } = await import('../../../core/utils/pathNormalizer');
    const normalizeWorkspacePath = (raw: string): string =>
      normalizeToCodebasePath(raw).normalized;

    const toolResults: MessageContentBlock[] = [];
    for (const tc of toolCalls) {
      let cardId: string | undefined;
      let displayPath: string | undefined;
      try {
        if (tc.name === 'read_file' && typeof tc.input?.path === 'string') {
          displayPath = normalizeWorkspacePath(tc.input.path);
          cardId = await chatAPI.addReadingFile(displayPath);
        } else if (tc.name === 'read_source_doc' && typeof tc.input?.filename === 'string') {
          cardId = await chatAPI.addReadingSource(
            tc.input.filename,
            tc.input.startLine,
            tc.input.endLine,
          );
        } else if (tc.name === 'list_files' && typeof tc.input?.directory === 'string') {
          displayPath = normalizeWorkspacePath(tc.input.directory);
          cardId = await chatAPI.showChatStatus('exploring', { directory: displayPath });
        }
      } catch (err) {
        console.warn(`⚠️ [ToolLoop] chat status start failed:`, err);
      }

      let result = await toolHandler(tc.name, tc.input);
      cumulativeToolResultChars += result.length;

      if (cumulativeToolResultChars > TOOL_RESULT_BUDGET) {
        const overBy = cumulativeToolResultChars - TOOL_RESULT_BUDGET;
        if (result.length > overBy) {
          result = result.slice(0, result.length - overBy)
            + `\n\n[... truncated — cumulative tool result budget (${TOOL_RESULT_BUDGET.toLocaleString()} chars) reached]`;
        }
        console.warn(`⚠️ [ToolLoop] Tool result budget reached (${cumulativeToolResultChars.toLocaleString()} chars)`);
      }

      try {
        const isErr = result.startsWith('Error:');
        if (tc.name === 'read_file' && typeof tc.input?.path === 'string') {
          await chatAPI.addReadComplete(displayPath ?? tc.input.path, cardId, isErr ? { error: result } : undefined);
        } else if (tc.name === 'read_source_doc' && typeof tc.input?.filename === 'string') {
          await chatAPI.addReadSourceComplete(
            tc.input.filename,
            cardId,
            isErr
              ? { error: result }
              : { startLine: tc.input.startLine, endLine: tc.input.endLine },
          );
        } else if (tc.name === 'list_files' && typeof tc.input?.directory === 'string') {
          await chatAPI.showChatStatus('explored', {
            directory: displayPath ?? tc.input.directory,
            ...(cardId ? { _mergeIndex: cardId } : {}),
            ...(isErr ? { error: true } : {}),
          });
        }
      } catch (err) {
        console.warn(`⚠️ [ToolLoop] chat status complete failed:`, err);
      }

      console.log(`   📄 ${tc.name}(${JSON.stringify(tc.input)}) → ${result.length.toLocaleString()} chars`);
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, tool_name: tc.name, content: result });
    }

    const isSecondToLast = maxRounds - round - 2 === 0;
    const userContent: MessageContentBlock[] = [...toolResults];
    if (isSecondToLast) {
      userContent.push({ type: 'text', text: '[SYSTEM] You have 1 tool call remaining. Produce your FINAL output on the next response. Do NOT make additional tool calls.' });
    }

    allMessages.push(
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userContent },
    );
  }

  throw new Error(`[ToolLoop] Exceeded maximum rounds (${maxRounds}) without final response`);
}
