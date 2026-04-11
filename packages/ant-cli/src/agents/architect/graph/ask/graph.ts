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

import { Annotation, StateGraph } from '@langchain/langgraph';
import { AskGraphState } from './state.js';
import { agentNode, routeAfterAgent } from './nodes/agent.js';
import { toolNode } from './nodes/tool.js';
import { respondNode } from './nodes/respond.js';

const AskAnnotation = Annotation.Root({
  question: Annotation<any>,
  language: Annotation<any>,
  workspaceState: Annotation<any>,
  currentJob: Annotation<any>,
  currentAgent: Annotation<any>,
  conversationHistory: Annotation<any>,
  toolCalls: Annotation<any>,
  pendingToolCalls: Annotation<any>,
  response: Annotation<any>,
  streamingCompleted: Annotation<any>,
  chatMessageStarted: Annotation<any>,
  resolvedAction: Annotation<any>,
  isEvaluation: Annotation<any>,
  evalType: Annotation<any>,
  featurePath: Annotation<any>,
  deps: Annotation<any>,
  _httpJobId: Annotation<any>,
  tokenUsage: Annotation<any>,
});

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
