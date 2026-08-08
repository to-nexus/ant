/**
 * Universal LangGraph — the file-defined custom agent/job runtime.
 *
 * Flow (D2 + intent classification):
 *   resolve ──→ classify ──→ agent ⇄ tool
 *                              │
 *                              └──→ respond
 *
 * Context-window management is inline in the agent node (not a node of its
 * own); safety backstop is the recursionLimit on invokeGraph.
 */

import { StateGraph } from '@langchain/langgraph';
import { UniversalAnnotation } from './state';
import { createResolveNode } from '../../common/graph/nodes/resolve';
import { universalResolveStrategy } from './nodes/resolve';
import { agentNode, routeAfterAgent } from './nodes/agent';
import { classifyNode } from './nodes/classify';
import { toolNode } from './nodes/tool';
import { respondNode } from './nodes/respond';
import { withPhaseTracking } from '../../common/graph/llmHelpers';

export function buildUniversalGraph() {
  const graph = new StateGraph(UniversalAnnotation);

  graph.addNode('resolve', createResolveNode(universalResolveStrategy) as any);
  graph.addNode('classify', withPhaseTracking('classify', classifyNode) as any);
  graph.addNode('agent', withPhaseTracking('agent', agentNode) as any);
  graph.addNode('tool', toolNode as any);
  graph.addNode('respond', respondNode as any);

  graph.addEdge('__start__' as any, 'resolve' as any);
  graph.addEdge('resolve' as any, 'classify' as any);
  graph.addEdge('classify' as any, 'agent' as any);

  graph.addConditionalEdges(
    'agent' as any,
    routeAfterAgent,
    {
      tool: 'tool' as any,
      respond: 'respond' as any,
      // Join-barrier redo: subagent reports delivered, agent re-reasons.
      agent: 'agent' as any,
    } as any,
  );

  graph.addEdge('tool' as any, 'agent' as any);
  graph.addEdge('respond' as any, '__end__' as any);

  return (graph as any).compile();
}
