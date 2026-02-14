/**
 * Code Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single code task execution within
 * a TaskWorker. This is a lighter version of the main code graph that
 * only handles the task execution lifecycle (plan → codeGen → tool loop).
 *
 * Two variants:
 * - Standard: plan → codeGen ↔ tool → checkTaskStatus → (enforce/workerLearn)
 * - With install/validate: adds installDeps → runtimeValidate before checkTaskStatus
 *   (used for exclusive tasks like final verification and error tasks)
 */

import { StateGraph, END } from '@langchain/langgraph';
import type { ArchitectGraphState, ViolationType } from '../state';
import { plan } from '../nodes/plan';
import { codeGen } from '../nodes/codeGen/index';
import { tool } from '../nodes/tool';
import { installDeps } from '../nodes/installDeps';
import { runtimeValidate } from '../nodes/runtimeValidate';
import { enforce } from '../nodes/enforce';
import { learn } from '../nodes/learn';
import { routeAfterCodeGen } from '../routers/codeGenRouter';
import type { WorkerGraphBuilder } from './types';

/**
 * Check task status within a worker subgraph.
 * Lighter version that doesn't pop next task or save global checkpoint.
 * The orchestrator handles task queue management externally.
 */
async function workerCheckTaskStatus(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  // Increment recursion count
  state.recursionCount = (state.recursionCount || 0) + 1;

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
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'checkTaskStatus',
      workerId,
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  // Convert fileErrors to violations (same logic as main graph)
  const violations = [...(state.violations || [])];
  if (state.fileErrors && state.fileErrors.length > 0) {
    console.log(`⚠️  [Worker checkTaskStatus] Converting ${state.fileErrors.length} file error(s) to violations`);
    for (const errorMsg of state.fileErrors) {
      const fileMatch = errorMsg.match(/File "([^"]+)"|file "([^"]+)"/);
      const filePath = fileMatch ? (fileMatch[1] || fileMatch[2]) : undefined;

      let violationType: ViolationType;
      let suggestedFix: string | undefined;

      if (errorMsg.includes('Cannot edit non-existing file') || errorMsg.includes('non-existing file')) {
        violationType = 'missing_file';
        suggestedFix = filePath ? `File does not exist. Use <file path="${filePath}"> to create it first.` : undefined;
      } else if (errorMsg.includes('Search block not found')) {
        violationType = 'file_operation_failed';
        suggestedFix = filePath
          ? `Search block outdated. Read the file again with read_file("${filePath}") and use EXACT current content.`
          : undefined;
      } else {
        violationType = 'file_operation_failed';
      }

      violations.push({
        type: violationType,
        message: errorMsg,
        severity: 'critical',
        file: filePath,
        isRetryable: true,
        suggestedFix,
      });
    }
  }

  const hasViolations = violations.length > 0;

  // Workflow exit (await to ensure broadcast completes before next node's enterNode)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = (state as any).workerId ?? 0;
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
  }

  if (!hasViolations && state.currentTask) {
    // Task succeeded — gather token usage
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../../common/graph/llmHelpers');

    const codeGenTokenUsage = state.llmResponse?.tokenUsage;
    const planTokenUsage = getTaskTokenUsage(state as any);

    let taskTokenUsage = state.currentTask.tokenUsage;
    if (codeGenTokenUsage) {
      if (taskTokenUsage) {
        taskTokenUsage.inputTokens += codeGenTokenUsage.inputTokens;
        taskTokenUsage.outputTokens += codeGenTokenUsage.outputTokens;
        taskTokenUsage.totalTokens += codeGenTokenUsage.totalTokens;
        taskTokenUsage.cacheReadTokens = (taskTokenUsage.cacheReadTokens || 0) + (codeGenTokenUsage.cacheReadTokens || 0);
        taskTokenUsage.cacheCreationTokens = (taskTokenUsage.cacheCreationTokens || 0) + (codeGenTokenUsage.cacheCreationTokens || 0);
      } else {
        taskTokenUsage = codeGenTokenUsage;
      }
    }
    if (planTokenUsage.totalTokens > 0) {
      if (taskTokenUsage) {
        taskTokenUsage.inputTokens += planTokenUsage.inputTokens;
        taskTokenUsage.outputTokens += planTokenUsage.outputTokens;
        taskTokenUsage.totalTokens += planTokenUsage.totalTokens;
        taskTokenUsage.cacheReadTokens = (taskTokenUsage.cacheReadTokens || 0) + (planTokenUsage.cacheReadTokens || 0);
        taskTokenUsage.cacheCreationTokens = (taskTokenUsage.cacheCreationTokens || 0) + (planTokenUsage.cacheCreationTokens || 0);
      } else {
        taskTokenUsage = planTokenUsage;
      }
    }
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }

    const { TaskTimingHelper } = await import('../state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    console.log(`✅ [Worker] Task "${completedTask.name}" completed!`);

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      retries: 0,
      violations: [],
      conversationHistory: [],
      planText: '',
      projectCodeContext: undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // Task has violations — propagate for enforce
  return {
    violations,
    _taskCompleted: false,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  } as any;
}

/**
 * Lightweight learn node for worker subgraph.
 * Extracts lessons from the completed task without global state management.
 */
async function workerLearn(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  // Delegate to the standard learn node (it already handles single-task learning)
  return learn(state) as any;
}

/**
 * Build a worker subgraph for code job tasks.
 *
 * @param includeInstallValidate - If true, add installDeps → runtimeValidate path
 *   (used for exclusive tasks that may modify dependencies or need build validation)
 * @returns Compiled graph with invoke() method
 */
function buildWorkerSubgraph(includeInstallValidate: boolean) {
  const graph = new StateGraph<ArchitectGraphState>({
    channels: {
      // Shared context (injected by worker)
      context: null as any,
      workspaceConfig: null as any,
      deps: null as any,
      gitPort: null as any,
      detectionReport: null as any,
      decomposeKeywords: null as any,
      selectedDesignFiles: null as any,
      decomposeFilePaths: null as any,
      prd: null as any,
      directive: null as any,
      design: null as any,
      designDocPath: null as any,
      designDocs: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      parsedUiDocs: null as any,
      runtimeAssetsIndex: null as any,
      referenceCodeContexts: null as any,
      sessionContext: null as any,

      // Per-worker state
      projectCodeContext: null as any,
      planText: {
        value: (x: string, y?: string) => y ?? x,
        default: () => '',
      } as any,
      codePrompt: null as any,
      rawResponse: null as any,
      responseSection: null as any,
      filesToDelete: null as any,
      modifications: null as any,
      featureName: null as any,
      requiredIntegrations: null as any,
      violations: null as any,
      fileErrors: null as any,
      retries: null as any,
      maxRetries: null as any,
      runtimeValidationResult: null as any,
      lastViolations: null as any,
      previousFileCount: null as any,
      previousAttempts: null as any,
      enforcementHistory: null as any,
      
      // Task
      taskQueue: null as any,
      currentTask: null as any,
      featureTasks: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      resolvedCategories: null as any,
      jobId: null as any,
      jobTiming: null as any,
      failedTasks: null as any,
      unresolvedErrors: null as any,
      evaluationReport: null as any,
      lessons: null as any,
      referenceRequests: null as any,
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
      _httpJobId: null as any,
      _phaseTimings: null as any,
      _uiLocale: null as any,
      directives: null as any,
      overrideDirective: null as any,
      chatSource: null as any,
      skipTriage: null as any,
      triageResult: null as any,
      workspaceState: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      _errorIsRepeating: null as any,
      _currentTaskTokenUsage: null as any,
      tokenUsage: null as any,
      recursionCount: null as any,
      recursionLimit: null as any,
      llmResponse: null as any,
      toolResults: null as any,
      conversationHistory: null as any,
      fileBuffers: null as any,
      interruption: null as any,

      // Worker-specific
      workerId: null as any,
      _taskCompleted: null as any,
      _isStopRequested: null as any,
      isResume: null as any,
    } as any,
  } as any);

  // Register nodes
  graph.addNode('plan', plan as any);
  graph.addNode('codeGen', codeGen as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('enforce', enforce as any);
  graph.addNode('learn', workerLearn as any);

  if (includeInstallValidate) {
    graph.addNode('installDeps', installDeps as any);
    graph.addNode('runtimeValidate', runtimeValidate as any);
  }

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);
  graph.addEdge('plan' as any, 'codeGen' as any);

  // CodeGen routing
  if (includeInstallValidate) {
    graph.addConditionalEdges(
      'codeGen' as any,
      routeAfterCodeGen as any,
      {
        tool: 'tool',
        checkTaskStatus: 'checkTaskStatus',
        installDeps: 'installDeps',
        codeGen: 'codeGen',
      } as any,
    );
    graph.addEdge('installDeps' as any, 'runtimeValidate' as any);
    graph.addEdge('runtimeValidate' as any, 'checkTaskStatus' as any);
  } else {
    graph.addConditionalEdges(
      'codeGen' as any,
      routeAfterCodeGen as any,
      {
        tool: 'tool',
        checkTaskStatus: 'checkTaskStatus',
        installDeps: 'checkTaskStatus', // Redirect installDeps → checkTaskStatus for non-exclusive
        codeGen: 'codeGen',
      } as any,
    );
  }

  // Tool → CodeGen loop
  graph.addEdge('tool' as any, 'codeGen' as any);

  // checkTaskStatus routing
  graph.addConditionalEdges(
    'checkTaskStatus' as any,
    ((s: any) => {
      const taskCompleted = s._taskCompleted === true;
      const hasViolations = s.violations && s.violations.length > 0;

      if (taskCompleted) {
        return 'learn'; // Task succeeded → learn → END
      }

      if (hasViolations) {
        if ((s.retries || 0) < (s.maxRetries || 3)) {
          return 'enforce'; // Retry with enforcement feedback
        }
        // Exceeded retries but still has violations
        return 'enforce'; // Let enforce/plan handle giving up
      }

      return 'learn'; // Default: done
    }) as any,
    { enforce: 'enforce', learn: 'learn' } as any,
  );

  // Enforce → Plan (retry loop)
  graph.addEdge('enforce' as any, 'plan' as any);

  // Learn → END (worker finishes after learning from one task)
  graph.addEdge('learn' as any, '__end__' as any);

  return (graph as any).compile();
}

/**
 * Create a WorkerGraphBuilder for code job tasks.
 * This function is passed to TaskOrchestrator as the graphBuilder callback.
 */
export function createCodeWorkerGraphBuilder(): WorkerGraphBuilder {
  return (includeInstallValidate: boolean) => {
    return buildWorkerSubgraph(includeInstallValidate);
  };
}
