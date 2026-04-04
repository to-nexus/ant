/**
 * Tool Node
 * 
 * Executes pending tool calls and adds results to conversation history.
 * Uses Anthropic native format (tool_use + tool_result) - same as Code Job.
 * Supports batch execution of multiple tool calls.
 */

import type { ToolResultContentBlock } from '../../../../../core/ports/llm.js';
import { AskGraphState, AskToolCall, ConversationMessage } from '../state.js';
import { executeTool } from '../tools.js';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Tool node - execute all pending tool calls
 */
export async function toolNode(state: AskGraphState): Promise<Partial<AskGraphState>> {
  const pending = state.pendingToolCalls || [];
  
  if (pending.length === 0) {
    console.warn('[Tool] No pending tool calls');
    return { pendingToolCalls: [] };
  }
  
  const toolResultBlocks: ToolResultContentBlock[] = [];
  const toolCallRecords: AskToolCall[] = [];

  if (DEBUG) {
    console.log(`\n🔧 [Tool] Executing ${pending.length} tool call(s)`);
  }

  for (const tc of pending) {
    if (DEBUG) {
      console.log(`🔧 [Tool] Executing: ${tc.name}`);
      console.log(`   Args: ${JSON.stringify(tc.args)}`);
    }
    
    const startTime = Date.now();
    const result = await executeTool(tc.name, tc.args);
    const duration = Date.now() - startTime;
    
    if (DEBUG) {
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Success: ${result.success}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      } else if (result.content) {
        console.log(`   Content length: ${result.content.length}`);
      }
    }
    
    toolCallRecords.push({
      name: tc.name,
      args: tc.args,
      result: result.content,
      error: result.error,
      timestamp: Date.now(),
    });
    
    const toolResultContent = result.success
      ? result.content || 'No content returned'
      : `Error: ${result.error}`;
    
    toolResultBlocks.push({
      type: 'tool_result',
      tool_use_id: tc.id,
      tool_name: tc.name,
      content: toolResultContent,
    });
  }
  
  // Add batch tool_result to conversation history
  const newHistory: ConversationMessage[] = [
    ...state.conversationHistory,
    {
      role: 'user',
      content: toolResultBlocks,
    },
  ];
  
  return {
    conversationHistory: newHistory,
    toolCalls: [...state.toolCalls, ...toolCallRecords],
    pendingToolCalls: [],
  };
}
