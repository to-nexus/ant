/**
 * Design Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single design task execution
 * within a TaskWorker. This is a lighter version of the main design
 * graph that handles only the task execution lifecycle.
 *
 * Flow: plan → docGen ↔ tool → workerCheckTaskStatus → workerLearn → END
 *
 * Design tasks don't have enforce nodes.
 * The includeInstallValidate parameter is accepted for API compatibility
 * with WorkerGraphBuilder but has no effect for design tasks.
 */

import { StateGraph } from '@langchain/langgraph';
import type { DesignGraphState } from '../state';
import { plan } from '../nodes/plan';
import { docGen } from '../nodes/docGen/index';
import { tool } from '../nodes/tool';
import path from 'node:path';
import { learn } from '../nodes/learn';
import type { WorkerGraphBuilder } from '../../code/parallel/types';
import { routeAfterDocGen } from '../routers/docGenRouter';
import { FigmaMCPConnectionError } from '../../../../../periphery/adapters/figma/errors';
import { designSubdirOf } from '@ant/shared';

const INTERNAL_MARKER_RE = /\n?<!-- (?:SECTION_PATTERN|LAST_SECTION)[^>]*-->\s*/g;

/**
 * Check task status within a design worker subgraph.
 * 
 * Validation gates (parity with code job checkTaskStatus):
 * 1.   _callLimitReached → throw (TaskOrchestrator handles as failure)
 * 1.5. _figmaConnectionLost → throw FigmaMCPConnectionError (global interrupt)
 * 2.   fileErrors → throw (incomplete file operations detected)
 * 3.   Normal completion → mark task as completed
 */
async function workerCheckTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (per-worker, track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const workerId = (state as any).workerId ?? 0;
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'checkTaskStatus', workerId, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 0: User stop requested — do NOT mark task as completed
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const isStopRequested = typeof (state as any)._isStopRequested === 'function'
    ? (state as any)._isStopRequested()
    : false;

  if (isStopRequested) {
    console.log(`🛑 [Design Worker checkTaskStatus] User stop requested — NOT marking task as completed`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,
      violations: [],
    } as any;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 1: Call budget exhausted — fail task (not silently complete)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state._callLimitReached && state.currentTask) {
    const callIndex = state._docGenCallIndex || 0;
    console.error(`❌ [workerCheckTaskStatus] Call budget exhausted for "${state.currentTask.name}" (${callIndex} calls) — failing task`);
    
    // Preserve tool result cache on task object for retry — avoids re-reading same source docs
    if (state._toolResultCache) {
      (state.currentTask as any)._cachedToolResults = state._toolResultCache;
      const cacheSize = Object.keys(state._toolResultCache).length;
      console.log(`♻️  [workerCheckTaskStatus] Saved ${cacheSize} cached tool results for potential retry`);
    }
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    
    throw new Error(
      `Task "${state.currentTask.name}" exhausted call budget (${callIndex} calls) without producing valid output. ` +
      `This is a deterministic failure — the LLM could not generate the required document within the call limit.`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 1.5: Figma MCP connection lost — global interrupt via TaskOrchestrator
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state._figmaConnectionLost && state.currentTask) {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    throw new FigmaMCPConnectionError(
      `Figma MCP connection lost (${state._figmaConsecutiveErrors || 0} failures) for "${state.currentTask.name}"`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2: File operation errors — fail task
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.fileErrors && state.fileErrors.length > 0 && state.currentTask) {
    console.error(`❌ [workerCheckTaskStatus] ${state.fileErrors.length} file error(s) for "${state.currentTask.name}":`);
    for (const err of state.fileErrors) {
      console.error(`   - ${err.substring(0, 200)}`);
    }
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    
    throw new Error(
      `Task "${state.currentTask.name}" had ${state.fileErrors.length} file operation error(s): ${state.fileErrors[0].substring(0, 200)}`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Normal completion
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.currentTask) {
    const { TaskTimingHelper } = await import('../../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../../common/graph/llmHelpers');

    const taskTokenUsage = getTaskTokenUsage(state as any);
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);

    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }

    console.log(`✅ [Worker] Design task "${completedTask.name}" completed!`);

    // Log task_complete to debug/logs/ (inside workerGraph where state._docGenCallIndex is accessible)
    if (state.context?.featurePath && state._httpJobId) {
      const { getExecutionLogger } = await import('../../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'design',
      });
      execLogger.logTaskComplete(completedTask.id, {
        taskName: completedTask.name,
        elapsedMs: completedTask.timing?.elapsedTime || 0,
        inputTokens: completedTask.tokenUsage?.inputTokens || 0,
        outputTokens: completedTask.tokenUsage?.outputTokens || 0,
        cacheReadTokens: completedTask.tokenUsage?.cacheReadTokens || 0,
        cacheCreationTokens: completedTask.tokenUsage?.cacheCreationTokens || 0,
        llmCallCount: state._docGenCallIndex || 0,
      }).catch(() => {});
    }

    // Strip internal markers from output file when last chapter for a document completes
    const taskForMarkers = state.currentTask as any;
    if (taskForMarkers?.isLastTaskForDocument && taskForMarkers?.targetFile && state.deps?.fileSystem && state.context?.featurePath) {
      try {
        const subdir = designSubdirOf(taskForMarkers.targetFile);
        const filePath = path.join(state.context.featurePath, 'outputs', 'design', subdir, taskForMarkers.targetFile);
        const fs = state.deps.fileSystem as any;
        const content = await fs.readFile(filePath);
        const cleaned = (content as string).replace(INTERNAL_MARKER_RE, '');
        if (cleaned !== content) {
          await fs.writeFile(filePath, cleaned.trimEnd() + '\n');
          console.log(`🧹 [workerCheckTaskStatus] Stripped internal markers from ${taskForMarkers.targetFile}`);
        }
      } catch { /* File may not exist, ignore */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      planText: '',
      conversationHistory: [],
      files: [],
      fileErrors: undefined,
      tokenUsage: (state as any).tokenUsage,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
      _callLimitReached: false,
      _toolResultCache: undefined,
    } as any;
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
  }

  return { currentTask: undefined, _taskCompleted: false } as any;
}

/**
 * Lightweight learn node for design worker subgraph.
 */
async function workerLearn(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  return learn(state) as any;
}

/**
 * Build a design worker subgraph.
 *
 * @param _includeInstallValidate - Ignored for design tasks (API compat only)
 */
function buildDesignWorkerSubgraph(_includeInstallValidate: boolean) {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      context: null as any,
      workspaceConfig: null as any,
      deps: null as any,
      detectionReport: null as any,
      designError: null as any,
      prd: null as any,
      directive: null as any,
      design: null as any,
      taskQueue: null as any,
      currentTask: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      jobId: null as any,
      jobTiming: null as any,
      _currentTaskTokenUsage: null as any,
      tokenUsage: null as any,
      _estimatingTokenUsage: null as any,
      planText: null as any,
      files: null as any,
      filesToDelete: null as any,
      lessons: null as any,
      llmResponse: null as any,
      conversationHistory: null as any,
      _httpJobId: null as any,
      _phaseTimings: null as any,
      _uiLocale: null as any,
      overrideDirective: null as any,
      chatSource: null as any,
      skipTriage: null as any,
      triageResult: null as any,
      workspaceState: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      uiReferences: null as any,
      uiAssetsList: null as any,
      figmaConfig: null as any,
      uiDesignSource: null as any,
      figmaExplorationResult: null as any,
      isResume: null as any,
      existingDesignDocs: null as any,
      sourceDocuments: null as any,
      recursionCount: null as any,
      recursionLimit: null as any,
      interruption: null as any,
      awaitingDetectClarify: null as any,
      awaitingClarify: null as any,
      _docGenCallIndex: null as any,
      _noOutputCallCount: null as any,
      _callLimitReached: null as any,
      _toolResultCache: null as any,
      fileErrors: null as any,
      // Figma MCP connection health
      _figmaConsecutiveErrors: null as any,
      _figmaConnectionLost: null as any,
      // MECE: all sibling tasks for scope awareness
      _allTasksSummary: null as any,
      // Worker-specific
      workerId: null as any,
      _taskCompleted: null as any,
      _isStopRequested: null as any,
    } as any,
  } as any);

  // Register nodes
  graph.addNode('plan', plan as any);
  graph.addNode('docGen', docGen as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('learn', workerLearn as any);

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);
  graph.addEdge('plan' as any, 'docGen' as any);

  // docGen routing (tool call / done / retry — with call budget safety net)
  graph.addConditionalEdges(
    'docGen' as any,
    routeAfterDocGen as any,
    { tool: 'tool', checkTaskStatus: 'checkTaskStatus', docGen: 'docGen' } as any,
  );

  // Tool → docGen loop
  graph.addEdge('tool' as any, 'docGen' as any);

  // checkTaskStatus → learn (design tasks always succeed or error out at docGen level)
  graph.addEdge('checkTaskStatus' as any, 'learn' as any);

  // Learn → END
  graph.addEdge('learn' as any, '__end__' as any);

  return (graph as any).compile();
}

/**
 * Create a WorkerGraphBuilder for design job tasks.
 * This function is passed to TaskOrchestrator as the graphBuilder callback.
 */
export function createDesignWorkerGraphBuilder(): WorkerGraphBuilder {
  return (_includeInstallValidate: boolean) => {
    return buildDesignWorkerSubgraph(_includeInstallValidate);
  };
}
