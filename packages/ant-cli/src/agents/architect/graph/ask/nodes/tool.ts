/**
 * Tool Node
 * 
 * Executes the pending tool call and adds result to conversation history.
 * Uses Anthropic native format (tool_use + tool_result) - same as Code Job.
 */

import { AskGraphState, AskToolCall, ConversationMessage } from '../state.js';
import { executeTool } from '../tools.js';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Tool node - execute pending tool call
 * Uses Anthropic native format for tool results (same as Code Job)
 */
export async function toolNode(state: AskGraphState): Promise<Partial<AskGraphState>> {
  const pending = state.pendingToolCall;
  
  if (!pending) {
    console.warn('[Tool] No pending tool call');
    return {};
  }
  
  if (DEBUG) {
    console.log(`\n🔧 [Tool] Executing: ${pending.name}`);
    console.log(`   Args: ${JSON.stringify(pending.args)}`);
  }
  
  const startTime = Date.now();
  
  // Execute tool
  const result = await executeTool(pending.name, pending.args);
  
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
  
  // Record tool call for debugging
  const toolCallRecord: AskToolCall = {
    name: pending.name,
    args: pending.args,
    result: result.content,
    error: result.error,
    timestamp: Date.now(),
  };
  
  // Build tool result content
  const toolResultContent = result.success
    ? result.content || 'No content returned'
    : `Error: ${result.error}`;
  
  // Add tool_result to conversation history (Anthropic native format - same as Code Job)
  // The tool_use was already added by agent node
  const newHistory: ConversationMessage[] = [
    ...state.conversationHistory,
    // User message with tool_result
    {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: pending.id,
        content: toolResultContent,
      }],
    },
  ];
  
  return {
    conversationHistory: newHistory,
    toolCalls: [...state.toolCalls, toolCallRecord],
    pendingToolCall: undefined,  // Clear pending
  };
}
