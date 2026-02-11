/**
 * Tool Node
 * 
 * Executes tools called by the generate node and returns results.
 */

import { PlanGraphState } from '../state';
import { PLANNER_TOOLS } from '../../tools';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';

export async function toolNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const pending = state.pendingToolCall;
  if (!pending) {
    console.warn('[Planner:Tool] No pending tool call');
    return { pendingToolCall: undefined };
  }
  
  // Workflow instrumentation (pass recursion info for badge display)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'tool', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit,
    );
  }
  
  console.log(`🔧 [Planner:Tool] Executing: ${pending.name}`);
  
  // Show placeholder status before tool execution (same as code job tool node)
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder', {
    content: `${pending.name}`
  });
  
  const tool = PLANNER_TOOLS.find(t => t.name === pending.name);
  if (!tool) {
    console.error(`[Planner:Tool] Unknown tool: ${pending.name}`);
    const errorResult = `Error: Unknown tool "${pending.name}"`;
    
    const updatedHistory = [...state.conversationHistory];
    updatedHistory.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: pending.id, content: errorResult }],
    });
    
    return {
      conversationHistory: updatedHistory,
      pendingToolCall: undefined,
    };
  }
  
  let result: string;
  try {
    result = await tool.execute(pending.args);
  } catch (error: any) {
    result = `Error: ${error.message}`;
    console.error(`[Planner:Tool] Error: ${error.message}`);
  }
  
  console.log(`   Result: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`);
  
  // Finalize current message after each tool execution (intermediate session save).
  // This ensures each generate→tool cycle is saved to chat.json independently,
  // matching code/design job behavior where each task iteration is persisted.
  // The next generateNode's showChatStatus('placeholder') will auto-start a new message.
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', 0);
  }
  
  const updatedHistory = [...state.conversationHistory];
  updatedHistory.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: pending.id, content: result }],
  });
  
  return {
    conversationHistory: updatedHistory,
    pendingToolCall: undefined,
  };
}
