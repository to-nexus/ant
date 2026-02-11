/**
 * Plan LangGraph
 * 
 * Fresh run:        __start__ → resolve → triage → (conditional) → generate ⟷ tool → END
 * Conversation continuation: __start__ → resolve → generate ⟷ tool → END  (triage skipped)
 * 
 * Triage branches:  ask → __end__, redirect → __end__, blocked → __end__, proceed → generate
 * 
 * When a conversation already exists (isConversationContinuation), resolve routes
 * directly to generate — the user already chose this agent/job via the continue endpoint.
 * 
 * generate handles: LLM streaming → file card (via StreamOrchestrator) → disk write → choice card → session
 * No separate write node — same pattern as design job's docGen.
 */

import { StateGraph, END } from '@langchain/langgraph';
import { PlanGraphState } from './state';
import { resolveNode } from './nodes/resolve';
import { generateNode, routeAfterGenerate } from './nodes/generate';
import { toolNode } from './nodes/tool';
import { triage } from '../../../common/nodes/triage';

/**
 * Route after resolve: skip triage for conversation continuations.
 * When the user continues an existing plan conversation (via /jobs/:id/continue),
 * triage is unnecessary — the agent/job routing is already decided.
 */
function routeAfterResolve(state: PlanGraphState): string {
  if (state.isConversationContinuation) {
    console.log('[PlannerResolveRouter] Conversation continuation → generate (skip triage)');
    return 'generate';
  }
  console.log('[PlannerResolveRouter] Fresh run → triage');
  return 'triage';
}

/**
 * Route after triage for planner agent.
 * Proceeds to 'generate' instead of architect's 'detectEnvironment'.
 */
function routeAfterPlannerTriage(state: PlanGraphState): string {
  const result = state.triageResult;
  
  if (!result) {
    console.log('[PlannerTriageRouter] No triage result, proceeding to generate');
    return 'generate';
  }
  
  if (result.intent === 'ask') {
    console.log('[PlannerTriageRouter] ask intent → __end__');
    return '__end__';
  }
  
  if (result.workStatus === 'proceed') {
    console.log('[PlannerTriageRouter] work:proceed → generate');
    return 'generate';
  }
  
  if (result.workStatus === 'redirect') {
    console.log('[PlannerTriageRouter] work:redirect → __end__ (await choice)');
    return '__end__';
  }
  
  if (result.workStatus === 'blocked') {
    console.log('[PlannerTriageRouter] work:blocked → __end__');
    return '__end__';
  }
  
  console.log('[PlannerTriageRouter] default → generate');
  return 'generate';
}

export function buildPlanGraph() {
  const graph = new StateGraph<PlanGraphState>({
    channels: {
      directive: null as any,
      language: null as any,
      workspaceState: null as any,
      featurePath: null as any,
      mode: null as any,
      isResume: null as any,
      existingDocument: null as any,
      evalReport: null as any,
      rubricContent: null as any,
      recentTurnSummaries: null as any,
      conversation: null as any,
      isConversationContinuation: null as any,
      conversationHistory: null as any,
      pendingToolCall: null as any,
      generatedDocument: null as any,
      // TriageableState fields
      context: null as any,
      triageResult: null as any,
      skipTriage: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      overrideDirective: null as any,
      chatSource: null as any,
      // UI locale
      _uiLocale: null as any,
      // Dependencies
      deps: null as any,
      _httpJobId: null as any,
      tokenUsage: null as any,
      recursionCount: null as any,
      recursionLimit: null as any,
    },
  });
  
  // Add nodes (no separate write node — generate handles everything like design job's docGen)
  graph.addNode('resolve', resolveNode as any);
  graph.addNode('triage', triage as any);
  graph.addNode('generate', generateNode as any);
  graph.addNode('tool', toolNode as any);
  
  // Edges: resolve → [conditional] → triage or generate → ... → END
  graph.addEdge('__start__' as any, 'resolve' as any);
  
  // After resolve: skip triage if continuing an existing conversation
  graph.addConditionalEdges(
    'resolve' as any,
    routeAfterResolve as any,
    {
      triage: 'triage',
      generate: 'generate',
    } as any
  );
  
  graph.addConditionalEdges(
    'triage' as any,
    routeAfterPlannerTriage as any,
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
