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

import { Annotation, StateGraph } from '@langchain/langgraph';
import type { DesignGraphState } from '../state';
import { DesignGraphChannels } from '../graph';
import { plan } from '../nodes/plan';
import { docGen } from '../nodes/docGen/index';
import { tool } from '../nodes/tool';
import path from 'node:path';
import { learn } from '../nodes/learn';
import type { WorkerGraphBuilder } from '../../../../common/graph/parallelTypes';
import { routeAfterDocGen } from '../routers/docGenRouter';
import { routeAfterPlan, routeAfterTool } from '../routing';
import { FigmaMCPConnectionError } from '../../../../../periphery/adapters/figma/errors';
import { withPhaseTracking } from '../../../../common/graph/llmHelpers';
import { designDirOf } from '@ant/shared';
import { getExecutionLogger } from '../../../../../core/utils/executionLogger';

const INTERNAL_MARKER_RE = /\n?<!-- (?:SECTION_PATTERN|LAST_SECTION)[^>]*-->\s*/g;

/**
 * Check task status within a design worker subgraph.
 *
 * Validation gates (parity with code job checkTaskStatus):
 * 0.   _isStopRequested → return without completing (user-initiated stop)
 * 1.   _figmaConnectionLost → throw FigmaMCPConnectionError (global interrupt)
 * 2.   fileErrors → throw (incomplete file operations detected)
 * 3.   Normal completion → mark task as completed
 *
 * Note: the historical "Gate 1: Call budget exhausted" was retired along with
 * the code job's Safety Net D/E. Runaway docGen loops are bounded by LangGraph
 * `recursionLimit`; non-productive streaks are signaled to the LLM via the
 * advisory warnings in `nodes/docGen/index.ts`.
 */
async function workerCheckTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (per-worker, track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const workerId = state.workerId ?? 0;
  
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
  const isStopRequested = typeof state._isStopRequested === 'function'
    ? state._isStopRequested()
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
  // Gate 1: Figma MCP connection lost — global interrupt via TaskOrchestrator
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

    const taskTokenUsage = getTaskTokenUsage(state);
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);

    if (taskTokenUsage) {
      accumulateTokenUsage(state, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }

    console.log(`✅ [Worker] Design task "${completedTask.name}" completed!`);

    // Log task_complete to debug/logs/ (inside workerGraph where state._docGenCallIndex is accessible)
    if (state.context?.featurePath && state._httpJobId) {
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
        llmCallCount: completedTask.tokenUsage?.callCount ?? state._docGenCallIndex ?? 0,
      }).catch(() => {});
    }

    // Strip internal markers from output file when last chapter for a document completes
    const taskForMarkers = state.currentTask as any;
    if (taskForMarkers?.isLastTaskForDocument && taskForMarkers?.targetFile && state.deps?.fileSystem && state.context?.featurePath) {
      try {
        const dir = taskForMarkers.targetDir ?? designDirOf(taskForMarkers.targetFile);
        const filePath = path.join(state.context.featurePath, dir, taskForMarkers.targetFile);
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
      conversations: {},
      files: [],
      fileErrors: undefined,
      tokenUsage: state.tokenUsage,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
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

const DesignWorkerSubgraphAnnotation = Annotation.Root({
  // Inherit ALL channels from main graph (SSOT — no manual sync needed)
  ...DesignGraphChannels,

  // Worker-only fields (not in main graph)
  prd: Annotation<any>,
  design: Annotation<any>,
  sourceDocuments: Annotation<any>,
  _allTasksSummary: Annotation<any>,
  _taskCompleted: Annotation<any>,
});

/**
 * Build a design worker subgraph.
 *
 * @param _includeInstallValidate - Ignored for design tasks (API compat only)
 */
function buildDesignWorkerSubgraph(_includeInstallValidate: boolean) {
  const graph = new StateGraph(DesignWorkerSubgraphAnnotation);

  // Register nodes
  graph.addNode('plan', withPhaseTracking('plan', plan) as any);
  graph.addNode('docGen', withPhaseTracking('docGen', docGen) as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('learn', workerLearn as any);

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);

  // plan routing (tool-loop / sealed-plan handoff to docGen)
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', docGen: 'docGen' } as any,
  );

  // docGen routing (tool call / done / retry — with call budget safety net)
  graph.addConditionalEdges(
    'docGen' as any,
    routeAfterDocGen as any,
    { tool: 'tool', checkTaskStatus: 'checkTaskStatus', docGen: 'docGen' } as any,
  );

  // tool routing (plan↔tool / docGen↔tool dispatched via _activePhase)
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', docGen: 'docGen' } as any,
  );

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
