/**
 * Plan LangGraph
 * 
 * All runs:  __start__ → resolve → triage → (conditional) → detect → generate ⟷ tool → END
 * 
 * Triage branches:  ask → __end__, redirect → __end__, blocked → __end__, proceed → detect
 * 
 * Triage always runs — even for conversation continuations — so the system can
 * detect agent/job switches (e.g., user requests code work mid-planner session).
 * 
 * generate handles: LLM streaming → file card (via StreamOrchestrator) → disk write → choice card → session
 * No separate write node — same pattern as design job's docGen.
 */

import { Annotation, StateGraph, END } from '@langchain/langgraph';
import { PlanGraphState } from './state';
import { planResolveStrategy } from './nodes/resolve';
import { createResolveNode } from '../../../common/nodes/resolve';
import { generateNode, routeAfterGenerate } from './nodes/generate';
import { toolNode } from './nodes/tool';
import { triage } from '../../../common/nodes/triage';
import { createDetectNode } from '../../../common/nodes/detect/index.js';
import { planDetectStrategy } from './nodes/detectStrategy.js';

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

const PlanAnnotation = Annotation.Root({
  directive: Annotation<any>,
  language: Annotation<any>,
  workspaceState: Annotation<any>,
  featurePath: Annotation<any>,
  isResume: Annotation<any>,
  evalReport: Annotation<any>,
  rubricContent: Annotation<any>,
  recentTurnSummaries: Annotation<any>,
  conversation: Annotation<any>,
  isConversationContinuation: Annotation<any>,
  conversationHistory: Annotation<any>,
  pendingToolCalls: Annotation<any>,
  resolvedAction: Annotation<any>,
  resolvedArtifacts: Annotation<any>,
  context: Annotation<any>,
  triageResult: Annotation<any>,
  skipTriage: Annotation<any>,
  actionMetadata: Annotation<any>,
  currentAgent: Annotation<any>,
  currentJob: Annotation<any>,
  overrideDirective: Annotation<any>,
  chatSource: Annotation<any>,
  _uiLocale: Annotation<any>,
  _phaseTimings: Annotation<any>,
  deps: Annotation<any>,
  _httpJobId: Annotation<any>,
  tokenUsage: Annotation<any>,
  phaseTokenUsages: Annotation<any>,
  recursionCount: Annotation<any>,
  recursionLimit: Annotation<any>,
});

export function buildPlanGraph() {
  const graph = new StateGraph(PlanAnnotation);
  
  // Add nodes (no separate write node — generate handles everything like design job's docGen)
  graph.addNode('resolve', createResolveNode(planResolveStrategy) as any);
  graph.addNode('triage', triage as any);
  graph.addNode('detect', createDetectNode(planDetectStrategy) as any);
  graph.addNode('generate', generateNode as any);
  graph.addNode('tool', toolNode as any);
  
  // Edges: resolve → triage → (conditional) → detect → generate → ... → END
  graph.addEdge('__start__' as any, 'resolve' as any);
  
  // After resolve: always run triage (detects agent/job switches even in continuations)
  graph.addEdge('resolve' as any, 'triage' as any);
  
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
