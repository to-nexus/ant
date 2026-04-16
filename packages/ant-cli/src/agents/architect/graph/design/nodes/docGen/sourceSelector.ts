/**
 * Source Document Selection for Design Job
 *
 * Design-specific orchestration: tool definitions, thresholds, and decompose tool loop.
 * Pure combining functions are in core/utils/sourceDocuments.ts (shared with code job).
 */

import type { LLMClient, ToolDefinition, LLMStreamEvent, MessageContentBlock } from '../../../../../../core/ports/llm';
import type { TaskTokenUsage } from '@ant/shared';

// Re-export combining functions from shared module for backward compatibility
export {
  buildSourceDocsForTask,
  buildAllSourceDocs,
  buildCondensedSourceDocs,
  buildSourceFileIndex,
  getSourceDocsSize,
  handleReadSourceFile,
} from '../../../../../../core/utils/sourceDocuments';

/**
 * Character threshold for switching decompose from inline injection to tool-use.
 * 200K chars at ~2.0 chars/token (Korean) = ~100K tokens → leaves ~100K for template+response.
 */
export const DECOMPOSE_SOURCE_THRESHOLD = 200_000;

/**
 * Character threshold for switching execute phase from inline injection to tool-use.
 * Same rationale: 200K chars ≈ 100K tokens (Korean), leaving headroom for templates + response.
 */
export const EXECUTE_SOURCE_THRESHOLD = 200_000;

/**
 * Cumulative character budget for tool results within one decompose session.
 * 300K chars ≈ ~150K tokens at worst-case ratio → prevents token overflow on subsequent turns.
 */
const TOOL_RESULT_BUDGET = 300_000;

export const READ_SOURCE_DOC_TOOL: ToolDefinition = {
  name: 'read_source_doc',
  description: 'Read a source document by filename. Use startLine/endLine to read BROAD ranges (300-500+ lines per call). Prefer fewer large reads over many small ones — you have a limited call budget and MUST start writing output by call 5-7.',
  input_schema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Exact filename from the source file index',
      },
      startLine: {
        type: 'number',
        description: 'Start line number (1-based, inclusive). Use broad ranges (300-500+ lines).',
      },
      endLine: {
        type: 'number',
        description: 'End line number (1-based, inclusive). Use broad ranges (300-500+ lines).',
      },
    },
    required: ['filename'],
  },
};

/**
 * Merge two TokenUsage objects by summing all fields.
 */
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

export interface DecomposeToolLoopOptions {
  temperature: number;
  maxTokens: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  maxRounds?: number;
}

/**
 * Run a decompose LLM call with tool-use loop.
 *
 * The LLM can call read_source_doc (or read_design_doc) to fetch documents
 * on-demand. Loop continues until the LLM produces a final text response
 * without tool calls, or maxRounds is reached.
 *
 * @param llm - LLM client (must support stream with tools)
 * @param messages - Initial messages (system + user)
 * @param tools - Tool definitions (e.g., [READ_SOURCE_DOC_TOOL])
 * @param toolHandler - Function that executes a tool call and returns result string
 * @param options - LLM call options + loop constraints
 */
export async function decomposeWithToolLoop(
  llm: LLMClient,
  messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
  tools: ToolDefinition[],
  toolHandler: (name: string, args: Record<string, any>) => string,
  options: DecomposeToolLoopOptions,
): Promise<{ response: string; usage?: TaskTokenUsage }> {
  const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
  const maxRounds = options.maxRounds ?? 10;
  let allMessages = [...messages];
  let totalUsage: TaskTokenUsage | undefined;
  let cumulativeToolResultChars = 0;

  for (let round = 0; round < maxRounds; round++) {
    const isLastRound = round === maxRounds - 1;
    const roundTools = isLastRound ? [] : tools;

    let response = '';
    let thinking = '';
    let thinkingSignature = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    let roundUsage: TaskTokenUsage | undefined;

    if (isLastRound) {
      console.warn(`⚠️ [Decompose RAG] Final round (${round + 1}/${maxRounds}) — tools stripped, forcing final response`);
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
        continue;
      }
      if (event.text) response += event.text;
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
      console.warn(`⚠️ [Decompose RAG] LLM returned tool calls on final round despite tools being stripped — returning partial response`);
      return { response: response || '', usage: totalUsage };
    }

    console.log(`🔧 [Decompose RAG] Round ${round + 1}: ${toolCalls.length} tool call(s)`);

    const assistantContent: MessageContentBlock[] = [];
    if (thinking) {
      assistantContent.push({ type: 'thinking', thinking, signature: thinkingSignature });
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }

    const toolResults: MessageContentBlock[] = [];
    for (const tc of toolCalls) {
      let result = toolHandler(tc.name, tc.input);
      cumulativeToolResultChars += result.length;

      if (cumulativeToolResultChars > TOOL_RESULT_BUDGET) {
        const overBy = cumulativeToolResultChars - TOOL_RESULT_BUDGET;
        if (result.length > overBy) {
          result = result.slice(0, result.length - overBy)
            + `\n\n[... truncated — cumulative tool result budget (${TOOL_RESULT_BUDGET.toLocaleString()} chars) reached]`;
        }
        console.warn(`⚠️ [Decompose RAG] Tool result budget reached (${cumulativeToolResultChars.toLocaleString()} chars)`);
      }

      console.log(`   📄 ${tc.name}(${JSON.stringify(tc.input)}) → ${result.length.toLocaleString()} chars`);
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, tool_name: tc.name, content: result });
    }

    allMessages.push(
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    );

    const remainingRounds = maxRounds - round - 2;
    if (remainingRounds === 1) {
      allMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '[SYSTEM] You have 1 tool call remaining. Produce your FINAL output on the next response. Do NOT make additional tool calls.' }],
      });
    }
  }

  throw new Error(`[Decompose RAG] Exceeded maximum rounds (${maxRounds}) without final response`);
}
