/**
 * Visual Graph Runner
 *
 * Entry point for running the Visual LangGraph.
 * Extracted from graph.ts — graph.ts is now topology-only.
 */

import { buildVisualGraph } from './graph.js';
import { RunVisualGraphParams, VisualGraphState } from './types.js';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import { loadRecursionLimit, cleanupChat, invokeGraph } from '../../../common/graph/runnerHelpers.js';
import { applyCompactionToConversation } from '../../../../core/context/compactJob.js';
import { CONV_KEYS, getConv } from '../../../common/graph/conversations.js';
import { JobTimingManager } from '../../../common/graph/timing/JobTimingManager.js';
import type { ConversationEntry } from '../../../../core/types/session.js';
import type { ConversationMessage } from '../../../common/graph/conversations.js';
import type { JobTiming } from '../../../common/graph/timing/JobTimingManager.js';

/**
 * Run the visual job graph.
 */
export async function runVisualGraph(params: RunVisualGraphParams): Promise<any> {
  const { directive, featurePath, deps, _httpJobId, visualSettings, isResume, chatSource, skipTriage, actionMetadata } = params;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎨 CREATOR AGENT - Visual');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`📝 Directive: ${directive?.substring(0, 100)}${(directive?.length || 0) > 100 ? '...' : ''}`);
  console.log(`📁 Feature: ${featurePath}`);
  console.log(`🆔 Job ID: ${_httpJobId || 'none'}\n`);

  const graph = buildVisualGraph();
  const recursionLimit = loadRecursionLimit(50);

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
        recursionLimit,
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
    actionMetadata,

    conversations: {},
    engineeredPrompt: undefined,
    sketchImages: undefined,
    svgSketches: undefined,
    selectedSketchIndex: undefined,
    finalImage: undefined,
    outputPath: undefined,

    resolvedAspectRatio: undefined,
    availableSketchPaths: undefined,

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

  const chatAPI = getChatAPIClient();
  let finalState: VisualGraphState;

  try {
    finalState = await invokeGraph(graph, initialState, recursionLimit);
  } catch (error: any) {
    console.error(`❌ [Visual] Graph execution failed: ${error.message}`);

    if (jobTimingRef && kanbanUpdate?.setJobTiming) {
      jobTimingRef = JobTimingManager.completeJob(jobTimingRef)!;
      kanbanUpdate.setJobTiming(jobTimingRef);
    }

    await cleanupChat(true);

    throw error;
  }

  if (chatAPI.hasActiveMessage()) {
    await chatAPI.finalizeMessage();
  }

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

  if (jobTimingRef && kanbanUpdate?.setJobTiming) {
    jobTimingRef = JobTimingManager.completeJob(jobTimingRef)!;
    kanbanUpdate.setJobTiming(jobTimingRef);
  }

  if (deps.session && featurePath) {
    try {
      const projectId = deps.session.projectId || process.env.ANT_PROJECT_ID || 'default';
      const featureName = deps.session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';

      const sessionMain = getConv(finalState.conversations, CONV_KEYS.SESSION_MAIN);
      const prunedConversation = applyCompactionToConversation(
        sessionMain as any,
        finalState._conversationCompaction,
        (summary) => ({
          role: 'system' as const,
          content: summary,
          timestamp: new Date().toISOString(),
          metadata: { chapterSummary: 'Conversation history summary' },
        }),
      );

      await deps.session.updateArtifacts(projectId, featureName, 'visual', {
        state: {
          conversations: { [CONV_KEYS.SESSION_MAIN]: prunedConversation },
          conversation: prunedConversation,
          directive: finalState.directive,
          tokenUsage: finalState.tokenUsage,
          jobTiming: jobTimingRef,
          jobId: _httpJobId,
          lastEngineeredPrompt: finalState.lastEngineeredPrompt,
          lastOutputPath: finalState.lastOutputPath,
          assetType: finalState.assetType,
          jobMode: finalState.jobMode,
          availableSketchPaths: finalState.availableSketchPaths,
          basePrompt: finalState.basePrompt,
          sketchVariations: finalState.sketchVariations,
        },
      });
      console.log(`💾 [Visual] Session saved (${prunedConversation.length} conversation entries, was ${sessionMain.length})`);

      if (deps.fileTreeUpdate) {
        deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
        await new Promise(r => setTimeout(r, 500));
        console.log(`🌲 [Visual] Final fileTree notification sent`);
      }
    } catch (err) {
      console.warn('⚠️ [Visual] Failed to save session:', err);
    }
  }

  if (_httpJobId && kanbanUpdate) {
    if (finalState.tokenUsage && kanbanUpdate.updateTokenUsage) {
      kanbanUpdate.updateTokenUsage(finalState.tokenUsage as any);
    }
    if (finalState.phaseTokenUsages && kanbanUpdate.updatePhaseTokenUsages) {
      kanbanUpdate.updatePhaseTokenUsages(finalState.phaseTokenUsages as any);
    }
    if (kanbanUpdate.updateTaskQueue) {
      kanbanUpdate.updateTaskQueue(
        _httpJobId,
        null,
        [],
        [],
        0,
        recursionLimit,
        finalState.tokenUsage as any,
      );
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
