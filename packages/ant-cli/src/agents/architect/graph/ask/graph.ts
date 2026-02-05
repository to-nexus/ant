/**
 * Ask LangGraph
 * 
 * Agentic workflow for answering questions about Ant by exploring source code.
 * Uses Anthropic native format (same as Code Job) for reliable tool calling.
 * 
 * Flow:
 *   agent (LLM decision) ←→ tool (execution)
 *          ↓ (done)
 *       respond (stream to chat)
 */

import { StateGraph } from '@langchain/langgraph';
import { AskGraphState } from './state.js';
import { agentNode, routeAfterAgent } from './nodes/agent.js';
import { toolNode } from './nodes/tool.js';
import { respondNode } from './nodes/respond.js';

/**
 * Build Ask LangGraph
 */
export function buildAskGraph() {
  const graph = new StateGraph<AskGraphState>({
    channels: {
      // Input
      question: null as any,
      language: null as any,
      workspaceState: null as any,
      currentJob: null as any,
      currentAgent: null as any,
      
      // LLM conversation (Anthropic native format)
      conversationHistory: null as any,
      
      // Tool execution
      toolCalls: null as any,
      pendingToolCall: null as any,
      
      // Output
      response: null as any,
      streamingCompleted: null as any,
      chatMessageStarted: null as any,
      
      // Dependencies
      deps: null as any,
      _httpJobId: null as any,
      tokenUsage: null as any,
    } as any,
  } as any);
  
  // Add nodes
  graph.addNode('agent', agentNode as any);
  graph.addNode('tool', toolNode as any);
  graph.addNode('respond', respondNode as any);
  
  // Start with agent
  graph.addEdge('__start__' as any, 'agent' as any);
  
  // Agent decides: call tool or respond
  graph.addConditionalEdges(
    'agent' as any,
    routeAfterAgent,
    {
      tool: 'tool' as any,
      respond: 'respond' as any,
    } as any
  );
  
  // After tool, go back to agent (loop)
  graph.addEdge('tool' as any, 'agent' as any);
  
  // After respond, end
  graph.addEdge('respond' as any, '__end__' as any);
  
  return (graph as any).compile();
}
