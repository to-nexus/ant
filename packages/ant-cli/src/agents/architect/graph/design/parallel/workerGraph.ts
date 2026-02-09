/**
 * Design Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single design task execution
 * within a TaskWorker. This is a lighter version of the main design
 * graph that handles only the task execution lifecycle.
 *
 * Flow: plan → docGen ↔ tool → workerCheckTaskStatus → workerLearn → END
 *
 * Design tasks don't have installDeps/runtimeValidate or enforce nodes.
 * The includeInstallValidate parameter is accepted for API compatibility
 * with WorkerGraphBuilder but has no effect for design tasks.
 */

import { StateGraph } from '@langchain/langgraph';
import type { DesignGraphState } from '../state';
import { plan } from '../nodes/plan';
import { docGen } from '../nodes/docGen/index';
import { tool } from '../nodes/tool';
import { learn } from '../nodes/learn';
import type { WorkerGraphBuilder } from '../../code/parallel/types';

/**
 * Check task status within a design worker subgraph.
 * Lighter version — doesn't pop next task or save global checkpoint.
 */
async function workerCheckTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = (state as any).workerId ?? 0;
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'checkTaskStatus', workerId, taskInfo);
  }

  if (state.currentTask) {
    const { TaskTimingHelper } = await import('../../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../common/llmHelpers');

    const taskTokenUsage = getTaskTokenUsage(state as any);
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);

    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }

    console.log(`✅ [Worker] Design task "${completedTask.name}" completed!`);

    // Workflow exit (await to ensure broadcast completes before next node's enterNode)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      const workerId = (state as any).workerId ?? 0;
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      planText: '',
      conversationHistory: [],
      files: [],
      tokenUsage: (state as any).tokenUsage,
    } as any;
  }

  // Workflow exit (await to ensure broadcast completes before next node's enterNode)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = (state as any).workerId ?? 0;
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
      isResume: null as any,
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

  // docGen routing (tool call / done / retry)
  graph.addConditionalEdges(
    'docGen' as any,
    ((s: DesignGraphState) => {
      const toolCalls = s.llmResponse?.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        return 'tool';
      }
      const isDone = s.llmResponse?.done === true;
      if (isDone) {
        return 'checkTaskStatus';
      }
      console.warn(`⚠️  [Worker Graph] No tool calls and done=${s.llmResponse?.done} - retrying docGen`);
      return 'docGen';
    }) as any,
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
