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

  /**
   * Suppress the built-in per-tool chat cards (read_file / read_source_doc /
   * list_files). Subagent child loops set this — the child is silent in chat;
   * only its launch/report card (owned by the runner) surfaces.
   */
  silentChatCards?: boolean;

  /** Threaded into `llm.stream` options (Anthropic adapter honors it). */
  signal?: AbortSignal;

  /**
   * Polled at each round boundary. When true the loop returns early with
   * `aborted: true` and whatever partial response has accumulated.
   */
  shouldAbort?: () => boolean;

  /**
   * Drain hook: called after each tool round's results are collected. Returned
   * blocks are appended to the tool_result user message (after results, before
   * the final-round nudge). Used to deliver completed subagent reports.
   */
  betweenRounds?: () => Promise<MessageContentBlock[]>;

  /**
   * Join hook: called when the LLM produced a final response (no tool calls).
   * A non-empty return means pending work (subagent reports) must be delivered
   * first — the loop pushes assistant(response) + user(blocks) and continues,
   * extending the round budget by one (at most twice), so a join at the last
   * round is not starved.
   */
  beforeFinalReturn?: () => Promise<MessageContentBlock[] | null>;
}

export interface ToolLoopResult {
  response: string;
  usage?: TaskTokenUsage;
  /** Rounds actually consumed (1-based count). */
  roundsUsed: number;
  /** True when the final response was forced by the round cap (tools stripped). */
  exhausted: boolean;
  /** True when `shouldAbort` ended the loop early. */
  aborted?: boolean;
  /**
   * Stop reason of the round that produced `response`. `'max_tokens'` means
   * the returned text was truncated mid-stream by the output budget —
   * callers treating `response` as a complete artifact (subagent reports,
   * decompose bodies) must not assume it is well-formed.
   */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'other';
}

/** Max extra rounds grantable by `beforeFinalReturn` joins. */
const MAX_JOIN_EXTENSIONS = 2;

const FINAL_ROUND_NOTICE =
  '[SYSTEM] Tool access has ended — this is your FINAL response. Produce your ' +
  'complete final output now, following your required output format, from the ' +
  'findings gathered so far. Do NOT attempt or narrate further tool calls.';

/**
 * Make the tool-strip on the final round explicit to the model. Without this,
 * the last-round request silently loses its tools and a model that intended
 * to keep exploring narrates the unfulfilled intent instead of producing its
 * final artifact (observed as degenerate "Let me also check…" repetition).
 * Appends into the trailing user message (keeps role alternation); no-ops on
 * a string-content opener (fresh single-round calls need no end-of-tools notice).
 */
function appendFinalRoundNotice(
  allMessages: Array<{ role: string; content: string | MessageContentBlock[] }>,
): void {
  const last = allMessages[allMessages.length - 1];
  const notice: MessageContentBlock = { type: 'text', text: FINAL_ROUND_NOTICE };
  if (last && last.role === 'user' && Array.isArray(last.content)) {
    const already = last.content.some(
      (b) => b.type === 'text' && (b as { text?: string }).text === FINAL_ROUND_NOTICE,
    );
    if (!already) last.content.push(notice);
    return;
  }
  if (last && last.role === 'assistant') {
    allMessages.push({ role: 'user', content: [notice] });
  }
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
  toolHandler: (name: string, args: Record<string, any>, callId?: string) => string | Promise<string>,
  options: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const { extractTokenUsageFromStreamEvent, maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } = await import('../graph/llmHelpers');
  const maxRounds = options.maxRounds ?? 10;
  let effectiveMaxRounds = maxRounds;
  let joinExtensions = 0;
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

  for (let round = 0; round < effectiveMaxRounds; round++) {
    if (options.shouldAbort?.()) {
      console.warn(`⚠️ [ToolLoop] Abort requested at round ${round + 1} — returning early`);
      return { response: '', usage: totalUsage, roundsUsed: round, exhausted: false, aborted: true };
    }
    const isLastRound = round === effectiveMaxRounds - 1;
    const roundTools = isLastRound ? [] : tools;

    let response = '';
    let thinking = '';
    let thinkingSignature = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    let roundUsage: TaskTokenUsage | undefined;
    let roundStopReason: ToolLoopResult['stopReason'];

    if (isLastRound) {
      console.warn(`⚠️ [ToolLoop] Final round (${round + 1}/${effectiveMaxRounds}) — tools stripped, forcing final response`);
      appendFinalRoundNotice(allMessages);
    }

    if (options.state) {
      applyEstimatedInputTokensFromMessages(options.state, allMessages);
    }

    // Per-round thinking toggle (code-execute / 5e981a1f contract): thinking on
    // round 0 (initial planning) only, OFF on every tool-continuation round.
    // On adaptive Anthropic models this is ignored (they always think); it only
    // bounds toggle providers (GLM/DeepSeek unbounded, Haiku budget-capped),
    // preventing the every-round GLM reasoning that overflows max_tokens.
    const roundThinking = round === 0 ? options.enableThinking : false;

    for await (const event of llm.stream(allMessages, {
      tools: roundTools.length > 0 ? roundTools : undefined,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      enableThinking: roundThinking,
      thinkingBudget: roundThinking ? options.thinkingBudget : undefined,
      ...(options.signal ? { signal: options.signal } : {}),
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
      if (event.stopReason) roundStopReason = event.stopReason;
      const u = extractTokenUsageFromStreamEvent(event);
      if (u) roundUsage = u;
    }

    if (roundStopReason === 'max_tokens') {
      console.warn(`⚠️ [ToolLoop] Round ${round + 1} output truncated by max_tokens (${options.maxTokens}) — response may be incomplete`);
    }

    totalUsage = mergeTokenUsage(totalUsage, roundUsage);

    if (toolCalls.length === 0) {
      // JOIN seam: pending work (subagent reports) must land before the final
      // response is accepted. Push the produced response + delivered blocks and
      // grant one extra round (bounded) so a last-round join is not starved.
      if (options.beforeFinalReturn) {
        const joinBlocks = await options.beforeFinalReturn();
        if (joinBlocks && joinBlocks.length > 0 && joinExtensions < MAX_JOIN_EXTENSIONS) {
          joinExtensions++;
          effectiveMaxRounds = Math.min(maxRounds + MAX_JOIN_EXTENSIONS, effectiveMaxRounds + 1);
          const assistantContent: MessageContentBlock[] = [];
          if (thinking) assistantContent.push({ type: 'thinking', thinking, signature: thinkingSignature });
          assistantContent.push({ type: 'text', text: response || '(waiting for pending reports)' });
          allMessages.push(
            { role: 'assistant', content: assistantContent },
            { role: 'user', content: joinBlocks },
          );
          console.log(`🔀 [ToolLoop] Join: ${joinBlocks.length} block(s) delivered before final return (extension ${joinExtensions}/${MAX_JOIN_EXTENSIONS})`);
          continue;
        }
      }
      return { response, usage: totalUsage, roundsUsed: round + 1, exhausted: isLastRound, stopReason: roundStopReason };
    }

    if (isLastRound) {
      console.warn(`⚠️ [ToolLoop] LLM returned tool calls on final round despite tools being stripped — returning partial response`);
      return { response: response || '', usage: totalUsage, roundsUsed: round + 1, exhausted: true, stopReason: roundStopReason };
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

    const silent = options.silentChatCards === true;
    const chatAPI = silent
      ? null
      : (await import('../../../core/adapters/ChatAPIClient')).getChatAPIClient();
    const normalizeWorkspacePath = silent
      ? (raw: string): string => raw
      : await (async () => {
          const { normalizeToCodebasePath } = await import('../../../core/utils/pathNormalizer');
          return (raw: string): string => normalizeToCodebasePath(raw).normalized;
        })();

    const toolResults: MessageContentBlock[] = [];
    for (const tc of toolCalls) {
      let cardId: string | undefined;
      let displayPath: string | undefined;
      try {
        if (!chatAPI) {
          // silentChatCards: no per-tool cards from this loop
        } else if (tc.name === 'read_file' && typeof tc.input?.path === 'string') {
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

      let result = await toolHandler(tc.name, tc.input, tc.id);
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
        if (!chatAPI) {
          // silentChatCards: no per-tool cards from this loop
        } else if (tc.name === 'read_file' && typeof tc.input?.path === 'string') {
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

    const isSecondToLast = effectiveMaxRounds - round - 2 === 0;
    const userContent: MessageContentBlock[] = [...toolResults];
    if (options.betweenRounds) {
      const drained = await options.betweenRounds();
      if (drained && drained.length > 0) {
        userContent.push(...drained);
      }
    }
    if (isSecondToLast) {
      // Truthful budget notice — tools are STRIPPED on the next (final) round,
      // so "1 tool call remaining" would be a lie that invites the model to
      // plan another call and then narrate the unfulfilled intent.
      userContent.push({ type: 'text', text: '[SYSTEM] Tool budget exhausted — no tool calls remain. Your next response is your FINAL output; produce it in full. Do NOT attempt or narrate further tool calls.' });
    }

    allMessages.push(
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userContent },
    );
  }

  throw new Error(`[ToolLoop] Exceeded maximum rounds (${effectiveMaxRounds}) without final response`);
}
