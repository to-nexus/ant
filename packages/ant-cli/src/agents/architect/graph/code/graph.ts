import path from 'node:path';
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { getTechTier } from '@ant/shared';
import { DetectableFields } from '../../../common/graph/annotationHelpers';
import { ArchitectGraphState, TASK_PRIORITIES, TaskTimingHelper, ViolationType } from "./state";
import { CodeTask } from "../../types/task";
import { codeResolveStrategy } from "./nodes/resolve";
import { createResolveNode } from "../../../common/graph/nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/graph/nodes/triage";  // ✅ Triage System
import { createDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { codeDetectStrategy } from './nodes/detect/strategy.js';
import { decompose } from "./nodes/decompose";
import { plan } from "./nodes/plan";
import { execute } from "./nodes/execute/index";
import { tool } from "./nodes/tool";
// import { validate } from "./nodes/validate";  // ✅ REMOVED: Static validation no longer needed (prompts handle it)
import { enforce } from "./nodes/enforce";
import { learn } from "./nodes/learn";
import { routeAfterExecute } from "./routers/executeRouter";
import { routeAfterPlan } from "./routers/planRouter";
import { routeAfterTool } from "./routers/toolRouter";
import { saveCheckpoint } from "./nodes/checkpoint";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from "./parallel/types";
import * as routing from "./routing";
import { JobTimingManager } from "../../../common/graph/timing/JobTimingManager";
import type { InterruptionReason } from '../../../../core/types/session';

/**
 * Node that handles task completion logic and state mutations.
 * This MUST be a node (not a router) because it mutates state.
 */
async function checkTaskStatus(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'checkTaskStatus', 
      0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ Convert fileErrors to violations
  const violations = [...(state.violations || [])];
  if (state.fileErrors && state.fileErrors.length > 0) {
    console.log(`⚠️  [checkTaskStatus] Converting ${state.fileErrors.length} file error(s) to violations`);
    for (const errorMsg of state.fileErrors) {
      // ✅ Extract file path from error message if available
      const fileMatch = errorMsg.match(/File "([^"]+)"|file "([^"]+)"/);
      const filePath = fileMatch ? (fileMatch[1] || fileMatch[2]) : undefined;
      
      // ✅ Determine violation type based on error message
      let violationType: ViolationType;
      let suggestedFix: string | undefined;
      
      if (errorMsg.includes('Cannot edit non-existing file') || errorMsg.includes('non-existing file')) {
        // File doesn't exist but LLM tried to edit it
        violationType = 'missing_file';
        suggestedFix = filePath ? `File does not exist. Use <file path="${filePath}"> to create it first, or verify the file path is correct.` : undefined;
      } else if (errorMsg.includes('Search block not found')) {
        // File exists but search block doesn't match (outdated content)
        violationType = 'file_operation_failed';
        suggestedFix = filePath 
          ? `The file content has changed since you last saw it.\n` +
            `Call read_file("${filePath}") to get current content, then retry edit_file with the exact match.`
          : undefined;
      } else {
        // Other file operation errors
        violationType = 'file_operation_failed';
        suggestedFix = undefined;
      }
      
      violations.push({
        type: violationType,
        message: errorMsg,
        severity: 'critical',
        file: filePath,
        isRetryable: true,  // ✅ All file errors are retryable
        suggestedFix
      });
    }
  }
  
  // ✅ Budget exhaustion guard: <done> tag is the ONLY completion signal.
  // If checkTaskStatus is reached without LLM explicitly signaling done,
  // the task hit its call budget — this is a failure, not a success.
  // Applies to ALL task types including verification and error.
  const llmExplicitlyDone = state.llmResponse?.done === true;
  if (violations.length === 0 && state.currentTask && !llmExplicitlyDone) {
    const taskType = state.currentTask.type;
    console.warn(`⚠️  [checkTaskStatus] Task "${state.currentTask.name}" (type=${taskType}) reached checkTaskStatus without <done> tag — budget exhausted`);
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
  // Error tasks are code-fix only — build verification deferred to the re-enqueued verification task.
  const isDiagnosticTask = state.currentTask?.type === 'verification';
  if (violations.length === 0 && llmExplicitlyDone && isDiagnosticTask) {
    const tracker = state._verificationTracker;

    if (!tracker) {
      const history = state.commandHistory || [];
      const lastCommand = history[history.length - 1];
      if (!lastCommand || !lastCommand.success) {
        console.warn(`⚠️  [checkTaskStatus] Verification: no tracker, falling back to commandHistory`);
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
    } else if (tracker.typecheckRequired && tracker.typecheckAttempted && !tracker.typecheckPassed) {
      console.warn(`⚠️  [checkTaskStatus] Verification: typecheck objective not met`);
      const history = state.commandHistory || [];
      const lastFailed = [...history].reverse().find(h => !h.success);
      const typecheckErrorDetail = lastFailed?.errorSnippet
        ? `\n\nLast failed command: ${lastFailed.command}\nError output:\n${lastFailed.errorSnippet}`
        : '';
      violations.push({
        type: 'verification_incomplete' as ViolationType,
        severity: 'critical',
        message: 'Type check (tsc --noEmit) has not succeeded. Resolve type errors before proceeding to build.' + typecheckErrorDetail,
        isRetryable: true,
        suggestedFix: 'Fix type errors found by tsc --noEmit, then re-run type check.',
      });
    } else if (!tracker.buildPassed) {
      console.warn(`⚠️  [checkTaskStatus] Verification: build objective not met`);
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
      console.warn(`⚠️  [checkTaskStatus] Verification: test objective not met`);
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
  if (violations.length === 0 && llmExplicitlyDone && state.currentTask?.type === 'test-code') {
    const { detectTestFilesFromDisk } = await import('./nodes/plan/testFileDetector');
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

  const hasViolations = (violations && violations.length > 0);

  // ✅ CRITICAL: Check if user has requested a stop before marking task as completed.
  // Without this, a cancelled job can still mark the current task as "completed"
  // if checkTaskStatus runs after the cancellation signal but before process termination.
  const isStopRequested = typeof state._isStopRequested === 'function'
    ? state._isStopRequested()
    : false;

  if (isStopRequested) {
    console.log(`🛑 [checkTaskStatus] User stop requested — NOT marking task as completed`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }
    return {
      violations: [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // Batch split: original task was re-enqueued — skip completion marking entirely
  if (state._batchSplitRequeued === true) {
    const requeuedTasks = state.taskQueue?.getAll().filter(t => (t as any)._batchSplitCount);
    if (requeuedTasks?.length) {
      for (const t of requeuedTasks) {
        const ct = t as any;
        console.log(`🔄 [BatchSplit] Re-enqueued task "${t.name}" (cycle ${ct._batchSplitCount || 1})`);
      }
    }
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }
    return {
      currentTask: undefined,
      retries: 0,
      violations: [],
      _batchSplitRequeued: false,
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
      planText: '',
      projectCodeContext: undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  if (!hasViolations && state.currentTask) {
    // Task succeeded — use _currentTaskTokenUsage as single source of truth.
    // _currentTaskTokenUsage already accumulated ALL plan + execute calls via
    // accumulateTokenUsage({ taskLevel: true, jobLevel: true }) in each node.
    // No additional merge or job-level re-accumulation needed here.
    const { getTaskTokenUsage } = await import('../../../common/graph/llmHelpers');
    const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
    const taskTokenUsage = getTaskTokenUsage(state);
    
    const { TaskTimingHelper } = await import('./state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
      if (completedTask.tokenUsage) {
        console.log(`   Tokens: ${completedTask.tokenUsage.totalTokens} total (${completedTask.tokenUsage.inputTokens} in, ${completedTask.tokenUsage.outputTokens} out)`);
      }
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }

    // ✅ Log task_complete event to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
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
    
    // Apply centralized conversation retention policy (code job always discards)
    const { applyRetention } = await import('../../../../core/utils/conversationRetention');
    state.conversationHistory = applyRetention({
      jobType: 'code',
      currentTask: { id: state.currentTask.id },
      nextTask: state.taskQueue?.peek() ? { id: state.taskQueue.peek()!.id } : undefined,
      conversationHistory: state.conversationHistory || [],
    });
    state._executeCallIndex = 0;
    state._finalTaskLoopCount = 0;
    
    // ✅ CRITICAL: Clear violations for next task
    // Previous task's violations should not carry over to new task
    state.violations = [];
    state.lastViolations = [];  // ✅ Also clear lastViolations
    state.violationMessage = undefined;
    console.log(`🧹 [checkTaskStatus] Cleared violations for next task`);
    
    // Update completedTasks (IDs only)
    const completedTasks = state.completedTasks || [];
    completedTasks.push(completedTask.id);
    
    // ✅ NEW: Store full task details in completedTasksDetails
    const completedTasksDetails = state.completedTasksDetails || [];
    completedTasksDetails.push(completedTask);
    
    console.log(`[checkTaskStatus] 💾 Saving completed task to completedTasksDetails:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      hasTiming: !!completedTask.timing,
      hasDescription: !!completedTask.description,
      totalCompletedTasksDetails: completedTasksDetails.length,
      completedTasksDetailsIds: completedTasksDetails.map(t => t.id)
    });
    
    // If feature task, mark in featureTasks map
    if (completedTask.type === 'feature' && state.featureTasks) {
      const feature = state.featureTasks.get(completedTask.id);
      if (feature) {
        feature.completed = true;
      }
    }
    
    // If error task completed, guarantee Final Verification exists as safety net.
    // Decompose may omit verification for error-only jobs; this ensures a final
    // build/test check after all error fixes are applied.
    if (state.currentTask.type === 'error' && state.taskQueue) {
      const hasFinalTask = state.taskQueue.getAll().some((t: CodeTask) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
      
      if (!hasFinalTask) {
        const finalTask: CodeTask = {
          id: `final-verification-recheck-${Date.now()}`,
          name: 'Final Verification (Recheck)',
          type: 'verification' as const,
          priority: TASK_PRIORITIES.FINAL_VERIFICATION,
          description: 'Re-verify all errors are resolved after error fixes',
          techTiers: [state.resolvedAction?.basis?.techTier?.frontend, state.resolvedAction?.basis?.techTier?.backend].filter((t): t is import('@ant/shared').TechTier => !!t),
        };
        state.taskQueue.push(finalTask);
        console.log(`📋 Added Final Verification to confirm all errors resolved\n`);
      }
    }
    
    // ✅ CRITICAL: Update state with completedTasksDetails
    const updatedState = {
      ...state,
      completedTasks,
      completedTasksDetails, // ✅ NEW: Add full task details to state
      currentTask: undefined,
      retries: 0,
      violations: [],
    };
    
    // ✅ CRITICAL: Save checkpoint with updated completedTasksDetails
    const { saveCheckpoint } = await import('./nodes/checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`[checkTaskStatus] ✅ Checkpoint saved with completedTasksDetails (${completedTasksDetails.length} tasks)`);
    
    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state.deps?.kanbanUpdate && state._httpJobId && updatedState.taskQueue) {
      const allTasks = updatedState.taskQueue.getAll();
      const nextTask = updatedState.taskQueue.peek(); // ✅ Use peek() for correct next task
      
      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter((t: CodeTask) => t.id !== nextTask.id) : allTasks;
      
      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,  // ✅ Show next task as in-progress
        remainingQueue,    // ✅ Exclude nextTask from queue
        completedTasksDetails,
        state.recursionCount,
        state.recursionLimit,
        state.tokenUsage  // ✅ FIX: Pass job-level token usage to prevent badge reset
      );
    }
    
    // ✅ Workflow instrumentation: Exit node (task completed path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
    }
    
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      retries: 0,
      violations: [],
      conversationHistory: state.conversationHistory,  // Already processed by retention policy above
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
      planText: '',  // ✅ Clear for next task - prevents stale planText leaking via reducer
      projectCodeContext: undefined,  // ✅ Clear for next task - Plan will load new context
      recursionCount: state.recursionCount,  // ✅ Propagate recursion count
      recursionLimit: state.recursionLimit,  // ✅ Propagate recursion limit
    };
  }
  
  // ✅ Log violation event to debug/logs/
  if (state.context?.featurePath && state._httpJobId && state.currentTask) {
    const { getExecutionLogger: getExecLogger } = await import('../../../../core/utils/executionLogger');
    const execLogger = getExecLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    execLogger.logTaskError(state.currentTask.id, {
      taskName: state.currentTask.name,
      violationType: violations[0]?.type || 'unknown',
      violationCount: violations.length,
      retryCount: state.retries || 0,
      message: violations.map((v: any) => v.message).join('; ').substring(0, 500),
    }).catch(() => {});
  }

  // ✅ Workflow instrumentation: Exit node (task failed/has violations path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', 0);
  }
  
  // Task failed or has violations - propagate violations and recursion tracking
  return {
    violations,  // ✅ CRITICAL: Must return violations for router to see them!
    recursionCount: state.recursionCount,  // ✅ Propagate recursion count
    recursionLimit: state.recursionLimit,  // ✅ Propagate recursion limit
  };
}

/**
 * Parallel Orchestrator node for code job.
 * Runs all tasks from the queue using TaskOrchestrator with worker subgraphs.
 * Only invoked when ANT_TASK_CONCURRENCY > 1.
 * After all tasks are processed, returns to the main graph for final learn + END.
 */
async function parallelOrchestrator(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  const { TaskOrchestrator: OrchestratorClass } = await import('./parallel/TaskOrchestrator');
  const { createCodeWorkerGraphBuilder } = await import('./parallel/workerGraph');
  const { registerActiveOrchestrator, unregisterActiveOrchestrator } = await import('../../../../composition/gracefulShutdown');
  const { SharedFileBuffer } = await import('./parallel/SharedFileBuffer');

  const maxWorkers = getTaskConcurrency();
  console.log(`\n🔀 [ParallelOrchestrator] Starting with maxWorkers=${maxWorkers}`);

  const taskQueue = state.taskQueue;
  if (!taskQueue || taskQueue.isEmpty()) {
    console.log(`[ParallelOrchestrator] No tasks in queue, skipping`);
    return {};
  }

  // ✅ Create SharedFileBuffer for cross-worker file conflict detection
  const repoRoot = state.deps?.git ? await state.deps.git.getRepoRoot() : undefined;
  const codebaseRel = (() => {
    if (!repoRoot || !state.deps?.fileSystem) return 'codebase';
    const wsRoot = state.deps.fileSystem.getRootPath?.();
    if (!wsRoot) return 'codebase';
    return path.relative(wsRoot, repoRoot).replace(/\\/g, '/') || 'codebase';
  })();
  const sharedFileBuffer = new SharedFileBuffer(codebaseRel);
  console.log(`📁 [ParallelOrchestrator] SharedFileBuffer created (codebaseRel=${codebaseRel})`);

  // Build shared context for workers (everything they need except per-task state)
  const sharedContext = {
    context: state.context,
    workspaceConfig: state.workspaceConfig,
    deps: state.deps,
    gitPort: state.gitPort,
    artifacts: state.artifacts,
    resolvedArtifacts: state.resolvedArtifacts,
    techTier: getTechTier(state),
    selectedDesignFiles: state.selectedDesignFiles,
    decomposeFilePaths: state.decomposeFilePaths,
    directive: state.directive,
    code: state.code,
    codeHead: state.codeHead,
    profile: state.profile,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    referenceCodeContexts: state.referenceCodeContexts,
    sessionContext: state.sessionContext,
    featureName: state.featureName,
    maxRetries: state.maxRetries || 3,
    recursionCount: state.recursionCount || 0,
    recursionLimit: state.recursionLimit,  // ✅ Always set by runner.ts from env RECURSION_LIMIT
    _httpJobId: state._httpJobId,
    _uiLocale: state._uiLocale,
    jobId: state.jobId,
    jobTiming: state.jobTiming,
    featureTasks: state.featureTasks,
    referenceRequests: state.referenceRequests,
    designDocUnknownPackages: state.designDocUnknownPackages,
    _sharedFileBuffer: sharedFileBuffer,
    taskQueue: state.taskQueue,
    figmaAvailable: state.figmaAvailable,
    figmaFileKey: state.figmaFileKey,
    figmaStartNodeId: state.figmaStartNodeId,
  };

  const graphBuilder = createCodeWorkerGraphBuilder();
  const orchestrator = new OrchestratorClass<CodeTask>(
    taskQueue,
    graphBuilder,
    sharedContext,
    {
      onTaskComplete: (task, workerId) => {
        console.log(`[ParallelOrchestrator] Worker ${workerId} completed: ${task.name}`);
        if (task.type === 'error') {
          const remaining = taskQueue.getAll().filter((t: CodeTask) => t.type === 'error').length;
          console.log(`📋 [ParallelOrchestrator] Error task done. ${remaining} error task(s) remain — will run independently`);
          const hasFinalInQueue = taskQueue.getAll().some((t: CodeTask) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
          const hasFinalRunning = orchestrator.getRunningTasks().some((t: any) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
          const hasFinalCompleted = orchestrator.getCompletedTasks().some((t: any) => t.type === 'verification');
          if (!hasFinalInQueue && !hasFinalRunning && !hasFinalCompleted) {
            const finalTask: CodeTask = {
              id: `final-verification-recheck-${Date.now()}`,
              name: 'Final Verification (Recheck)',
              type: 'verification' as const,
              priority: TASK_PRIORITIES.FINAL_VERIFICATION,
              description: 'Re-verify all errors are resolved after error fixes',
              techTiers: [state.resolvedAction?.basis?.techTier?.frontend, state.resolvedAction?.basis?.techTier?.backend].filter((t): t is import('@ant/shared').TechTier => !!t),
            };
            taskQueue.push(finalTask);
            console.log(`📋 [ParallelOrchestrator] Added Final Verification to confirm all errors resolved`);
          }
        }
      },
      onTaskFailure: (task, error, workerId) => {
        console.error(`[ParallelOrchestrator] Worker ${workerId} failed: ${task.name} - ${error.message}`);
        // Log task_fail to debug/logs/ for post-mortem analysis
        if (state.context?.featurePath && state._httpJobId) {
          const { getExecutionLogger: getExecLogFail } = require('../../../../core/utils/executionLogger');
          const failLogger = getExecLogFail({
            featurePath: state.context.featurePath,
            jobId: state._httpJobId,
            jobType: 'code',
          });
          const isRecLimit = /recursion limit/i.test(error.message);
          failLogger.logTaskFail(task.id, {
            taskName: task.name,
            reason: isRecLimit ? 'recursion_limit' : 'unknown',
            errorMessage: error.message.substring(0, 500),
            elapsedMs: task.timing?.elapsedTime,
            inputTokens: task.tokenUsage?.inputTokens,
            outputTokens: task.tokenUsage?.outputTokens,
            cacheReadTokens: task.tokenUsage?.cacheReadTokens,
          }).catch(() => {});
        }
      },
      onWorkerTerminate: (workerId) => {
        // ✅ Immediately clear this worker's stale entry from WorkflowBroadcaster.
        // Without this, the worker's last-active-node badge stays visible in the
        // workflow UI until ALL parallel workers finish (clearWorkers at line 474).
        if (state.deps?.workflowUpdate?.clearWorkers && state._httpJobId) {
          Promise.resolve(
            state.deps.workflowUpdate.clearWorkers(state._httpJobId, [workerId])
          ).catch((err: Error) => {
            console.warn(`[ParallelOrchestrator] Failed to clear terminated worker ${workerId}:`, err.message);
          });
        }
      },
      onInterruption: (reason, runningTaskIds) => {
        // ✅ Log job_interrupted event to debug/logs/
        if (state.context?.featurePath && state._httpJobId) {
          import('../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
            const execLogger = getExecutionLogger({
              featurePath: state.context.featurePath!,
              jobId: state._httpJobId!,
              jobType: 'code',
            });
            execLogger.logJobInterrupted({
              reason,
              runningTaskIds,
              remainingTaskCount: taskQueue.size(),
              completedTaskCount: orchestrator.getCompletedTasks().length,
            }).catch(() => {});
          }).catch(() => {});
        }
      },
      onKanbanUpdate: (currentTasks, queue, completedTasks, tokenUsage) => {
        if (state.deps?.kanbanUpdate && state._httpJobId) {
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId,
            currentTasks,
            queue,
            completedTasks,
            undefined,  // recursionCount: Workflow SSE is the source of truth (per-worker count via WorkflowBroadcaster)
            undefined,  // recursionLimit: Workflow SSE is the source of truth
            tokenUsage,
          );
        }
      },
      onCheckpoint: async (checkpoint) => {
        if (state.deps?.session && state.context.featureFolder) {
          try {
            // Merge failed tasks into taskQueue so full task definitions survive
            // process termination (user stop, kill, etc.). Without this, only
            // summary data (taskId/taskName/error) is persisted and the task
            // cannot be resumed.
            const failedAsQueue = checkpoint.failedTasks.map(f => ({
              ...f.task,
              _failed: true,
              _failureReason: f.error.message,
            }));
            // Deduplicate: if a failed task was re-enqueued (e.g. verification after
            // batch split), the re-enqueued version in checkpoint.taskQueue has the
            // same id. Keep only the failed-record copy to avoid duplicate ids in the
            // persisted taskQueue.
            const failedIds = new Set(failedAsQueue.map((t: any) => t.id));
            const dedupedQueue = checkpoint.taskQueue.filter(t => !failedIds.has(t.id));

            await state.deps.session.updateArtifacts(
              state.context.project,
              state.context.featureFolder,
              'code',
              {
                state: {
                  taskQueue: [...failedAsQueue, ...dedupedQueue],
                  completedTasks: checkpoint.completedTasks.map(t => t.id),
                  completedTasksDetails: checkpoint.completedTasks,
                  failedTasks: checkpoint.failedTasks.map(f => ({
                    taskId: f.task.id,
                    taskName: f.task.name,
                    error: f.error.message,
                    timestamp: f.timestamp,
                  })),
                  tokenUsage: checkpoint.tokenUsage,
                  // ✅ Preserve estimating phase token usage snapshot in checkpoint
                  estimatingTokenUsage: state._estimatingTokenUsage,
                  jobId: state.jobId,
                  jobTiming: state.jobTiming,
                  parallelMode: true,
                  // ✅ FIX: Preserve decompose-phase context in checkpoint.
                  // onCheckpoint does a full replace of session.state, so any field
                  // not listed here is lost on session reload / resume.
                  designDocUnknownPackages: state.designDocUnknownPackages,
                  techTier: getTechTier(state),
                  profile: state.profile,
                  resolvedAction: state.resolvedAction,
                  referenceRequests: state.referenceRequests,
                  userLanguage: state.context.userLanguage,
                  // ✅ FIX: Preserve interruption details in checkpoint.
                  // onCheckpoint does a full replace of session.state. Without this,
                  // interruption info set by cleanupJobState would be lost when the
                  // child process writes its checkpoint after the API server.
                  ...(checkpoint.interruption ? {
                    interruption: {
                      reason: checkpoint.interruption.reason as InterruptionReason,
                      message: `Job interrupted: ${checkpoint.interruption.reason}`,
                      timestamp: new Date().toISOString(),
                      canResume: checkpoint.interruption.canResume,
                    }
                  } : {}),
                },
              },
            );
            const failedCount = checkpoint.failedTasks.length;
            console.log(`💾 [ParallelOrchestrator] Checkpoint saved (${checkpoint.completedTasks.length} completed, ${checkpoint.taskQueue.length} queued${failedCount > 0 ? `, ${failedCount} failed` : ''})`);
          } catch (err) {
            console.warn(`⚠️ [ParallelOrchestrator] Checkpoint save failed:`, err);
          }
        }
        
        // ✅ Also save checkpoint snapshot to Redis as backup.
        // If the session file is corrupted/stale when cleanupJobState reads it,
        // Redis serves as a fallback to prevent task state loss.
        if (state.deps?.kanbanUpdate?.saveCheckpointSnapshot && state._httpJobId) {
          state.deps.kanbanUpdate.saveCheckpointSnapshot(
            checkpoint.taskQueue,
            checkpoint.completedTasks,
            checkpoint.tokenUsage,
          );
        }
      },
    },
    {
      maxWorkers,
      checkpointInterval: 60000,
      barriers: {
        feature: true,
        integration: true,
        ui: true,
        'test-code': true,
        doc: true,
      },
    },
    state.completedTasksDetails || [],  // Resume: pass previously completed tasks
  );

  // ✅ Log parallel_start (and job_resumed if resuming) events to debug/logs/
  const parallelStartTime = Date.now();
  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    // ✅ Log job_resumed when this is a resume run with an existing task queue
    if (state.isResume) {
      execLogger.logJobResumed({
        fromCompletedTaskCount: (state.completedTasksDetails || []).length,
        remainingTaskCount: taskQueue.size(),
      }).catch(() => {});
    }
    const allTaskIds = taskQueue.getAll().map((t: any) => t.id);
    execLogger.logParallelStart({
      taskIds: allTaskIds,
      concurrency: maxWorkers,
    }).catch(() => {});
  }

  // Register orchestrator for graceful shutdown (SIGTERM handler)
  registerActiveOrchestrator(orchestrator);
  let result;
  try {
    result = await orchestrator.run();
  } finally {
    unregisterActiveOrchestrator();
  }

  // Clear stale worker entries from WorkflowBroadcaster
  // Workers' last node stays in activeWorkers until explicitly cleared
  if (state.deps?.workflowUpdate?.clearWorkers && state._httpJobId) {
    await state.deps.workflowUpdate.clearWorkers(state._httpJobId);
  }

  console.log(`\n🔀 [ParallelOrchestrator] Completed:`);
  console.log(`   Completed: ${result.completedTasks.length}`);
  console.log(`   Failed: ${result.failedTasks.length}`);
  console.log(`   Remaining: ${result.remainingQueue.length}`);
  console.log(`   Interrupted: ${result.hasInterruptedTasks}`);

  // Post-job: design-prescribed package coverage report
  if (state.designDocUnknownPackages?.length && state.context?.featurePath && state._httpJobId) {
    try {
      const { getSessionDebugDir } = await import('../../../../core/utils/sessionPaths');
      const planFilePath = path.join(
        getSessionDebugDir(state.context.featurePath, 'architect', 'plans'),
        `plan-${state._httpJobId}.json`,
      );
      const planFileContent = await import('fs/promises').then(fs => fs.readFile(planFilePath, 'utf-8'));
      const planEntries: any[] = JSON.parse(planFileContent);
      const depManifestNames = new Set(['go-mod', 'package-json', 'requirements-txt', 'cargo-toml', 'pubspec-yaml']);
      const usedInCode = new Set<string>();
      for (const entry of planEntries) {
        for (const pp of entry.plan?.prescribedPackages || []) {
          if (pp.usedBy?.some((u: string) => !depManifestNames.has(u))) {
            usedInCode.add(pp.package);
          }
        }
      }
      const emptyApisInCode = new Set<string>();
      for (const entry of planEntries) {
        for (const pp of entry.plan?.prescribedPackages || []) {
          if (pp.usedBy?.some((u: string) => !depManifestNames.has(u)) && (!pp.apis || pp.apis.length === 0)) {
            emptyApisInCode.add(pp.package);
          }
        }
      }
      if (emptyApisInCode.size > 0) {
        console.warn(
          `⚠️  [PackageCoverage] Packages used in code but with empty apis (likely import-only, no real API calls): ${[...emptyApisInCode].join(', ')}`,
        );
      }
      const missing = state.designDocUnknownPackages.filter(p => !usedInCode.has(p));
      if (missing.length > 0) {
        console.warn(
          `⚠️  [PackageCoverage] Design-prescribed packages with no code usage across all tasks: ${missing.join(', ')}\n` +
          `   These packages were declared in dependency manifests but no feature task included them in prescribedPackages with actual code modules.`,
        );
      } else {
        console.log(`✅ [PackageCoverage] All ${state.designDocUnknownPackages.length} design-prescribed packages have code usage`);
      }
    } catch {
      // Plan file may not exist (e.g., resumed job with pre-existing plans)
    }
  }

  // ✅ Log parallel_complete event to debug/logs/
  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger: getExecLog } = await import('../../../../core/utils/executionLogger');
    const execLog = getExecLog({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    execLog.logParallelComplete({
      taskIds: result.completedTasks.map((t: any) => t.id),
      elapsedMs: Date.now() - parallelStartTime,
    }).catch(() => {});
  }
  if (result.failedTasks.length > 0) {
    for (const f of result.failedTasks) {
      console.error(`   ❌ FAILED: "${f.task.name}" (id=${f.task.id}) — ${f.error.message}`);
    }
  }
  if (result.drainReason) {
    console.log(`   Drain reason: ${result.drainReason}`);
  }

  // Mark job timing as paused so resume calculates accurate totalPausedDuration
  const hasActualRemainingWork = result.remainingQueue.length > 0 || result.failedTasks.length > 0;
  if ((result.hasInterruptedTasks && hasActualRemainingWork) || result.hasFailures) {
    state.jobTiming = JobTimingManager.pauseJob(state.jobTiming);
  }

  // ✅ If any tasks were paused due to recursion limit AND there are actually
  // remaining tasks, save interrupted state for resume.
  // IMPORTANT: If interrupted tasks were retried and completed (hasInterruptedTasks
  // cleared by reportCompletion), this block is skipped entirely — no stale interruption.
  // Even if hasInterruptedTasks is still true (edge case), only save if remainingQueue > 0.
  if (result.hasInterruptedTasks && hasActualRemainingWork && state.deps?.session && state.context.featureFolder) {
    try {
      const failedAsQueue = result.failedTasks.map(f => ({
        ...f.task,
        _failed: true,
        _failureReason: f.error.message,
      }));

      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'code',
        {
          state: {
            taskQueue: [...failedAsQueue, ...result.remainingQueue],
            completedTasks: result.completedTasks.map(t => t.id),
            completedTasksDetails: result.completedTasks,
            failedTasks: result.failedTasks.map(f => ({
              taskId: f.task.id,
              taskName: f.task.name,
              error: f.error.message,
              timestamp: f.timestamp,
            })),
            tokenUsage: result.tokenUsage,
            estimatingTokenUsage: state._estimatingTokenUsage,
            jobId: state.jobId,
            jobTiming: state.jobTiming,
            parallelMode: true,
            interruption: {
              reason: (result.interruptReason || 'recursion_limit') as InterruptionReason,
              message: `Job interrupted: ${result.interruptReason || 'recursion_limit'} (${result.remainingQueue.length} task(s) remaining)`,
              timestamp: new Date().toISOString(),
              canResume: true,
            },
          },
        },
      );
      console.log(`💾 [ParallelOrchestrator] Saved interrupted state (recursion limit, ${result.remainingQueue.length} tasks remaining for resume)`);
    } catch (err) {
      console.warn(`⚠️ [ParallelOrchestrator] Failed to save interrupted state:`, err);
    }
  } else if (result.hasInterruptedTasks && !hasActualRemainingWork) {
    // ✅ All interrupted tasks were retried and completed — clear any stale interruption
    // from earlier checkpoints so cleanupJobState doesn't create a spurious "Task cancelled" card.
    console.log(`💾 [ParallelOrchestrator] All interrupted tasks resolved (0 remaining) — clearing stale interruption from session`);
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'code',
          {
            state: {
              completedTasks: result.completedTasks.map(t => t.id),
              completedTasksDetails: result.completedTasks,
              tokenUsage: result.tokenUsage,
              estimatingTokenUsage: state._estimatingTokenUsage,
              jobId: state.jobId,
              jobTiming: state.jobTiming,
              parallelMode: true,
              interruption: undefined,
            },
          },
        );
      } catch (err) {
        console.warn(`⚠️ [ParallelOrchestrator] Failed to clear stale interruption:`, err);
      }
    }
  }

  // ✅ If any tasks permanently failed (non-recursion-limit), save interrupted state.
  // Failed tasks go back to the queue with a _failed flag for visibility.
  if (result.hasFailures && !result.hasInterruptedTasks && state.deps?.session && state.context.featureFolder) {
    try {
      // Put failed tasks back into the queue (marked as failed) for UI display
      const failedAsQueue = result.failedTasks.map(f => ({
        ...f.task,
        _failed: true,
        _failureReason: f.error.message,
      }));

      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'code',
        {
          state: {
            taskQueue: [...failedAsQueue, ...result.remainingQueue],
            completedTasks: result.completedTasks.map(t => t.id),
            completedTasksDetails: result.completedTasks,
            failedTasks: result.failedTasks.map(f => ({
              taskId: f.task.id,
              taskName: f.task.name,
              error: f.error.message,
              timestamp: f.timestamp,
            })),
            tokenUsage: result.tokenUsage,
            estimatingTokenUsage: state._estimatingTokenUsage,
            jobId: state.jobId,
            jobTiming: state.jobTiming,
            parallelMode: true,
            interruption: {
              reason: 'tasks_failed',
              message: [
                `${result.failedTasks.length} task(s) failed during parallel execution`,
                ...result.failedTasks.map(f => `- "${f.task.name}": ${f.error.message}`),
              ].join('\n'),
              timestamp: new Date().toISOString(),
              canResume: true,
            },
          },
        },
      );
      console.log(`💾 [ParallelOrchestrator] Saved interrupted state (${result.failedTasks.length} failed tasks)`);
    } catch (err) {
      console.warn(`⚠️ [ParallelOrchestrator] Failed to save interrupted state:`, err);
    }
  }

  return {
    completedTasks: result.completedTasks.map(t => t.id),
    completedTasksDetails: result.completedTasks,
    failedTasks: result.failedTasks.map(f => f.task) as any,
    currentTask: undefined,
    tokenUsage: result.tokenUsage || state.tokenUsage,
    interruption: result.hasInterruptedTasks ? {
      reason: result.interruptReason || 'recursion_limit',
      message: result.interruptReason === 'user_stopped'
        ? `Task stopped by user (${result.remainingQueue.length} task(s) remaining)`
        : `Job interrupted: ${result.interruptReason || 'recursion_limit'} (${result.remainingQueue.length} task(s) remaining)`,
      timestamp: new Date().toISOString(),
      canResume: result.remainingQueue.length > 0,
      metadata: {
        tasksRemaining: result.remainingQueue.length,
        completedCount: result.completedTasks.length,
      },
    } : result.hasFailures ? {
      reason: 'tasks_failed',
      message: [
        `${result.failedTasks.length} task(s) failed during parallel execution`,
        ...result.failedTasks.map(f => `- "${f.task.name}": ${f.error.message}`),
      ].join('\n'),
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        failedCount: result.failedTasks.length,
        completedCount: result.completedTasks.length,
        tasksRemaining: result.failedTasks.length + result.remainingQueue.length,
      },
    } : undefined,
  } as any;
}

const ArchitectCodeGraphStateAnnotation = Annotation.Root({
      ...DetectableFields,

      // Job-specific fields (not in common chain)
      workspaceConfig: Annotation<any>,
      gitPort: Annotation<any>,
      artifacts: Annotation<any>,
      techTier: Annotation<any>,
      selectedDesignFiles: Annotation<any>,
      decomposeFilePaths: Annotation<any>,
      code: Annotation<any>,
      codeHead: Annotation<any>,
      profile: Annotation<any>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
      }),
      runtimeAssetsIndex: Annotation<any>,
      projectCodeContext: Annotation<any>,
      referenceCodeContexts: Annotation<any>,
      sessionContext: Annotation<any>,
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
      selectedSpec: Annotation<any>,
      referenceRequests: Annotation<any>,
      designDocUnknownPackages: Annotation<any>,
      branch: Annotation<any>,
      filesWritten: Annotation<any>,
      reportFile: Annotation<any>,
      directives: Annotation<any>,
      _errorIsRepeating: Annotation<any>,
      _currentTaskTokenUsage: Annotation<any>,
      _estimatingTokenUsage: Annotation<any>,
      _executeCallIndex: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => 0,
      }),
      _finalTaskLoopCount: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => 0,
      }),
      _verificationTracker: Annotation<any>,
      commandHistory: Annotation<any>,
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
      figmaAvailable: Annotation<any>,
      figmaFileKey: Annotation<any>,
      figmaStartNodeId: Annotation<any>,
      boundary: Annotation<any>,
      jobConversation: Annotation<any>,
      awaitingDecomposeClarify: Annotation<any>,
      workerId: Annotation<any>,
      _isStopRequested: Annotation<any>,
      _depFileHash: Annotation<any>,
      _batchSplitRequeued: Annotation<any>,
      verifiedTasks: Annotation<any>,
});

export function buildCodeGraph() {
  const graph = new StateGraph(ArchitectCodeGraphStateAnnotation);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Node Registration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addNode("resolve", createResolveNode(codeResolveStrategy) as any);
  graph.addNode("triage", triage as any);
  graph.addNode('detect', createDetectNode(codeDetectStrategy) as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("revise", revise as any);  // ✅ Task queue revision (continue/modify)
  graph.addNode("plan", plan as any);
  graph.addNode("execute", execute as any);
  graph.addNode("tool", tool as any);
  graph.addNode("checkTaskStatus", checkTaskStatus as any);
  graph.addNode("enforce", enforce as any);
  graph.addNode("learn", learn as any);
  graph.addNode("parallelOrchestrator", parallelOrchestrator as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Resolve → Router (4-way: isResume x hasTaskQueue x hasResolvedAction x overrideDirective)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addConditionalEdges(
    "resolve" as any,
    routing.routeAfterResolve as any,
    {
      triage: "triage",
      revise: "revise",
      plan: "plan",
      parallelOrchestrator: "parallelOrchestrator",
      decompose: "decompose",
      detect: "detect"
    } as any
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Triage → detect or end
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addConditionalEdges(
    "triage" as any,
    routeAfterTriage as any,
    {
      detect: "detect",
      revise: "revise",
      __end__: "__end__"
    } as any
  );
  
  graph.addEdge("detect" as any, "decompose" as any);
  
  // ✅ Decompose → conditional: clarify pause, parallel, or sequential
  graph.addConditionalEdges(
    "decompose" as any,
    routing.routeAfterDecompose as any,
    { __end__: "__end__", parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // ✅ ParallelOrchestrator → learn (after all tasks are done)
  graph.addEdge("parallelOrchestrator" as any, "learn" as any);
  
  // ✅ Revise → conditional: parallel or sequential (same logic)
  graph.addConditionalEdges(
    "revise" as any,
    routing.routeAfterRevise as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // Plan → Router (batch split → checkTaskStatus, tool_calls → tool, else → execute)
  graph.addConditionalEdges(
    "plan" as any,
    routeAfterPlan as any,
    { tool: "tool", execute: "execute", checkTaskStatus: "checkTaskStatus" } as any
  );

  // Execute → Router (tool / checkTaskStatus / execute / plan)
  graph.addConditionalEdges(
    "execute" as any,
    routeAfterExecute as any,
    {
      tool: "tool",
      checkTaskStatus: "checkTaskStatus",
      execute: "execute",
      plan: "plan",   // verification task execute done → plan re-verify
    } as any
  );

  // Tool → Router (plan exploring then plan, else execute)
  graph.addConditionalEdges(
    "tool" as any,
    routeAfterTool as any,
    { plan: "plan", execute: "execute" } as any
  );

  // checkTaskStatus: 태스크 완료 상태 확인 및 라우팅
  // All task types: execute(done) → checkTaskStatus
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    routing.routeAfterCheckTaskStatus as any,
    { enforce: "enforce", learn: "learn" } as any
  );

  // ✅ KEY CHANGE: Enforce → Plan (not Execute)
  // This allows the agent to re-analyze the problem and create a better strategy
  graph.addEdge("enforce" as any, "plan" as any);
  
  // ✅ Learn node routing - continue to next task or end
  // Universal rule: if orchestrator set an interruption (task failure, recursion limit,
  // user stop), respect the decision and stop. Queue data is preserved for resume.
  graph.addConditionalEdges(
    "learn" as any,
    routing.routeAfterLearn as any,
    { plan: "plan", __end__: "__end__" } as any
  );
  
  // Note: Using manual checkpoint saves instead of LangGraph's built-in checkpointer
  // because it requires thread_id management which complicates the API
  
  // ✅ DON'T set recursionLimit here - it's set in runner.ts invoke() call
  // LangGraph RunnableConfig uses camelCase: recursionLimit (NOT snake_case recursion_limit)
  // Default is 25 if not specified - see @langchain/core/runnables/types.d.ts
  return (graph as any).compile();
}
