/**
 * MessageBuilder — constructs Anthropic-format messages for conversation history
 *
 * Two directions:
 * - buildAssistantMessage: LLM node → history (assistant turn)
 * - buildToolResultMessage: tool node → history (user turn)
 */

import type { ToolExecutionEvent, ToolResult } from './types';
import type {
  ThinkingContentBlock,
  TextContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from '../../../core/ports/llm';

export interface AssistantMessageOptions {
  thinking?: string;
  thinkingSignature?: string;
  text?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, any> }>;
}

/**
 * Build an Anthropic-format assistant message from LLM response components.
 *
 * Content block order follows Anthropic API convention:
 *   thinking (optional) → text (optional) → tool_use[] (optional)
 *
 * When the result is a single text block with no thinking,
 * returns content as a plain string (Anthropic API shorthand).
 */
export function buildAssistantMessage(
  options: AssistantMessageOptions,
): { role: 'assistant'; content: string | (ThinkingContentBlock | TextContentBlock | ToolUseContentBlock)[] } {
  const content: (ThinkingContentBlock | TextContentBlock | ToolUseContentBlock)[] = [];

  if (options.thinking) {
    content.push({
      type: 'thinking',
      thinking: options.thinking,
      signature: options.thinkingSignature || '',
    });
  }

  if (options.text) {
    content.push({ type: 'text', text: options.text });
  }

  if (options.toolCalls?.length) {
    for (const tc of options.toolCalls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.args,
      });
    }
  }

  if (content.length === 1 && content[0].type === 'text') {
    return { role: 'assistant' as const, content: options.text! };
  }

  return { role: 'assistant' as const, content };
}

export interface ToolResultMessageParts {
  toolUseBlocks: ToolUseContentBlock[];
  toolResultBlocks: ToolResultContentBlock[];
}

/**
 * Build Anthropic-format tool_use and tool_result blocks from execution events.
 */
export function buildToolResultMessage(events: ToolExecutionEvent[]): ToolResultMessageParts {
  const toolUseBlocks: ToolUseContentBlock[] = [];
  const toolResultBlocks: ToolResultContentBlock[] = [];

  for (const event of events) {
    toolUseBlocks.push({
      type: 'tool_use',
      id: event.toolCallId,
      name: event.toolName,
      input: event.args,
    });

    toolResultBlocks.push({
      type: 'tool_result',
      tool_use_id: event.toolCallId,
      tool_name: event.toolName,
      content: formatToolResultContent(event.result),
    });
  }

  return { toolUseBlocks, toolResultBlocks };
}

/**
 * Convert a ToolResult into the content format expected by Anthropic API.
 * Array content (e.g., Figma multimodal) is passed through; string content
 * is used as-is.
 */
function formatToolResultContent(result: ToolResult): string | any[] {
  if (result.error && typeof result.content === 'string' && !result.content.startsWith('Error:')) {
    return `Error: ${result.error}`;
  }
  return result.content;
}
