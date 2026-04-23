/**
 * invokeLLMWithTools — streaming LLM invocation wrapper.
 *
 * Collects a single LLM turn into a plain object (thinking / text / tool calls /
 * token usage). Independent of graph state; used by the `direct` node's ReAct
 * loop. execute() has its own inline streaming for file-tag processing — do NOT
 * refactor execute() to use this helper in the current plan step.
 */

import type { LLMClient, MessageContentBlock, ToolDefinition } from '../../../../../../core/ports/llm';
import {
  applyEstimatedInputTokensFromMessages,
  maybeUpdatePhaseTokenUsage,
  type TokenTrackingState,
  type TokenUsage,
} from '../../../../../common/graph/llmHelpers';

export interface InvokeLLMWithToolsInput {
  llm: LLMClient;
  messages: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>;
  tools: ToolDefinition[];
  maxTokens?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  /**
   * Graph state carrying `currentPhaseTokenUsage`. When provided, in-flight
   * `usage_partial` events from the stream overwrite the chat-input gauge
   * snapshot live instead of waiting for the terminal `done` event. Optional
   * so non-graph callers (if any) stay unaffected.
   */
  state?: TokenTrackingState;
}

export interface InvokeLLMWithToolsResult {
  thinking: string;
  thinkingSignature: string;
  textResponse: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
  done: boolean;
  tokenUsage?: TokenUsage;
}

export async function invokeLLMWithTools(
  input: InvokeLLMWithToolsInput,
): Promise<InvokeLLMWithToolsResult> {
  const {
    llm, messages, tools, maxTokens, enableThinking, thinkingBudget, state,
  } = input;

  let thinking = '';
  let thinkingSignature = '';
  let textResponse = '';
  let done = false;
  let tokenUsage: TokenUsage | undefined;
  const toolCalls: InvokeLLMWithToolsResult['toolCalls'] = [];

  // T1 pre-call estimate — ReAct loop iterates; each call rebuilds
  // messages[] (history grows) so re-seed per iteration.
  if (state) applyEstimatedInputTokensFromMessages(state, messages);

  for await (const event of llm.stream(messages as any, {
    tools,
    maxTokens,
    enableThinking,
    thinkingBudget,
  })) {
    if (event.type === 'retry') {
      thinking = '';
      thinkingSignature = '';
      textResponse = '';
      done = false;
      tokenUsage = undefined;
      toolCalls.length = 0;
      continue;
    }

    // In-flight gauge update from usage_partial events (Anthropic/Gemini).
    // No-op when `state` is not supplied or no phase snapshot is seeded.
    if (state) maybeUpdatePhaseTokenUsage(state, event);

    switch (event.type) {
      case 'thinking':
        thinking += event.thinking || '';
        if (event.signature) thinkingSignature = event.signature;
        break;
      case 'text':
        textResponse += event.text || '';
        break;
      case 'tool_use':
        if (event.toolUse) {
          toolCalls.push({
            id: event.toolUse.id,
            name: event.toolUse.name,
            args: event.toolUse.input,
          });
        }
        break;
      case 'done':
        done = true;
        if (event.usage) {
          tokenUsage = {
            inputTokens: event.usage.inputTokens ?? 0,
            outputTokens: event.usage.outputTokens ?? 0,
            cacheCreationTokens: event.usage.cacheCreationTokens,
            cacheReadTokens: event.usage.cacheReadTokens,
            totalTokens: (event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0),
          } as TokenUsage;
        }
        break;
      default:
        break;
    }
  }

  return { thinking, thinkingSignature, textResponse, toolCalls, done, tokenUsage };
}
