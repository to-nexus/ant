/**
 * MessageBuilder — constructs Anthropic-format tool result messages
 *
 * Builds the user message containing tool_result blocks from a batch
 * of tool execution events. Optionally appends extra content blocks
 * (e.g., task reminders).
 */

import type { ToolExecutionEvent, ToolResult } from './types';
import type { ToolResultContentBlock, ToolUseContentBlock } from '../../../core/ports/llm';

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
