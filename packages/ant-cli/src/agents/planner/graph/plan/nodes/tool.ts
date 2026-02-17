/**
 * Tool Node
 * 
 * Executes tools called by the generate node and returns results.
 * Supports batch execution of multiple tool calls.
 */

import { PlanGraphState } from '../state';
import { PLANNER_TOOLS } from '../../tools';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';

export async function toolNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const pending = state.pendingToolCalls || [];
  if (pending.length === 0) {
    console.warn('[Planner:Tool] No pending tool calls');
    return { pendingToolCalls: [] };
  }
  
  // Workflow instrumentation (pass recursion info for badge display)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'tool', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit,
    );
  }
  
  const chatAPI = getChatAPIClient();
  const toolResultBlocks: any[] = [];

  console.log(`🔧 [Planner:Tool] Executing ${pending.length} tool call(s)`);

  for (const tc of pending) {
    console.log(`🔧 [Planner:Tool] Executing: ${tc.name}`);
    
    await chatAPI.showChatStatus('placeholder', { content: `${tc.name}` });
    
    const tool = PLANNER_TOOLS.find(t => t.name === tc.name);
    if (!tool) {
      console.error(`[Planner:Tool] Unknown tool: ${tc.name}`);
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: `Error: Unknown tool "${tc.name}"`,
      });
      continue;
    }
    
    let result: string;
    try {
      result = await tool.execute(tc.args);
    } catch (error: any) {
      result = `Error: ${error.message}`;
      console.error(`[Planner:Tool] Error: ${error.message}`);
    }
    
    console.log(`   Result: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`);
    
    toolResultBlocks.push({
      type: 'tool_result',
      tool_use_id: tc.id,
      content: result,
    });
  }

  // Finalize current message after batch execution
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', 0);
  }
  
  // Add batch tool_result to conversation history
  const updatedHistory = [...state.conversationHistory];
  updatedHistory.push({
    role: 'user',
    content: toolResultBlocks,
  });
  
  // Checkpoint: save conversationHistory to session after tool execution
  const session = state.deps?.session;
  if (session) {
    const pid = session.projectId || process.env.ANT_PROJECT_ID || 'default';
    const fname = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
    try {
      const sessionData = await session.load(pid, fname, 'plan');
      await session.updateArtifacts(pid, fname, 'plan', {
        state: {
          ...sessionData.state,
          conversationHistory: updatedHistory,
          tokenUsage: state.tokenUsage,
        }
      });
      console.log(`💾 [Planner:Tool] Checkpoint saved (${updatedHistory.length} history entries)`);
    } catch (err: any) {
      console.warn(`⚠️ [Planner:Tool] Failed to save checkpoint: ${err.message}`);
    }
  }
  
  // Update stateSnapshot for SIGTERM handler access
  if (state.deps?.stateSnapshot) {
    state.deps.stateSnapshot.conversationHistory = updatedHistory;
    state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
  }
  
  return {
    conversationHistory: updatedHistory,
    pendingToolCalls: [],
  };
}
