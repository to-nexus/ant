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
import { AskAnnotation } from './state';
import { agentNode, routeAfterAgent } from './nodes/agent';
import { toolNode } from './nodes/tool';
import { respondNode } from './nodes/respond';

/**
 * Build Ask LangGraph
 */
export function buildAskGraph() {
  const graph = new StateGraph(AskAnnotation);
  
  graph.addNode('agent', agentNode as any);
  graph.addNode('tool', toolNode as any);
  graph.addNode('respond', respondNode as any);
  
  graph.addEdge('__start__' as any, 'agent' as any);
  
  graph.addConditionalEdges(
    'agent' as any,
    routeAfterAgent,
    {
      tool: 'tool' as any,
      respond: 'respond' as any,
    } as any
  );
  
  graph.addEdge('tool' as any, 'agent' as any);
  graph.addEdge('respond' as any, '__end__' as any);
  
  return (graph as any).compile();
}
