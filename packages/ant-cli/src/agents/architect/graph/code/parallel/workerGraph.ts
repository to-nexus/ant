/**
 * Code Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single code task execution within
 * a TaskWorker. This is a lighter version of the main code graph that
 * only handles the task execution lifecycle (plan → codeGen → tool loop).
 *
 * Flow: plan → codeGen ↔ tool → checkTaskStatus → (enforce/workerLearn)
 */

import { StateGraph, END } from '@langchain/langgraph';
import type { ArchitectGraphState, ViolationType } from '../state';
import type { CodeTask } from '../../../types/task';
import { plan } from '../nodes/plan';
import { codeGen } from '../nodes/codeGen/index';
import { tool } from '../nodes/tool';
import { enforce } from '../nodes/enforce';
import { learn } from '../nodes/learn';
import { routeAfterCodeGen } from '../routers/codeGenRouter';
import { routeAfterPlan } from '../routers/planRouter';
import { routeAfterTool } from '../routers/toolRouter';
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

      if (errorMsg.includes('already created by task') || errorMsg.includes('was already created by')) {
        // ✅ Cross-worker file conflict: another worker owns this file
        violationType = 'cross_worker_conflict';
        suggestedFix = filePath
          ? `This file was created by another parallel task. Use read_file("${filePath}") to read the current content, then use edit_file to merge your changes.`
          : `This file was created by another parallel task. Read the file first, then use edit_file to merge.`;
      } else if (errorMsg.includes('Cannot edit non-existing file') || errorMsg.includes('non-existing file')) {
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

  // ✅ CRITICAL: Check if user has requested a stop before marking task as completed.
  // Without this check, a task can be marked "completed" even when the user cancelled
  // the job mid-execution, because checkTaskStatus only looked at violations.
  const isStopRequested = typeof (state as any)._isStopRequested === 'function'
    ? (state as any)._isStopRequested()
    : false;

  if (isStopRequested) {
    console.log(`🛑 [Worker checkTaskStatus] User stop requested — NOT marking task as completed`);
    // Workflow exit before early return
    if (state.deps?.workflowUpdate && state._httpJobId) {
      const workerId = (state as any).workerId ?? 0;
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,
      violations: [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // Batch split: original task was re-enqueued — skip completion marking.
  // Sub-tasks and re-enqueued verification are already in the shared taskQueue
  // (pushed by processDiagnosticBatchSplit). The orchestrator's broadcastKanban
  // in reportCompletion will pick them up once the worker graph finishes.
  if (state._batchSplitRequeued === true) {
    const workerId = (state as any).workerId ?? 0;
    const newTasks = state.taskQueue?.getAll().filter((t: any) => t.type === 'error' && !t.completed) || [];
    console.log(`📋 [Worker ${workerId} checkTaskStatus] Batch split completed: ${newTasks.length} error sub-task(s) created, original task re-enqueued`);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: true,
      currentTask: undefined,
      violations: [],
      _batchSplitRequeued: false,
      _codeGenCallIndex: 0,
      planText: '',
      projectCodeContext: undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // Budget exhaustion guard: if checkTaskStatus is reached without LLM explicitly
  // signaling done via <done> tag, the task hit its call budget — treat as failure.
  const llmExplicitlyDone = state.llmResponse?.done === true;
  if (violations.length === 0 && state.currentTask && !llmExplicitlyDone) {
    const taskType = state.currentTask.type;
    console.warn(`⚠️  [Worker checkTaskStatus] Task "${state.currentTask.name}" (type=${taskType}) reached checkTaskStatus without <done> tag — budget exhausted`);
    violations.push({
      type: 'budget_exhausted' as ViolationType,
      severity: 'critical',
      message: `Task reached checkTaskStatus without LLM signaling completion via <done> tag. The LLM could not complete within the call budget.`,
      isRetryable: true,
      suggestedFix: taskType === 'verification'
        ? 'Verification task did not complete — build may have failed. Will retry with remaining budget.'
        : 'Break down the task scope or provide clearer implementation direction.',
    });
  }

  // Diagnostic objective guard: build must pass for verification and error tasks.
  // Verification tasks additionally require tests to pass (if test files exist).
  // Error tasks only require build pass — tests are deferred to Final Verification.
  // Pre-planned error tasks (from batch split) are exempt — Final Verification handles build check.
  const isDiagnosticTask = state.currentTask?.type === 'verification' || state.currentTask?.type === 'error';
  const isPrePlannedTask = !!(state.currentTask as CodeTask)?.prePlanText;
  if (violations.length === 0 && llmExplicitlyDone && isDiagnosticTask && !isPrePlannedTask) {
    const tracker = state._verificationTracker;

    if (!tracker) {
      const history = state.commandHistory || [];
      const lastCommand = history[history.length - 1];
      if (!lastCommand || !lastCommand.success) {
        console.warn(`⚠️  [Worker checkTaskStatus] Verification: no tracker, falling back to commandHistory`);
        violations.push({
          type: 'verification_incomplete' as ViolationType,
          severity: 'critical',
          message: lastCommand
            ? `Last command failed (exit ${lastCommand.exitCode}): ${lastCommand.command}`
            : 'Verification task completed without executing any command.',
          isRetryable: true,
          suggestedFix: 'Run the build/test command and verify it succeeds before marking done.',
        });
      }
    } else if (!tracker.buildPassed) {
      console.warn(`⚠️  [Worker checkTaskStatus] Verification: build objective not met`);
      const history = state.commandHistory || [];
      const lastFailed = [...history].reverse().find(h => !h.success);
      const buildErrorDetail = lastFailed?.errorSnippet
        ? `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`
        : '';
      violations.push({
        type: 'verification_incomplete' as ViolationType,
        severity: 'critical',
        message: 'Build has not succeeded. A build command must exit 0 with no file modifications after it.' + buildErrorDetail,
        isRetryable: true,
        suggestedFix: 'Run the build command and ensure it passes. If you edited files after the last build, re-run the build.',
      });
    } else if (tracker.testsRequired && !tracker.testPassed) {
      console.warn(`⚠️  [Worker checkTaskStatus] Verification: test objective not met`);
      const history = state.commandHistory || [];
      const lastFailed = [...history].reverse().find(h => !h.success);
      const testErrorDetail = lastFailed?.errorSnippet
        ? `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`
        : '';
      violations.push({
        type: 'verification_incomplete' as ViolationType,
        severity: 'critical',
        message: 'Tests have not passed. Test files exist in this project — run tests and ensure they pass.' + testErrorDetail,
        isRetryable: true,
        suggestedFix: 'Run the test command and ensure all tests pass before marking done.',
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
    // Task succeeded — use _currentTaskTokenUsage as single source of truth.
    // _currentTaskTokenUsage already accumulated ALL plan + codeGen calls via
    // accumulateTokenUsage({ taskLevel: true, jobLevel: true }) in each node.
    // No additional merge or job-level re-accumulation needed here.
    const { getTaskTokenUsage } = await import('../../../../common/graph/llmHelpers');
    const taskTokenUsage = getTaskTokenUsage(state as any);

    const { TaskTimingHelper } = await import('../state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    console.log(`✅ [Worker] Task "${completedTask.name}" completed!`);

    // Log task_complete to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
      const { getExecutionLogger } = await import('../../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      });
      execLogger.logTaskComplete(completedTask.id, {
        taskName: completedTask.name,
        elapsedMs: completedTask.timing?.elapsedTime || 0,
        inputTokens: completedTask.tokenUsage?.inputTokens || 0,
        outputTokens: completedTask.tokenUsage?.outputTokens || 0,
        cacheReadTokens: completedTask.tokenUsage?.cacheReadTokens || 0,
        cacheCreationTokens: completedTask.tokenUsage?.cacheCreationTokens || 0,
        llmCallCount: state._codeGenCallIndex || 0,
      }).catch(() => {});
    }

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      retries: 0,
      violations: [],
      conversationHistory: [],
      planText: '',
      projectCodeContext: undefined,
      _codeGenCallIndex: 0,
      _finalTaskLoopCount: 0,
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
 */
function buildWorkerSubgraph() {
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
      profile: {
        value: (x: any, y?: any) => y ?? x,
        default: () => undefined,
      } as any,
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
      _codeGenCallIndex: null as any,
      _finalTaskLoopCount: null as any,
      recursionCount: null as any,
      recursionLimit: null as any,
      llmResponse: null as any,
      toolResults: null as any,
      conversationHistory: null as any,
      interruption: null as any,
      _planExploring: null as any,
      planConversationHistory: null as any,

      // Verification & command tracking
      _verificationTracker: null as any,
      commandHistory: null as any,

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

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);

  // Plan → tool (if tool_calls), checkTaskStatus (if batch split), or codeGen
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', codeGen: 'codeGen', checkTaskStatus: 'checkTaskStatus' } as any,
  );

  // CodeGen → Router (tool / checkTaskStatus / codeGen)
  graph.addConditionalEdges(
    'codeGen' as any,
    routeAfterCodeGen as any,
    {
      tool: 'tool',
      checkTaskStatus: 'checkTaskStatus',
      codeGen: 'codeGen',
    } as any,
  );

  // Tool → plan (if plan exploring) or codeGen
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', codeGen: 'codeGen' } as any,
  );

  // checkTaskStatus routing
  graph.addConditionalEdges(
    'checkTaskStatus' as any,
    ((s: any) => {
      const taskCompleted = s._taskCompleted === true;
      const hasViolations = s.violations && s.violations.length > 0;

      if (taskCompleted) {
        return 'learn';
      }

      if (hasViolations) {
        const remaining = (s.recursionLimit || 200) - (s.recursionCount || 0);
        if (remaining < 20) {
          console.warn(`⚠️  Worker: insufficient recursion budget (${remaining}) for retry — moving to learn`);
          return 'learn';
        }
        if ((s.retries || 0) < (s.maxRetries || 3)) {
          return 'enforce';
        }
        console.log(`⚠️  Worker task "${s.currentTask?.name}" exhausted retries (${s.retries}/${s.maxRetries}) — moving to learn`);
        return 'learn';
      }

      return 'learn';
    }) as any,
    { enforce: 'enforce', learn: 'learn' } as any,
  );

  // Enforce → Plan (retry loop)
  graph.addEdge('enforce' as any, 'plan' as any);

  // Learn → END
  graph.addEdge('learn' as any, '__end__' as any);

  return (graph as any).compile();
}

/**
 * Create a WorkerGraphBuilder for code job tasks.
 * This function is passed to TaskOrchestrator as the graphBuilder callback.
 */
export function createCodeWorkerGraphBuilder(): WorkerGraphBuilder {
  return (_includeInstallValidate: boolean) => {
    return buildWorkerSubgraph();
  };
}
