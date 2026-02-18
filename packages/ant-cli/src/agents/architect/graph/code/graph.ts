import path from 'node:path';
import { StateGraph, END } from "@langchain/langgraph";
import { ArchitectGraphState, TASK_PRIORITIES, TaskTimingHelper, ViolationType } from "./state";
import { CodeTask } from "../../types/task";
import { resolve } from "./nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";  // ✅ Triage System
import { detectEnvironment } from "./nodes/detectEnvironment/index";
import { decompose } from "./nodes/decompose";
import { plan } from "./nodes/plan";
import { codeGen } from "./nodes/codeGen/index";
import { tool } from "./nodes/tool";
// import { validate } from "./nodes/validate";  // ✅ REMOVED: Static validation no longer needed (prompts handle it)
import { installDeps } from "./nodes/installDeps";
import { runtimeValidate } from "./nodes/runtimeValidate";
import { enforce } from "./nodes/enforce";
import { learn } from "./nodes/learn";
import { routeAfterCodeGen } from "./routers/codeGenRouter";
import { saveCheckpoint } from "./nodes/checkpoint";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from "./parallel/types";

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
  
  const hasViolations = (violations && violations.length > 0);
  
  // ✅ CRITICAL: Check if user has requested a stop before marking task as completed.
  // Without this, a cancelled job can still mark the current task as "completed"
  // if checkTaskStatus runs after the cancellation signal but before process termination.
  const isStopRequested = typeof (state as any)._isStopRequested === 'function'
    ? (state as any)._isStopRequested()
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

  if (!hasViolations && state.currentTask) {
    // ✅ Task succeeded - mark as completed and record timing & token usage
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../common/graph/llmHelpers');
    const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
    
    // Gather token usage from llmResponse (codeGen) and accumulated task tokens (plan)
    const codeGenTokenUsage = state.llmResponse?.tokenUsage;
    const planTokenUsage = getTaskTokenUsage(state as any);
    
    // Merge all token sources
    let taskTokenUsage = state.currentTask.tokenUsage;
    
    if (codeGenTokenUsage) {
      if (taskTokenUsage) {
        accumulateTokenUsage({ tokenUsage: taskTokenUsage } as any, codeGenTokenUsage, { taskLevel: false, jobLevel: false });
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
    
    // Accumulate to job-level
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
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
        llmCallCount: state._codeGenCallIndex || 0,
      }).catch(() => {});
    }
    
    // ✅ CRITICAL: Clear conversation history for next task
    // Each task should start fresh without previous task's conversation
    state.conversationHistory = [];
    state._codeGenCallIndex = 0;
    console.log(`🧹 [checkTaskStatus] Cleared conversation history for next task`);
    
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
    
    // If error task completed, remove remaining error tasks (likely auto-resolved)
    if (state.currentTask.type === 'error' && state.taskQueue) {
      const errorCount = state.taskQueue.getAll().filter((t: CodeTask) => t.type === 'error').length;
      if (errorCount > 0) {
        console.log(`🧹 Removing ${errorCount} remaining error task(s) from queue (likely auto-resolved)`);
        state.taskQueue.removeType('error');
        
        // Check if Final Verification already exists in queue
        const hasFinalTask = state.taskQueue.getAll().some((t: CodeTask) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
        
        if (!hasFinalTask) {
          const finalTask: CodeTask = {
            id: `final-verification-recheck-${Date.now()}`,
            name: 'Final Verification (Recheck)',
            type: 'verification' as const,
            priority: TASK_PRIORITIES.FINAL_VERIFICATION,
            description: 'Re-verify all errors are resolved after error fixes',
          };
          state.taskQueue.push(finalTask);
          console.log(`📋 Re-added Final Verification to confirm all errors resolved\n`);
        } else {
          console.log(`📋 Final Verification already in queue - will execute after error tasks\n`);
        }
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
        (state as any).tokenUsage  // ✅ FIX: Pass job-level token usage to prevent badge reset
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
      conversationHistory: [],  // ✅ Clear for next task
      _codeGenCallIndex: 0,     // ✅ Reset call counter for next task
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
    detectionReport: state.detectionReport,
    decomposeKeywords: state.decomposeKeywords,
    selectedDesignFiles: state.selectedDesignFiles,
    decomposeFilePaths: state.decomposeFilePaths,
    prd: state.prd,
    directive: state.directive,
    design: state.design,
    designDocPath: state.designDocPath,
    designDocs: state.designDocs,
    code: state.code,
    codeHead: (state as any).codeHead,
    profile: state.profile,
    parsedUiDocs: state.parsedUiDocs,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    referenceCodeContexts: state.referenceCodeContexts,
    sessionContext: state.sessionContext,
    featureName: state.featureName,
    maxRetries: state.maxRetries || 3,
    recursionCount: state.recursionCount || 0,
    recursionLimit: state.recursionLimit,  // ✅ Always set by runner.ts from env RECURSION_LIMIT
    _httpJobId: state._httpJobId,
    _uiLocale: state._uiLocale,
    jobId: (state as any).jobId,
    jobTiming: (state as any).jobTiming,
    featureTasks: state.featureTasks,
    referenceRequests: state.referenceRequests,
    _sharedFileBuffer: sharedFileBuffer,
  };

  const graphBuilder = createCodeWorkerGraphBuilder();
  const orchestrator = new OrchestratorClass<CodeTask>(
    taskQueue,
    graphBuilder,
    sharedContext,
    {
      onTaskComplete: (task, workerId) => {
        console.log(`[ParallelOrchestrator] Worker ${workerId} completed: ${task.name}`);
      },
      onTaskFailure: (task, error, workerId) => {
        console.error(`[ParallelOrchestrator] Worker ${workerId} failed: ${task.name} - ${error.message}`);
      },
      onWorkerTerminate: (workerId) => {
        // ✅ Immediately clear this worker's stale entry from WorkflowBroadcaster.
        // Without this, the worker's last-active-node badge stays visible in the
        // workflow UI until ALL parallel workers finish (clearWorkers at line 474).
        if (state.deps?.workflowUpdate?.clearWorkers && state._httpJobId) {
          state.deps.workflowUpdate.clearWorkers(state._httpJobId, [workerId]).catch((err: Error) => {
            console.warn(`[ParallelOrchestrator] Failed to clear terminated worker ${workerId}:`, err.message);
          });
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
            await state.deps.session.updateArtifacts(
              state.context.project,
              state.context.featureFolder,
              'code',
              {
                state: {
                  taskQueue: checkpoint.taskQueue,
                  completedTasks: checkpoint.completedTasks.map(t => t.id),
                  completedTasksDetails: checkpoint.completedTasks,
                  // ✅ Persist failed tasks so they survive process termination
                  failedTasks: checkpoint.failedTasks.map(f => ({
                    taskId: f.task.id,
                    taskName: f.task.name,
                    error: f.error.message,
                    timestamp: f.timestamp,
                  })),
                  tokenUsage: checkpoint.tokenUsage,
                  // ✅ Preserve estimating phase token usage snapshot in checkpoint
                  estimatingTokenUsage: (state as any)._estimatingTokenUsage,
                  jobId: (state as any).jobId,
                  jobTiming: (state as any).jobTiming,
                  parallelMode: true,
                  // ✅ FIX: Preserve interruption details in checkpoint.
                  // onCheckpoint does a full replace of session.state. Without this,
                  // interruption info set by cleanupJobState would be lost when the
                  // child process writes its checkpoint after the API server.
                  ...(checkpoint.interruption ? {
                    interruption: {
                      reason: checkpoint.interruption.reason,
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
    },
    state.completedTasksDetails || [],  // Resume: pass previously completed tasks
  );

  // ✅ Log parallel_start event to debug/logs/
  const parallelStartTime = Date.now();
  if (state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
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

  // ✅ If any tasks were paused due to recursion limit AND there are actually
  // remaining tasks, save interrupted state for resume.
  // IMPORTANT: If interrupted tasks were retried and completed (hasInterruptedTasks
  // cleared by reportCompletion), this block is skipped entirely — no stale interruption.
  // Even if hasInterruptedTasks is still true (edge case), only save if remainingQueue > 0.
  const hasActualRemainingWork = result.remainingQueue.length > 0 || result.failedTasks.length > 0;
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
            completedTasks: [...(state.completedTasks || []), ...result.completedTasks.map(t => t.id)],
            completedTasksDetails: [...(state.completedTasksDetails || []), ...result.completedTasks],
            failedTasks: result.failedTasks.map(f => ({
              taskId: f.task.id,
              taskName: f.task.name,
              error: f.error.message,
              timestamp: f.timestamp,
            })),
            tokenUsage: result.tokenUsage,
            estimatingTokenUsage: (state as any)._estimatingTokenUsage,
            jobId: (state as any).jobId,
            jobTiming: (state as any).jobTiming,
            parallelMode: true,
            interruption: {
              reason: 'recursion_limit',
              message: `Task(s) paused: recursion limit reached during parallel execution (${result.remainingQueue.length} task(s) remaining)`,
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
              completedTasks: [...(state.completedTasks || []), ...result.completedTasks.map(t => t.id)],
              completedTasksDetails: [...(state.completedTasksDetails || []), ...result.completedTasks],
              tokenUsage: result.tokenUsage,
              estimatingTokenUsage: (state as any)._estimatingTokenUsage,
              jobId: (state as any).jobId,
              jobTiming: (state as any).jobTiming,
              parallelMode: true,
              interruption: null,  // ✅ Explicitly clear stale interruption
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
            completedTasks: [...(state.completedTasks || []), ...result.completedTasks.map(t => t.id)],
            completedTasksDetails: [...(state.completedTasksDetails || []), ...result.completedTasks],
            failedTasks: result.failedTasks.map(f => ({
              taskId: f.task.id,
              taskName: f.task.name,
              error: f.error.message,
              timestamp: f.timestamp,
            })),
            tokenUsage: result.tokenUsage,
            estimatingTokenUsage: (state as any)._estimatingTokenUsage,
            jobId: (state as any).jobId,
            jobTiming: (state as any).jobTiming,
            parallelMode: true,
            interruption: {
              reason: 'tasks_failed',
              message: `${result.failedTasks.length} task(s) failed during parallel execution`,
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
    tokenUsage: result.tokenUsage || (state as any).tokenUsage,
    interruption: result.hasInterruptedTasks ? {
      reason: 'recursion_limit',
      message: `Task(s) paused: recursion limit reached during parallel execution (${result.remainingQueue.length} task(s) remaining)`,
      timestamp: new Date().toISOString(),
      canResume: result.remainingQueue.length > 0,
      metadata: {
        tasksRemaining: result.remainingQueue.length,
        completedCount: result.completedTasks.length,
      },
    } : result.hasFailures ? {
      reason: 'tasks_failed',
      message: `${result.failedTasks.length} task(s) failed during parallel execution`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        failedCount: result.failedTasks.length,
        completedCount: result.completedTasks.length,
      },
    } : undefined,
  } as any;
}

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      workspaceConfig: null as any,
      isResume: null as any,  // ✅ Resume flag (API level)
      
      // Dependencies
      deps: null as any,
      gitPort: null as any,
      
      // ✅ CRITICAL: Detection Report (unified environment detection result)
      // Contains: jobMode, environment, profile, requireRag
      detectionReport: null as any,
      
      // Environment Detection outputs
      decomposeKeywords: null as any,
      selectedDesignFiles: null as any,
      decomposeFilePaths: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      designDocPath: null as any,  // ✅ Design document file path (from TaskArtifacts)
      designDocs: null as any,  // ✅ Structured design docs for environment detection
      code: null as any,
      codeHead: null as any,
      profile: {
        value: (x: any, y?: any) => y ?? x,
        default: () => undefined,
      } as any,
      parsedUiDocs: null as any,  // ✅ CRITICAL: Parsed UI docs for split injection (from TaskArtifacts)
      
      // ✅ Runtime Assets Index (for asset copying tasks)
      runtimeAssetsIndex: null as any,
      
      
      // ✅ Code Context (CRITICAL for file operations!)
      projectCodeContext: null as any,      // Main project code
      referenceCodeContexts: null as any,   // Reference projects
      sessionContext: null as any,          // Session context
      // Execution
      planText: {
        value: (x: string, y?: string) => y ?? x,  // ✅ FIX: Explicit reducer for state propagation
        default: () => '',
      } as any,
      codePrompt: null as any,
      rawResponse: null as any,
      responseSection: null as any,
      // ✅ REMOVED: files (replaced by projectCodeContext.files)
      filesToDelete: null as any,
      modifications: null as any,
      featureName: null as any,          // Feature name for buffer manager
      
      // Integrations & Validation
      requiredIntegrations: null as any,
      violations: null as any,
      fileErrors: null as any,  // ✅ CRITICAL: File operation errors for self-healing
      retries: null as any,
      maxRetries: null as any,
      runtimeValidationResult: null as any,
      
      // Progress tracking
      lastViolations: null as any,
      previousFileCount: null as any,
      
      // Attempt history
      previousAttempts: null as any,
      
      // Enforcement feedback history
      enforcementHistory: null as any,
      
      // Task Queue System
      taskQueue: null as any,
      currentTask: null as any,
      featureTasks: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,  // ✅ Full task objects for completed tasks
      resolvedCategories: null as any,
      
      // ✅ Job tracking (for timing and continuity)
      jobId: null as any,
      jobTiming: null as any,
      
      // Error Handling & Final Verification
      failedTasks: null as any,
      unresolvedErrors: null as any,
      
      // Evaluation & Learning
      evaluationReport: null as any,
      lessons: null as any,
      
      // Reference Projects (for cross-project tool calling)
      referenceRequests: null as any,
      
      // Results
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
      
      // Real-time Kanban tracking
      _httpJobId: null as any,  // ✅ HTTP task ID for live updates
      _phaseTimings: null as any,  // ✅ Per-node timing for phaseBreakdown
      _uiLocale: null as any,     // ✅ UI locale (ko/en) from directive
      
      
      // ✅ Revise Support
      directives: null as any,       // Multiple directives
      // ✅ Chat integration
      overrideDirective: null as any,  // ✅ Chat input as directive (highest priority)
      chatSource: null as any,  // ✅ Flag for Chat SSE
      
      // ✅ Triage System
      skipTriage: null as any,       // Skip triage if true
      triageResult: null as any,     // Triage analysis result
      workspaceState: null as any,   // Workspace state snapshot
      currentAgent: null as any,     // Current agent name
      currentJob: null as any,       // Current job name
      
      // ✅ Error repetition tracking
      _errorIsRepeating: null as any,  // Flag to indicate if errors are repeating
      
      // ✅ Token tracking (internal, accumulated across LLM calls)
      _currentTaskTokenUsage: null as any,  // Task-level token usage (reset per task)
      tokenUsage: null as any,              // Job-level token usage (accumulated across all tasks + decompose)
      
      // ✅ codeGen call counter (per task, reset in checkTaskStatus)
      _codeGenCallIndex: {
        value: (_prev: number, next: number) => next,
        default: () => 0,
      } as any,

      // Recursion tracking
      recursionCount: null as any,  // ✅ Current iteration count
      recursionLimit: null as any,  // ✅ Maximum allowed iterations
      
      // ✅ NEW: Tool Calling support
      llmResponse: null as any,     // LLM response (thinking, text, tool calls)
      toolResults: null as any,     // Tool execution results
      conversationHistory: null as any,  // Multi-turn conversation
      interruption: null as any,         // Interruption details
    } as any,
  } as any);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Node Registration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addNode("resolve", resolve as any);
  graph.addNode("triage", triage as any);
  graph.addNode("detectEnvironment", detectEnvironment as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("revise", revise as any);  // ✅ Task queue revision (continue/modify)
  graph.addNode("plan", plan as any);
  graph.addNode("codeGen", codeGen as any);
  graph.addNode("tool", tool as any);
  graph.addNode("installDeps", installDeps as any);
  graph.addNode("runtimeValidate", runtimeValidate as any);
  graph.addNode("checkTaskStatus", checkTaskStatus as any);
  graph.addNode("enforce", enforce as any);
  graph.addNode("learn", learn as any);
  graph.addNode("parallelOrchestrator", parallelOrchestrator as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Resolve → Router (4-way: isResume x hasTaskQueue x hasDetectionReport x overrideDirective)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addConditionalEdges(
    "resolve" as any,
    ((state: ArchitectGraphState) => {
      const isResume = state.isResume === true;
      const hasTaskQueue = state.taskQueue && !state.taskQueue.isEmpty();
      const hasDetectionReport = !!state.detectionReport;
      const hasNewDirective = !!state.overrideDirective;
      
      console.log(`[RouteAfterResolve] isResume=${isResume}, hasTaskQueue=${hasTaskQueue}, hasDetectionReport=${hasDetectionReport}, hasNewDirective=${hasNewDirective}`);
      
      if (!isResume) {
        // New job → always start with triage
        console.log(`[RouteAfterResolve] New job → triage`);
        return 'triage';
      }
      
      // === isResume === true ===
      
      if (hasTaskQueue && hasNewDirective) {
        // Resume with existing tasks + new chat input → revise (may modify tasks)
        console.log(`[RouteAfterResolve] Resume + new directive → revise`);
        return 'revise';
      }
      
      if (hasTaskQueue) {
        // Plain resume with existing tasks
        const queueSize = state.taskQueue?.size?.() || 0;
        const completedCount = state.completedTasks?.length || 0;
        const concurrency = getTaskConcurrency();
        if (concurrency > 1) {
          console.log(`[RouteAfterResolve] Plain resume: ${queueSize} tasks, ${completedCount} completed, concurrency=${concurrency} → parallelOrchestrator`);
          return 'parallelOrchestrator';
        }
        console.log(`[RouteAfterResolve] Plain resume: ${queueSize} tasks, ${completedCount} completed → plan`);
        return 'plan';
      }
      
      if (hasDetectionReport) {
        // Interrupted after detectEnvironment but before decompose
        // Route through detectEnvironment again (LLM skip, pass-through only)
        // Then detectEnvironment → decompose → plan via hardcoded edges
        console.log(`[RouteAfterResolve] Resume after detectEnv → detectEnvironment (LLM skip, pass-through)`);
        return 'detectEnvironment';
      }
      
      // Interrupted very early (before detectEnvironment) → start from triage
      console.log(`[RouteAfterResolve] Resume (no tasks, no detection) → triage`);
      return 'triage';
    }) as any,
    {
      triage: "triage",
      revise: "revise",
      plan: "plan",
      parallelOrchestrator: "parallelOrchestrator",
      decompose: "decompose",
      detectEnvironment: "detectEnvironment"
    } as any
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Triage → detectEnvironment or end
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addConditionalEdges(
    "triage" as any,
    routeAfterTriage as any,
    {
      detectEnvironment: "detectEnvironment",
      __end__: "__end__"
    } as any
  );
  
  graph.addEdge("detectEnvironment" as any, "decompose" as any);
  
  // ✅ Decompose → conditional: parallel or sequential
  graph.addConditionalEdges(
    "decompose" as any,
    ((s: ArchitectGraphState) => {
      const concurrency = getTaskConcurrency();
      if (concurrency > 1) {
        console.log(`[Decompose→Router] ANT_TASK_CONCURRENCY=${concurrency} → parallelOrchestrator`);
        return "parallelOrchestrator";
      }
      console.log(`[Decompose→Router] ANT_TASK_CONCURRENCY=1 → sequential plan`);
      return "plan";
    }) as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // ✅ ParallelOrchestrator → learn (after all tasks are done)
  graph.addEdge("parallelOrchestrator" as any, "learn" as any);
  
  // ✅ Revise → conditional: parallel or sequential (same logic)
  graph.addConditionalEdges(
    "revise" as any,
    ((s: ArchitectGraphState) => {
      const concurrency = getTaskConcurrency();
      if (concurrency > 1) {
        return "parallelOrchestrator";
      }
      return "plan";
    }) as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // Plan → CodeGen
  graph.addEdge("plan" as any, "codeGen" as any);
  
  // ✅ CodeGen → Router (tool call 체크 & priority 기반 분기)
  graph.addConditionalEdges(
    "codeGen" as any,
    routeAfterCodeGen as any,
    {
      tool: "tool",                     // Tool call 있으면 → tool 노드
      checkTaskStatus: "checkTaskStatus",  // Done (non-final) → checkTaskStatus
      installDeps: "installDeps",       // Done (final task) → installDeps
      codeGen: "codeGen",               // 재추론 (드물음)
    } as any
  );
  
  // ✅ Tool → CodeGen (unconditional - LLM handles all tool results including errors)
  // Tool errors are passed to LLM via conversation history as tool_result with error field
  // LLM decides whether to retry, try alternative approach, or handle the error
  graph.addEdge("tool" as any, "codeGen" as any);

  // ✅ REMOVED: validate 노드 관련 로직 제거
  // - Static validation (ellipsis, excessive deletion)은 프롬프트로 충분히 제어
  // - Runtime validation (build)만 final task에서 실행

  // ✅ Final task: installDeps → runtimeValidate
  graph.addEdge("installDeps" as any, "runtimeValidate" as any);

  // ✅ Final task: runtimeValidate → checkTaskStatus
  graph.addEdge("runtimeValidate" as any, "checkTaskStatus" as any);

  // ✅ checkTaskStatus: 태스크 완료 상태 확인 및 라우팅
  // - Non-final tasks: codeGen → checkTaskStatus (직접)
  // - Final task: codeGen → installDeps → runtimeValidate → checkTaskStatus
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0);
      
      if (!hasViolations) {
  // ✅ Task succeeded - ALWAYS go to learn for incremental lesson extraction
      return "learn";
    }
    
    // Has violations - check if we should retry
      if (s.retries < s.maxRetries) {
        return "enforce";
      }
      
      // Exceeded retries
      console.log(`⚠️  Task "${s.currentTask?.name}" exhausted retries (${s.retries}/${s.maxRetries})`);
      console.log(`   Plan node will create error task and move to next task\n`);
      return "enforce";  // ← Let plan handle retry limit logic
    }) as any,
    { enforce: "enforce", learn: "learn" } as any
  );

  // ✅ KEY CHANGE: Enforce → Plan (not Execute)
  // This allows the agent to re-analyze the problem and create a better strategy
  graph.addEdge("enforce" as any, "plan" as any);
  
  // ✅ NEW: Learn node routing - continue to next task or end
  graph.addConditionalEdges(
    "learn" as any,
    ((s: ArchitectGraphState) => {
      // Check if more tasks exist in queue
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        console.log(`\n📋 [Learn] More tasks in queue (${s.taskQueue.size()} remaining) → continuing to plan\n`);
        return "plan";  // ← Next task
      } else {
        console.log(`\n✅ [Learn] All tasks completed! Workflow finished.\n`);
        return "__end__";  // ← All done
      }
    }) as any,
    { plan: "plan", __end__: "__end__" } as any
  );
  
  // Note: Using manual checkpoint saves instead of LangGraph's built-in checkpointer
  // because it requires thread_id management which complicates the API
  
  // ✅ DON'T set recursionLimit here - it's set in runner.ts invoke() call
  // LangGraph RunnableConfig uses camelCase: recursionLimit (NOT snake_case recursion_limit)
  // Default is 25 if not specified - see @langchain/core/runnables/types.d.ts
  return (graph as any).compile();
}
