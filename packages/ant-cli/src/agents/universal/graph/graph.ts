/**
 * Universal LangGraph — the file-defined custom agent/job runtime.
 *
 * Flow:
 *   resolve ──→ agent ⇄ tool
 *                 │       │
 *                 └──→ respond ←┘  (tool→respond only on a clarify pause)
 *
 * No detect/classification pass: the graph is linear (nothing routes on a
 * classification), turn context is deterministic from runner inputs
 * (assembled in resolve), and the checklist contract is always-on in the
 * agent prompt — so a per-turn pre-classifier LLM call buys nothing.
 *
 * Context-window management is inline in the agent node (not a node of its
 * own); safety backstop is the recursionLimit on invokeGraph.
 */

import { StateGraph } from '@langchain/langgraph';
import { UniversalAnnotation } from './state';
import { createResolveNode } from '../../common/graph/nodes/resolve';
import { universalResolveStrategy } from './nodes/resolve';
import { agentNode, routeAfterAgent } from './nodes/agent';
import { toolNode, routeAfterTool } from './nodes/tool';
import { respondNode } from './nodes/respond';
import { withPhaseTracking } from '../../common/graph/llmHelpers';

export function buildUniversalGraph() {
  const graph = new StateGraph(UniversalAnnotation);

  graph.addNode('resolve', createResolveNode(universalResolveStrategy) as any);
  graph.addNode('agent', withPhaseTracking('agent', agentNode) as any);
  graph.addNode('tool', toolNode as any);
  graph.addNode('respond', respondNode as any);

  graph.addEdge('__start__' as any, 'resolve' as any);
  graph.addEdge('resolve' as any, 'agent' as any);

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

  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool,
    {
      agent: 'agent' as any,
      // Clarify pause: the turn ends on the question; respond seals the
      // dangling tool_use and the next user turn closes it (end-and-resume).
      respond: 'respond' as any,
    } as any,
  );
  graph.addEdge('respond' as any, '__end__' as any);

  return (graph as any).compile();
}
