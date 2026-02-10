/**
 * Tool Node
 * 
 * Executes tools called by the generate node and returns results.
 */

import { PlanGraphState } from '../state';
import { PLANNER_TOOLS } from '../../tools';

export async function toolNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const pending = state.pendingToolCall;
  if (!pending) {
    console.warn('[Planner:Tool] No pending tool call');
    return { pendingToolCall: undefined };
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'tool', 0);
  }
  
  console.log(`🔧 [Planner:Tool] Executing: ${pending.name}`);
  
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
