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
import { triage, routeAfterTriage } from '../../../common/graph/nodes/triage';
import { createInferDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { augmentPlanExecutionTier } from './nodes/detect/augmentExecutionTier.js';
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
 * Phase D — route after detect for planner-plan.
 * `proceed` continues to `generate` (plan job uses detect as its tier
 * entry; there is no decompose node). `blocked` / `redirect-suggested`
 * → __end__ so the FE renders the choice card detect already emitted.
 */
function routeAfterPlannerDetect(state: PlanGraphState): string {
  const detect = (state as any).detect as { status?: string } | undefined;
  if (!detect) {
    if (state.resolvedAction) {
      console.log('[PlannerDetectRouter] No detect channel but resolvedAction present → generate');
      return 'generate';
    }
    console.log('[PlannerDetectRouter] No detect channel → __end__');
    return '__end__';
  }
  if (detect.status === 'proceed') {
    console.log('[PlannerDetectRouter] status=proceed → generate');
    return 'generate';
  }
  console.log(`[PlannerDetectRouter] status=${detect.status} → __end__`);
  return '__end__';
}

export function buildPlanGraph() {
  const graph = new StateGraph(PlanAnnotation);
  
  // Add nodes (no separate write node — generate handles everything like design job's docGen)
  graph.addNode('resolve', createResolveNode(planResolveStrategy) as any);
  graph.addNode('triage', triage as any);
  graph.addNode('detect', createInferDetectNode(augmentPlanExecutionTier) as any);
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

  // Phase D — ask externalised, work continues to detect. Plan has no
  // `revise` node, so the resume-queue branch in the shared
  // routeAfterTriage falls through to `detect` (the `revise` label is
  // remapped to the same node here).
  graph.addConditionalEdges(
    'triage' as any,
    routeAfterTriage as any,
    {
      detect: 'detect',
      revise: 'detect',
      __end__: END,
    } as any
  );

  // Phase D — detect routes to generate on proceed (plan job uses detect
  // as its tier entry; no decompose node).
  graph.addConditionalEdges(
    'detect' as any,
    routeAfterPlannerDetect as any,
    {
      generate: 'generate',
      __end__: END,
    } as any
  );
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
