/**
 * Code Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single code task execution within
 * a TaskWorker. This is a lighter version of the main code graph that
 * only handles the task execution lifecycle (plan → execute → tool loop).
 *
 * Flow: plan → execute ↔ tool → checkTaskStatus → (enforce/workerLearn)
 */

import { Annotation, StateGraph, END } from '@langchain/langgraph';
import type { ArchitectGraphState, ViolationType } from '../state';
import type { CodeTask } from '../../../types/task';
import { plan } from '../nodes/plan';
import { execute } from '../nodes/execute/index';
import { tool } from '../nodes/tool';
import { enforce } from '../nodes/enforce';
import { learn } from '../nodes/learn';
import { routeAfterExecute } from '../routers/executeRouter';
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
    const workerId = state.workerId ?? 0;
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
  const isStopRequested = typeof state._isStopRequested === 'function'
    ? state._isStopRequested()
    : false;

  if (isStopRequested) {
    console.log(`🛑 [Worker checkTaskStatus] User stop requested — NOT marking task as completed`);
    // Workflow exit before early return
    if (state.deps?.workflowUpdate && state._httpJobId) {
      const workerId = state.workerId ?? 0;
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
    const workerId = state.workerId ?? 0;
    const newTasks = state.taskQueue?.getAll().filter((t: any) => t.type === 'error' && !t.completed) || [];
    console.log(`📋 [Worker ${workerId} checkTaskStatus] Batch split completed: ${newTasks.length} error sub-task(s) created, original task re-enqueued`);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,       // NOT completed — task is re-enqueued (back in todo)
      _batchSplitCompleted: true,  // Signal TaskWorker to release slot via reportBatchSplit()
      currentTask: undefined,
      violations: [],
      _batchSplitRequeued: false,
      _executeCallIndex: 0,
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

  // Diagnostic objective guard: build must pass for verification tasks.
  // Verification tasks additionally require tests to pass (if test files exist).
  // Error tasks are code-fix only — build verification is deferred to the re-enqueued verification task.
  const isDiagnosticTask = state.currentTask?.type === 'verification';
  if (violations.length === 0 && llmExplicitlyDone && isDiagnosticTask) {
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

  // test-code guard: ensure at least one test file was actually written.
  // Protects against LLM claiming completion without creating test files.
  if (violations.length === 0 && llmExplicitlyDone && state.currentTask?.type === 'test-code') {
    const { detectTestFilesFromDisk } = await import('../nodes/plan/testFileDetector');
    const testFilesExist = detectTestFilesFromDisk(state.context?.featurePath);
    if (!testFilesExist) {
      violations.push({
        type: 'incomplete_implementation' as ViolationType,
        severity: 'critical',
        message: 'test-code task completed but no test files (*.test.ts / *.spec.ts / *.test.js / *.spec.js) were found in the workspace.',
        isRetryable: true,
        suggestedFix: 'Create the required test files before marking this task as done.',
      });
    }
  }

  const hasViolations = violations.length > 0;

  // Workflow exit (await to ensure broadcast completes before next node's enterNode)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = state.workerId ?? 0;
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
  }

  if (!hasViolations && state.currentTask) {
    // Task succeeded — use _currentTaskTokenUsage as single source of truth.
    // _currentTaskTokenUsage already accumulated ALL plan + execute calls via
    // accumulateTokenUsage({ taskLevel: true, jobLevel: true }) in each node.
    // No additional merge or job-level re-accumulation needed here.
    const { getTaskTokenUsage } = await import('../../../../common/graph/llmHelpers');
    const taskTokenUsage = getTaskTokenUsage(state);

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
        llmCallCount: state._executeCallIndex || 0,
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
      _executeCallIndex: 0,
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

const CodeWorkerSubgraphAnnotation = Annotation.Root({
  // Shared context (injected by worker)
  context: Annotation<any>,
  workspaceConfig: Annotation<any>,
  deps: Annotation<any>,
  gitPort: Annotation<any>,
  detectionReport: Annotation<any>,
  decomposeKeywords: Annotation<any>,
  selectedDesignFiles: Annotation<any>,
  decomposeFilePaths: Annotation<any>,
  prd: Annotation<any>,
  directive: Annotation<any>,
  design: Annotation<any>,
  designDocPath: Annotation<any>,
  designDocs: Annotation<any>,
  code: Annotation<any>,
  codeHead: Annotation<any>,
  profile: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
    default: () => undefined,
  }),
  parsedUiDocs: Annotation<any>,
  runtimeAssetsIndex: Annotation<any>,
  referenceCodeContexts: Annotation<any>,
  sessionContext: Annotation<any>,

  // Per-worker state
  projectCodeContext: Annotation<any>,
  planText: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
    default: () => '',
  }),
  codePrompt: Annotation<any>,
  rawResponse: Annotation<any>,
  responseSection: Annotation<any>,
  filesToDelete: Annotation<any>,
  modifications: Annotation<any>,
  featureName: Annotation<any>,
  requiredIntegrations: Annotation<any>,
  violations: Annotation<any>,
  fileErrors: Annotation<any>,
  retries: Annotation<any>,
  maxRetries: Annotation<any>,
  lastViolations: Annotation<any>,
  previousFileCount: Annotation<any>,
  previousAttempts: Annotation<any>,
  enforcementHistory: Annotation<any>,

  // Task
  taskQueue: Annotation<any>,
  currentTask: Annotation<any>,
  featureTasks: Annotation<any>,
  completedTasks: Annotation<any>,
  completedTasksDetails: Annotation<any>,
  resolvedCategories: Annotation<any>,
  jobId: Annotation<any>,
  jobTiming: Annotation<any>,
  failedTasks: Annotation<any>,
  unresolvedErrors: Annotation<any>,
  evaluationReport: Annotation<any>,
  lessons: Annotation<any>,
  referenceRequests: Annotation<any>,
  branch: Annotation<any>,
  filesWritten: Annotation<any>,
  reportFile: Annotation<any>,
  _httpJobId: Annotation<any>,
  _phaseTimings: Annotation<any>,
  _uiLocale: Annotation<any>,
  directives: Annotation<any>,
  overrideDirective: Annotation<any>,
  chatSource: Annotation<any>,
  skipTriage: Annotation<any>,
  triageResult: Annotation<any>,
  workspaceState: Annotation<any>,
  currentAgent: Annotation<any>,
  currentJob: Annotation<any>,
  _errorIsRepeating: Annotation<any>,
  _currentTaskTokenUsage: Annotation<any>,
  tokenUsage: Annotation<any>,
  _executeCallIndex: Annotation<any>,
  _finalTaskLoopCount: Annotation<any>,
  recursionCount: Annotation<any>,
  recursionLimit: Annotation<any>,
  llmResponse: Annotation<any>,
  toolResults: Annotation<any>,
  conversationHistory: Annotation<any>,
  interruption: Annotation<any>,
  _activePhase: Annotation<any>,
  _planEntryReason: Annotation<any>,
  _executeModifiedFiles: Annotation<any>,
  _installNeeded: Annotation<any>,
  _appliedPlanHistory: Annotation<any>,
  _otherWorkerFiles: Annotation<any>,
  planConversationHistory: Annotation<any>,

  // Verification & command tracking
  _verificationTracker: Annotation<any>,
  commandHistory: Annotation<any>,

  // Worker-specific
  workerId: Annotation<any>,
  _taskCompleted: Annotation<any>,
  _isStopRequested: Annotation<any>,
  isResume: Annotation<any>,
  _batchSplitRequeued: Annotation<any>,

  // Figma MCP state
  figmaAvailable: Annotation<any>,
  figmaFileKey: Annotation<any>,
  figmaStartNodeId: Annotation<any>,
});

/**
 * Build a worker subgraph for code job tasks.
 */
function buildWorkerSubgraph() {
  const graph = new StateGraph(CodeWorkerSubgraphAnnotation);

  // Register nodes
  graph.addNode('plan', plan as any);
  graph.addNode('execute', execute as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('enforce', enforce as any);
  graph.addNode('learn', workerLearn as any);

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);

  // Plan → tool (if tool_calls), checkTaskStatus (if batch split), or execute
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', execute: 'execute', checkTaskStatus: 'checkTaskStatus' } as any,
  );

  // Execute → Router (tool / checkTaskStatus / execute / plan)
  graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    {
      tool: 'tool',
      checkTaskStatus: 'checkTaskStatus',
      execute: 'execute',
      plan: 'plan',   // verification task done → plan re-verify (final build/test check)
    } as any,
  );

  // Tool → plan (if plan exploring) or execute
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', execute: 'execute' } as any,
  );

  // checkTaskStatus routing
  graph.addConditionalEdges(
    'checkTaskStatus' as any,
    ((s: any) => {
      const taskCompleted = s._taskCompleted === true;
      const batchSplitCompleted = s._batchSplitCompleted === true;
      const hasViolations = s.violations && s.violations.length > 0;

      if (taskCompleted || batchSplitCompleted) {
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
