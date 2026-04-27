/**
 * Plan LangGraph
 *
 * Default flow: __start__ → resolve → triage → (conditional) → detect → generate ⟷ tool → END
 *
 * Triage branches:  ask → __end__, redirect → __end__, blocked → __end__, proceed → detect
 *
 * Triage normally runs even for conversation continuations so the system can
 * detect agent/job switches (e.g., user requests code work mid-planner
 * session). The single exception is the clarify-continuation short-circuit:
 * when `isResume && awaitingClarify && overrideDirective` the runner has
 * already restored the prior RAC, so resolve routes directly to generate
 * (mirrors design `routeAfterResolve`). This preserves the original intent
 * across the clarify round-trip without re-running triage/detect on the
 * answer text.
 *
 * generate handles: LLM streaming → file card (via StreamOrchestrator) → disk write → choice card → session
 * No separate write node — same pattern as design job's docGen.
 */

import { StateGraph, END } from '@langchain/langgraph';
import { PlanAnnotation, PlanGraphState } from './state';
import { planResolveStrategy } from './nodes/resolve';
import { createResolveNode } from '../../../common/graph/nodes/resolve';
import { generateNode, routeAfterGenerate } from './nodes/generate';
import { toolNode } from './nodes/tool';
import { triage } from '../../../common/graph/nodes/triage';
import { createDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { planDetectStrategy } from './nodes/detect/strategy.js';
import { withPhaseTracking } from '../../../common/graph/llmHelpers';

/**
 * Route after resolve for planner agent.
 * Short-circuits triage/detect when this is a clarify continuation — the
 * runner already restored RAC + conversations from session, and generate's
 * entry hook will append the user's answer to NODE_GENERATE.
 */
function routeAfterPlannerResolve(state: PlanGraphState): string {
  if (state.isResume && state.awaitingClarify && state.overrideDirective) {
    console.log('[PlannerResolveRouter] awaitingClarify continuation → generate (skip triage/detect)');
    return 'generate';
  }
  return 'triage';
}

/**
 * Route after triage for planner agent.
 * Proceeds to 'detect' for mode detection + RAC creation before generate.
 */
function routeAfterPlannerTriage(state: PlanGraphState): string {
  const result = state.triageResult;
  
  if (!result) {
    console.log('[PlannerTriageRouter] No triage result, proceeding to detect');
    return 'detect';
  }
  
  if (result.intent === 'ask') {
    console.log('[PlannerTriageRouter] ask intent → __end__');
    return '__end__';
  }
  
  if (result.workStatus === 'proceed') {
    console.log('[PlannerTriageRouter] work:proceed → detect');
    return 'detect';
  }
  
  if (result.workStatus === 'redirect') {
    console.log('[PlannerTriageRouter] work:redirect → __end__ (await choice)');
    return '__end__';
  }
  
  if (result.workStatus === 'blocked') {
    console.log('[PlannerTriageRouter] work:blocked → __end__');
    return '__end__';
  }
  
  console.log('[PlannerTriageRouter] default → detect');
  return 'detect';
}

export function buildPlanGraph() {
  const graph = new StateGraph(PlanAnnotation);
  
  // Add nodes (no separate write node — generate handles everything like design job's docGen)
  graph.addNode('resolve', createResolveNode(planResolveStrategy) as any);
  graph.addNode('triage', triage as any);
  graph.addNode('detect', createDetectNode(planDetectStrategy) as any);
  graph.addNode('generate', withPhaseTracking('generate', generateNode) as any);
  graph.addNode('tool', toolNode as any);
  
  // Edges: resolve → (triage | generate) → detect → generate → ... → END
  graph.addEdge('__start__' as any, 'resolve' as any);

  // After resolve: triage by default; clarify continuation skips to generate.
  graph.addConditionalEdges(
    'resolve' as any,
    routeAfterPlannerResolve as any,
    {
      triage: 'triage',
      generate: 'generate',
    } as any
  );

  graph.addConditionalEdges(
    'triage' as any,
    routeAfterPlannerTriage as any,
    {
      detect: 'detect',
      __end__: END,
    } as any
  );
  graph.addEdge('detect' as any, 'generate' as any);
  graph.addConditionalEdges(
    'generate' as any,
    routeAfterGenerate as any,
    {
      tool: 'tool',
      __end__: END,
    } as any
  );
  graph.addEdge('tool' as any, 'generate' as any);  // ReAct loop
  
  return graph.compile();
}
