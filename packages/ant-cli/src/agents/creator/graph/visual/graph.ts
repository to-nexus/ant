/**
 * Visual Job Graph
 *
 * LangGraph StateGraph for the visual job.
 *
 * Flow:
 *   __start__ → resolve → triage → (conditional)
 *     triage:proceed → direct → (conditional)
 *       direct:sketch  → sketch  → (conditional: deliver | direct)
 *       direct:render  → render  → (conditional: deliver | direct)
 *       direct:engrave → engrave → (conditional: deliver | __end__)
 *       direct:clarify → __end__
 *       direct:end     → __end__
 *     triage:ask/redirect/blocked → __end__
 *
 *   sketch → deliver → __end__ (drafts saved, await user selection)
 *   render → deliver → __end__ (final image saved)
 *   engrave → deliver → __end__ (SVG saved)
 *
 * Safety blocked in sketch/render → loops back to direct for prompt revision.
 */

import { StateGraph, END } from '@langchain/langgraph';
import { RunVisualGraphParams, VisualGraphState } from './types.js';
import { resolveNode } from './nodes/resolve.js';
import { classifyNode } from './nodes/classify.js';
import { directNode, routeAfterDirect } from './nodes/direct.js';
import { sketchNode, routeAfterSketch } from './nodes/sketch.js';
import { renderNode, routeAfterRender } from './nodes/render.js';
import { engraveNode, routeAfterEngrave } from './nodes/engrave.js';
import { deliverNode } from './nodes/deliver.js';
import { triage } from '../../../common/nodes/triage/index.js';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import { JobTimingManager } from '../../../common/graph/timing/JobTimingManager.js';
import type { JobTiming } from '../../../common/graph/timing/JobTimingManager.js';

/**
 * Router after triage for visual job.
 * Proceeds to 'direct' instead of architect's 'detectEnvironment'.
 */
function routeAfterVisualTriage(state: VisualGraphState): string {
  const result = state.triageResult;

  if (!result) {
    if (state.draftIntent === 'finalize' || state.draftIntent === 'regenerate') {
      console.log(`[VisualTriageRouter] No triage + draftIntent=${state.draftIntent} → direct (skip classify)`);
      return 'direct';
    }
    console.log('[VisualTriageRouter] No triage result → classify');
    return 'classify';
  }

  if (result.intent === 'ask') {
    console.log('[VisualTriageRouter] ask → __end__');
    return '__end__';
  }

  if (result.workStatus === 'proceed') {
    if (state.draftIntent === 'finalize' || state.draftIntent === 'regenerate') {
      console.log(`[VisualTriageRouter] proceed + draftIntent=${state.draftIntent} → direct (skip classify)`);
      return 'direct';
    }
    console.log('[VisualTriageRouter] proceed → classify');
    return 'classify';
  }

  if (result.workStatus === 'redirect') {
    console.log('[VisualTriageRouter] redirect → __end__');
    return '__end__';
  }

  if (result.workStatus === 'blocked') {
    console.log('[VisualTriageRouter] blocked → __end__');
    return '__end__';
  }

  if (state.draftIntent === 'finalize' || state.draftIntent === 'regenerate') {
    console.log(`[VisualTriageRouter] default + draftIntent=${state.draftIntent} → direct (skip classify)`);
    return 'direct';
  }

  console.log('[VisualTriageRouter] default → classify');
  return 'classify';
}

export function buildVisualGraph() {
  const graph = new StateGraph<VisualGraphState>({
    channels: {
      // TriageableState fields
      featurePath: null as any,
      context: null as any,
      directive: null as any,
      deps: null as any,
      _httpJobId: null as any,
      tokenUsage: null as any,
      skipTriage: null as any,
      triageResult: null as any,
      workspaceState: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      overrideDirective: null as any,
      chatSource: null as any,

      // Visual-specific state
      conversation: null as any,
      engineeredPrompt: null as any,
      draftImages: null as any,
      svgDrafts: null as any,
      selectedDraftIndex: null as any,
      finalImage: null as any,
      outputPath: null as any,

      // Asset classification & job mode
      assetType: null as any,
      jobMode: null as any,

      // Session carry-over
      lastEngineeredPrompt: null as any,
      lastOutputPath: null as any,

      // LLM-resolved parameters
      resolvedAspectRatio: null as any,
      availableDraftPaths: null as any,

      // Clarify counter
      clarifyCount: null as any,

      // Draft selection intent
      draftIntent: null as any,
      isDraftFeedback: null as any,

      // Control flow
      routeDecision: null as any,
      needsSketches: null as any,
      isSvgRequest: null as any,

      // Error handling
      visualError: null as any,
      safetyBlocked: null as any,

      // Settings
      visualSettings: null as any,

      // Session & timing
      isResume: null as any,
      _phaseTimings: null as any,
      _uiLocale: null as any,

      // TriageableState compat
      pendingToolCalls: null as any,
    },
  });

  // Add nodes
  graph.addNode('resolve', resolveNode as any);
  graph.addNode('triage', triage as any);
  graph.addNode('classify', classifyNode as any);
  graph.addNode('direct', directNode as any);
  graph.addNode('sketch', sketchNode as any);
  graph.addNode('render', renderNode as any);
  graph.addNode('engrave', engraveNode as any);
  graph.addNode('deliver', deliverNode as any);

  // Fixed edges
  graph.addEdge('__start__' as any, 'resolve' as any);
  graph.addEdge('resolve' as any, 'triage' as any);

  // Triage → classify | direct (skip classify for deterministic intents) | __end__
  graph.addConditionalEdges(
    'triage' as any,
    routeAfterVisualTriage as any,
    {
      classify: 'classify',
      direct: 'direct',
      __end__: END,
    } as any
  );

  // Classify → direct (always)
  graph.addEdge('classify' as any, 'direct' as any);

  // Direct → sketch | render | engrave | __end__
  graph.addConditionalEdges(
    'direct' as any,
    routeAfterDirect as any,
    {
      sketch: 'sketch',
      render: 'render',
      engrave: 'engrave',
      __end__: END,
    } as any
  );

  // Sketch → deliver | direct (safety retry) | __end__
  graph.addConditionalEdges(
    'sketch' as any,
    routeAfterSketch as any,
    {
      deliver: 'deliver',
      direct: 'direct',
      __end__: END,
    } as any
  );

  // Render → deliver | direct (safety retry) | __end__
  graph.addConditionalEdges(
    'render' as any,
    routeAfterRender as any,
    {
      deliver: 'deliver',
      direct: 'direct',
      __end__: END,
    } as any
  );

  // Engrave → deliver | __end__
  graph.addConditionalEdges(
    'engrave' as any,
    routeAfterEngrave as any,
    {
      deliver: 'deliver',
      __end__: END,
    } as any
  );

  // Deliver always ends
  graph.addEdge('deliver' as any, '__end__' as any);

  return graph.compile();
}

/**
 * Run the visual job graph.
 */
export async function runVisualGraph(params: RunVisualGraphParams): Promise<any> {
  const { directive, featurePath, deps, _httpJobId, visualSettings, isResume, chatSource, skipTriage } = params;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎨 CREATOR AGENT - Visual');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`📝 Directive: ${directive?.substring(0, 100)}${(directive?.length || 0) > 100 ? '...' : ''}`);
  console.log(`📁 Feature: ${featurePath}`);
  console.log(`🆔 Job ID: ${_httpJobId || 'none'}\n`);

  const graph = buildVisualGraph();

  // Initialize JobTiming for kanban elapsed time badge (planner pattern)
  const kanbanUpdate = deps.kanbanUpdate;
  let jobTimingRef: JobTiming | undefined;

  if (_httpJobId && kanbanUpdate?.setJobTiming) {
    const { jobTiming } = JobTimingManager.initializeNewJob(_httpJobId);
    jobTimingRef = jobTiming;
    kanbanUpdate.setJobTiming(jobTiming);

    if (kanbanUpdate.updateTaskQueue) {
      kanbanUpdate.updateTaskQueue(
        _httpJobId,
        null,
        [],
        [],
        0,
        parseInt(process.env.RECURSION_LIMIT || '50', 10),
      );
    }
  }

  const initialState: VisualGraphState = {
    featurePath,
    context: { featurePath },
    directive,
    deps,
    _httpJobId,
    tokenUsage: undefined,
    skipTriage,
    triageResult: undefined,
    workspaceState: undefined,
    currentAgent: 'creator',
    currentJob: 'visual',
    overrideDirective: directive,
    chatSource,

    conversation: [],
    engineeredPrompt: undefined,
    draftImages: undefined,
    svgDrafts: undefined,
    selectedDraftIndex: undefined,
    finalImage: undefined,
    outputPath: undefined,

    resolvedAspectRatio: undefined,
    availableDraftPaths: undefined,

    clarifyCount: 0,

    routeDecision: undefined,
    needsSketches: undefined,
    isSvgRequest: undefined,

    visualError: undefined,
    safetyBlocked: false,

    visualSettings,

    isResume,
    _phaseTimings: {},
    _uiLocale: /[가-힣]/.test(directive || '') ? 'ko' : 'en',

    pendingToolCalls: [],
  };

  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '50', 10);

  const chatAPI = getChatAPIClient();
  let finalState: VisualGraphState;

  try {
    finalState = await (graph as any).invoke(initialState as any, {
      recursionLimit,
    }) as VisualGraphState;
  } catch (error: any) {
    console.error(`❌ [Visual] Graph execution failed: ${error.message}`);

    if (jobTimingRef && kanbanUpdate?.setJobTiming) {
      jobTimingRef = JobTimingManager.completeJob(jobTimingRef)!;
      kanbanUpdate.setJobTiming(jobTimingRef);
    }

    if (chatAPI.hasActiveMessage()) {
      try {
        await chatAPI.finalizeMessage(true);
      } catch (cleanupError) {
        console.warn('⚠️ [Visual] Failed to cleanup message:', cleanupError);
      }
    }

    throw error;
  }

  if (chatAPI.hasActiveMessage()) {
    await chatAPI.finalizeMessage();
  }

  // Surface visualError to user via chat if graph completed with an error state
  if (finalState.visualError) {
    try {
      await chatAPI.startMessage();
      await chatAPI.sendLLMEvent({
        type: 'text',
        text: `⚠️ ${finalState.visualError}`,
      });
      await chatAPI.finalizeMessage();
    } catch (err: any) {
      console.warn('⚠️ [Visual] Failed to send error message:', err.message);
    }
  }

  // Stop elapsed time badge
  if (jobTimingRef && kanbanUpdate?.setJobTiming) {
    jobTimingRef = JobTimingManager.completeJob(jobTimingRef)!;
    kanbanUpdate.setJobTiming(jobTimingRef);
  }

  // Save session
  if (deps.session && featurePath) {
    try {
      const projectId = deps.session.projectId || process.env.ANT_PROJECT_ID || 'default';
      const featureName = deps.session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';

      await deps.session.updateArtifacts(projectId, featureName, 'visual', {
        state: {
          conversation: finalState.conversation,
          directive: finalState.directive,
          tokenUsage: finalState.tokenUsage,
          jobId: _httpJobId,
          lastEngineeredPrompt: finalState.lastEngineeredPrompt,
          lastOutputPath: finalState.lastOutputPath,
          assetType: finalState.assetType,
        },
      });
      console.log(`💾 [Visual] Session saved (${finalState.conversation?.length || 0} conversation entries)`);

      if (deps.fileTreeUpdate) {
        deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
        await new Promise(r => setTimeout(r, 500));
        console.log(`🌲 [Visual] Final fileTree notification sent`);
      }
    } catch (err) {
      console.warn('⚠️ [Visual] Failed to save session:', err);
    }
  }

  console.log('\n✅ Creator Agent (Visual) completed');
  console.log(`   Output: ${finalState.outputPath || 'none'}`);

  return {
    status: 'completed',
    outputPath: finalState.outputPath,
    tokenUsage: finalState.tokenUsage,
  };
}
