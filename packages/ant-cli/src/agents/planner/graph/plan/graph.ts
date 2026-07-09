/**
 * Plan LangGraph
 *
 * Flow: __start__ → resolve → triage → detect → plan ⟷ tool → execute ⟷ tool → END
 *
 * Mirrors the design/code job authoring spine. The plan job has NO decompose
 * node (single document, no task fan-out) — the `plan` node absorbs its
 * clarify/scope role. `plan` OBSERVES + clarifies + seals a brief (in a
 * `<plan>` tag) and CLEARS its NODE_PLAN transcript; `execute` AUTHORS the
 * document from `directive + planText` on a fresh NODE_EXECUTE channel. That
 * transcript-severing boundary is what stops research momentum from drifting
 * the authoring turn (the codebase-audit-instead-of-PRD failure).
 *
 * Triage branches:  ask → __end__, redirect → __end__, blocked → __end__, proceed → detect.
 * Clarify-continuation short-circuit: when `isResume && awaitingClarify &&
 * overrideDirective` the runner has restored the prior RAC, so resolve routes
 * directly to `plan` (clarify lives in plan) without re-running triage/detect.
 */

import { StateGraph, END } from '@langchain/langgraph';
import { PlanAnnotation, PlanGraphState } from './state';
import { planResolveStrategy } from './nodes/resolve';
import { createResolveNode } from '../../../common/graph/nodes/resolve';
import { planNode, routeAfterPlan } from './nodes/plan';
import { executeNode, routeAfterExecute } from './nodes/execute';
import { toolNode } from './nodes/tool';
import { triage, routeAfterTriage } from '../../../common/graph/nodes/triage';
import { createInferDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { augmentPlanExecutionTier } from './nodes/detect/augmentExecutionTier.js';
import { withPhaseTracking } from '../../../common/graph/llmHelpers';

/**
 * Route after resolve. Short-circuits triage/detect when this is a clarify
 * continuation — the runner already restored RAC + conversations, and the
 * plan node's entry hook appends the user's answer to NODE_PLAN (clarify lives
 * in plan).
 */
function routeAfterPlannerResolve(state: PlanGraphState): string {
  if (state.isResume && state.awaitingClarify && state.overrideDirective) {
    console.log('[PlannerResolveRouter] awaitingClarify continuation → plan (skip triage/detect)');
    return 'plan';
  }
  return 'triage';
}

/**
 * Routes after detect. `state.resolvedAction` is the proceed signal — detect
 * populates it on success and leaves it unset on blocked / redirect-suggested.
 */
function routeAfterPlannerDetect(state: PlanGraphState): string {
  if (state.resolvedAction) {
    console.log('[PlannerDetectRouter] resolvedAction present → plan');
    return 'plan';
  }
  console.log('[PlannerDetectRouter] no resolvedAction → __end__');
  return '__end__';
}

/**
 * Dispatch back from the shared tool node to whichever loop set `_activePhase`
 * (mirrors design's routeAfterTool). Both loops share the one physical tool
 * node; the phase field decides plan↔tool vs execute↔tool.
 */
function routeAfterTool(state: PlanGraphState): string {
  return state._activePhase === 'execute' ? 'execute' : 'plan';
}

export function buildPlanGraph() {
  const graph = new StateGraph(PlanAnnotation);

  graph.addNode('resolve', createResolveNode(planResolveStrategy) as any);
  graph.addNode('triage', triage as any);
  graph.addNode('detect', createInferDetectNode(augmentPlanExecutionTier) as any);
  graph.addNode('plan', withPhaseTracking('plan', planNode) as any);
  graph.addNode('execute', withPhaseTracking('execute', executeNode, 'n') as any);
  graph.addNode('tool', toolNode as any);

  graph.addEdge('__start__' as any, 'resolve' as any);

  // After resolve: triage by default; clarify continuation skips to plan.
  graph.addConditionalEdges(
    'resolve' as any,
    routeAfterPlannerResolve as any,
    { triage: 'triage', plan: 'plan' } as any,
  );

  // Ask externalised; work continues to detect. Plan has no `revise` node, so
  // the shared routeAfterTriage `revise` label is remapped to `detect`.
  graph.addConditionalEdges(
    'triage' as any,
    routeAfterTriage as any,
    { detect: 'detect', revise: 'detect', __end__: END } as any,
  );

  // detect → plan on proceed (plan job uses detect as tier entry; no decompose).
  graph.addConditionalEdges(
    'detect' as any,
    routeAfterPlannerDetect as any,
    { plan: 'plan', __end__: END } as any,
  );

  // plan ⟷ tool; seal → execute; clarify paused / explain done → END.
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', execute: 'execute', __end__: END } as any,
  );

  // execute ⟷ tool; done → END.
  graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    { tool: 'tool', __end__: END } as any,
  );

  // tool → plan | execute (dispatch on _activePhase).
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', execute: 'execute' } as any,
  );

  return graph.compile();
}
