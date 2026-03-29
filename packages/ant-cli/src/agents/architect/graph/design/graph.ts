import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { DesignTask } from "../../types/task";
import { resolve } from "./nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";  // ✅ Triage System
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen/index";  // ✅ XML streaming + immediate file writes
import { tool } from "./nodes/tool";  // ✅ Tool execution node (for UI Design multimodal)
import { learn } from "./nodes/learn";
import { detectEnvironment } from "./nodes/detectEnvironment";
import { figmaExplore } from "./nodes/figmaExplore";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from "../code/parallel/types";
import { routeAfterDocGen } from "./routers/docGenRouter";
import path from "node:path";

const INTERNAL_MARKER_RE = /\n?<!-- (?:SECTION_PATTERN|LAST_SECTION)[^>]*-->\s*/g;

async function stripInternalMarkers(
  fileSystem: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void> },
  featurePath: string,
  targetFile: string,
): Promise<void> {
  try {
    const filePath = path.join(featurePath, 'outputs', 'design', targetFile);
    const content = await fileSystem.readFile(filePath);
    const cleaned = content.replace(INTERNAL_MARKER_RE, '');
    if (cleaned !== content) {
      await fileSystem.writeFile(filePath, cleaned.trimEnd() + '\n');
      console.log(`🧹 [checkTaskStatus] Stripped internal markers from ${targetFile}`);
    }
  } catch {
    // File may not exist yet (e.g., task was skipped), ignore
  }
}

function extractAllSrcFields(obj: any): string[] {
  const srcs: string[] = [];
  if (!obj || typeof obj !== 'object') return srcs;
  if (Array.isArray(obj)) {
    for (const item of obj) srcs.push(...extractAllSrcFields(item));
  } else {
    if (typeof obj.src === 'string') srcs.push(obj.src);
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') srcs.push(...extractAllSrcFields(obj[key]));
    }
  }
  return srcs;
}

async function validateAssetReferences(state: DesignGraphState): Promise<{
  valid: boolean;
  missingFiles: string[];
  totalRefs: number;
}> {
  const featurePath = state.context.featurePath;
  const fs = await import('fs/promises');

  const uiAssetsPath = path.join(featurePath, 'outputs', 'design', 'ui-assets.json');
  try {
    const content = await fs.readFile(uiAssetsPath, 'utf-8');
    const parsed = JSON.parse(content);
    const srcPaths = extractAllSrcFields(parsed);
    const missing: string[] = [];

    for (const src of srcPaths) {
      const absPath = path.join(featurePath, src);
      try { await fs.access(absPath); } catch { missing.push(src); }
    }

    return { valid: missing.length === 0, missingFiles: missing, totalRefs: srcPaths.length };
  } catch {
    return { valid: true, missingFiles: [], totalRefs: 0 };
  }
}

/**
 * Check task status and handle completion
 * Routes to plan (next task) or learn (all done)
 * 
 * This MUST be a node (not a router) because it mutates state.
 * Consistent with code job's checkTaskStatus node.
 */
async function checkTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (track node execution for UI gauge)
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
      state._httpJobId, 'checkTaskStatus', 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }
  
  // ✅ CALL LIMIT INTERRUPTION: task force-stopped by call budget
  if ((state as any)._callLimitReached && state.currentTask) {
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../common/graph/llmHelpers');
    
    const taskTokenUsage = getTaskTokenUsage(state as any);
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
    const pausedTask = TaskTimingHelper.pauseTask(state.currentTask);
    (pausedTask as any).interrupted = true;
    
    const callIndex = state._docGenCallIndex || 0;
    console.warn(`⚠️  [checkTaskStatus] Call limit reached for "${state.currentTask.name}" (${callIndex} calls) — creating interruption`);
    
    const { TaskQueue: TQ } = await import('../../types/task');
    const newQueue = new TQ<DesignTask>();
    newQueue.push(pausedTask);
    state.taskQueue?.getAll().forEach((t: any) => {
      if (t.id !== state.currentTask!.id) newQueue.push(t);
    });
    
    const interruption = {
      reason: 'call_limit' as const,
      message: `Task "${state.currentTask.name}" paused: call budget exhausted (${callIndex} calls). Resume to continue.`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        callLimit: callIndex,
        tasksRemaining: newQueue.size(),
        completedCount: (state.completedTasks || []).length,
      }
    };
    
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              taskQueue: newQueue.getAll(),
              completedTasks: state.completedTasks || [],
              completedTasksDetails: state.completedTasksDetails || [],
              currentTask: undefined,
              planText: state.planText,
              conversationHistory: state.conversationHistory || [],
              files: state.files || [],
              filesToDelete: state.filesToDelete || [],
              jobId: (state as any).jobId,
              jobTiming: (state as any).jobTiming,
              tokenUsage: (state as any).tokenUsage,
              overrideDirective: state.overrideDirective,
              chatSource: state.chatSource,
              detectionReport: state.detectionReport,
              uiDesignSource: state.uiDesignSource,
              figmaConfig: state.figmaConfig,
              interruption,
            }
          }
        );
        console.log(`💾 [checkTaskStatus] Interruption checkpoint saved (${(state.completedTasks || []).length} completed, ${newQueue.size()} remaining)\n`);
      } catch (error) {
        console.warn(`[checkTaskStatus] ⚠️  Failed to save interruption checkpoint:`, error);
      }
    }
    
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        null,
        newQueue.getAll(),
        state.completedTasksDetails || [],
        state.recursionCount,
        state.recursionLimit,
        (state as any).tokenUsage
      );
    }
    
    console.log(`⏸️  [checkTaskStatus] Task paused. ${(state.completedTasks || []).length} completed, ${newQueue.size()} remaining`);
    
    return {
      currentTask: undefined,
      taskQueue: newQueue,
      _callLimitReached: false,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
      _toolResultCache: undefined,
      fileErrors: undefined,
      interruption,
      tokenUsage: (state as any).tokenUsage,
      _assetValidationFailed: false,
      _assetValidationRetried: 0,
    } as any;
  }
  
  // ✅ FILE ERRORS: Log warnings but don't block in sequential mode
  // (Sequential mode doesn't throw — fileErrors are logged for diagnostics.
  //  In parallel mode, workerCheckTaskStatus throws for proper failure handling.)
  if (state.fileErrors && state.fileErrors.length > 0 && state.currentTask) {
    console.warn(`⚠️  [checkTaskStatus] ${state.fileErrors.length} file error(s) for "${state.currentTask.name}":`);
    for (const err of state.fileErrors) {
      console.warn(`   - ${err.substring(0, 200)}`);
    }
  }

  // Asset validation gate: verify all src paths exist before completing ui-assets tasks
  if (state.currentTask?.id.startsWith('ui-assets-')
      && (state._assetValidationRetried || 0) >= 2) {
    console.warn(`⚠️  [checkTaskStatus] Asset validation retry limit reached (${state._assetValidationRetried}). Proceeding with incomplete assets.`);
  }
  if (state.currentTask?.id.startsWith('ui-assets-')
      && (state._assetValidationRetried || 0) < 2) {
    const validation = await validateAssetReferences(state);
    if (!validation.valid) {
      console.warn(`⚠️  [checkTaskStatus] Asset validation failed: ${validation.missingFiles.length}/${validation.totalRefs} not downloaded:`);
      for (const f of validation.missingFiles) console.warn(`   - ${f}`);

      const retryMessage = {
        role: 'user' as const,
        content: `VALIDATION FAILED: ${validation.missingFiles.length} assets referenced in ui-assets.json are not downloaded:\n${
          validation.missingFiles.map(f => `- ${f}`).join('\n')
        }\n\nDownload the missing assets and update the document. Every src path MUST exist as a local file.`,
      };

      return {
        conversationHistory: [...(state.conversationHistory || []), retryMessage],
        _assetValidationFailed: true,
        _assetValidationRetried: (state._assetValidationRetried || 0) + 1,
        _docGenCallIndex: 0,
        _noOutputCallCount: 0,
        _callLimitReached: false,
      };
    }
  }
  
  // ✅ Current task completed successfully
  if (state.currentTask) {
    // ✅ Get helpers
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../common/graph/llmHelpers');
    
    // ✅ Get task-level token usage
    const taskTokenUsage = getTaskTokenUsage(state as any);
    
    // ✅ Complete task with timing and token usage
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    
    // ✅ Accumulate task tokens into job-level tokenUsage
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
    // ✅ Log completion
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
      if (completedTask.tokenUsage) {
        console.log(`   Tokens: ${completedTask.tokenUsage.totalTokens} total (${completedTask.tokenUsage.inputTokens} in, ${completedTask.tokenUsage.outputTokens} out)`);
      }
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    // ✅ Log task_complete to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
      try {
        const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
        const execLogger = getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'design',
        });
        await execLogger.logTaskComplete(completedTask.id, {
          taskName: completedTask.name,
          elapsedMs: completedTask.timing?.elapsedTime || 0,
          inputTokens: taskTokenUsage?.inputTokens || 0,
          outputTokens: taskTokenUsage?.outputTokens || 0,
          cacheReadTokens: taskTokenUsage?.cacheReadTokens || 0,
          cacheCreationTokens: taskTokenUsage?.cacheCreationTokens || 0,
          llmCallCount: state._docGenCallIndex || 0,
        });
      } catch (_) { /* non-critical */ }
    }
    
    // ✅ CRITICAL: Create NEW arrays (immutable update pattern for LangGraph)
    const completedTasks = [...(state.completedTasks || []), completedTask.id];
    const completedTasksDetails = [...(state.completedTasksDetails || []), completedTask];
    
    console.log(`[checkTaskStatus] 💾 Task completion details saved:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      totalCompleted: completedTasksDetails.length
    });
    
    // Strip internal markers from output file when last chapter for a document completes
    const taskForMarkers = state.currentTask as any;
    if (taskForMarkers?.isLastTaskForDocument && taskForMarkers?.targetFile && state.deps?.fileSystem && state.context?.featurePath) {
      await stripInternalMarkers(state.deps.fileSystem as any, state.context.featurePath, taskForMarkers.targetFile);
    }
    
    // ✅ CRITICAL: Save checkpoint after completing a task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              taskQueue: state.taskQueue?.getAll() || [],
              completedTasks,
              completedTasksDetails,
              currentTask: undefined,
              planText: state.planText,
              conversationHistory: [],  // Checkpoint saves empty; runtime state uses retention policy
              files: state.files || [],
              filesToDelete: state.filesToDelete || [],
              jobId: (state as any).jobId,
              jobTiming: (state as any).jobTiming,
              tokenUsage: (state as any).tokenUsage,  // ✅ Save job-level token usage
              overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
              chatSource: state.chatSource,  // ✅ Save chat source flag
              detectionReport: state.detectionReport,  // ✅ Save for resume routing
              uiDesignSource: state.uiDesignSource,
              figmaConfig: state.figmaConfig,
            }
          }
        );
        console.log(`[checkTaskStatus] ✅ Checkpoint saved (${completedTasksDetails.length} tasks completed)\n`);
      } catch (error) {
        console.warn(`[checkTaskStatus] ⚠️  Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state._httpJobId && state.taskQueue && state.deps?.kanbanUpdate) {
      const allTasks = state.taskQueue.getAll();
      const nextTask = state.taskQueue.peek(); // ✅ Use peek() for correct next task
      
      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter(t => t.id !== nextTask.id) : allTasks;
      
      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,
        remainingQueue,  // ✅ Exclude nextTask from queue
        completedTasksDetails,
        state.recursionCount,   // ✅ FIX: Pass recursion tracking
        state.recursionLimit,   // ✅ FIX: Pass recursion limit
        (state as any).tokenUsage  // ✅ FIX: Pass job-level token usage to prevent badge reset
      );
    }
    
    // Apply conversation retention policy (compact or discard based on context)
    const { applyRetention } = await import('../../../../core/utils/conversationRetention');
    const nextTask = state.taskQueue?.peek();
    const retainedHistory = applyRetention({
      jobType: 'design',
      workType: (state.detectionReport?.workType as any) || 'system-design',
      currentTask: { targetFile: state.currentTask.targetFile, id: state.currentTask.id },
      nextTask: nextTask ? { targetFile: (nextTask as any).targetFile, id: nextTask.id } : undefined,
      conversationHistory: state.conversationHistory || [],
    });
    
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      planText: '',
      conversationHistory: retainedHistory,
      files: [],
      fileErrors: undefined,
      tokenUsage: (state as any).tokenUsage,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
      _callLimitReached: false,
      _toolResultCache: undefined,
      _assetValidationFailed: false,
      _assetValidationRetried: 0,
    };
  }
  
  // No current task (shouldn't happen, but handle gracefully)
  return { currentTask: undefined };
}

/**
 * Parallel Orchestrator node for design job.
 * Runs all tasks from the queue using TaskOrchestrator with worker subgraphs.
 * Only invoked when ANT_TASK_CONCURRENCY > 1.
 */
async function parallelOrchestrator(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  const { TaskOrchestrator: OrchestratorClass } = await import('../code/parallel/TaskOrchestrator');
  const { createDesignWorkerGraphBuilder } = await import('./parallel/workerGraph');
  const { registerActiveOrchestrator, unregisterActiveOrchestrator } = await import('../../../../composition/gracefulShutdown');

  const maxWorkers = getTaskConcurrency();
  const parallelStartTime = Date.now();
  console.log(`\n🔀 [Design ParallelOrchestrator] Starting with maxWorkers=${maxWorkers}`);

  const taskQueue = state.taskQueue;
  if (!taskQueue || taskQueue.isEmpty()) {
    console.log(`[Design ParallelOrchestrator] No tasks in queue, skipping`);
    return {};
  }
  
  // ✅ Log parallel_start to debug/logs/
  if (state.context?.featurePath && state._httpJobId) {
    try {
      const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'design',
      });
      await execLogger.logParallelStart({
        taskIds: taskQueue.getAll().map((t: any) => t.id),
        concurrency: maxWorkers,
      });
    } catch (_) { /* non-critical */ }
  }

  // Build shared context
  console.log(`🔧 [Design ParallelOrchestrator] detectionReport.workType=${state.detectionReport?.workType || 'MISSING'}, uiDesignSource=${state.uiDesignSource || 'N/A'}`);
  const sharedContext = {
    context: state.context,
    workspaceConfig: state.workspaceConfig,
    deps: state.deps,
    detectionReport: state.detectionReport,
    prd: state.prd,
    sourceDocuments: state.sourceDocuments,
    directive: state.directive,
    design: state.design,
    existingDesignDocs: state.existingDesignDocs,
    uiReferences: (state as any).uiReferences,
    uiAssetsList: (state as any).uiAssetsList,
    figmaConfig: state.figmaConfig,
    uiDesignSource: state.uiDesignSource,
    figmaExplorationResult: state.figmaExplorationResult,
    _httpJobId: state._httpJobId,
    _uiLocale: (state as any)._uiLocale,
    jobId: (state as any).jobId,
    jobTiming: (state as any).jobTiming,
    // ✅ Pass recursionLimit so worker subgraph uses the correct limit
    // Without this, LangGraph defaults to 25 which is too low for complex tasks
    recursionLimit: state.recursionLimit,  // ✅ Always set by runner.ts from env RECURSION_LIMIT
  };

  const graphBuilder = createDesignWorkerGraphBuilder();
  const orchestrator = new OrchestratorClass<DesignTask>(
    taskQueue,
    graphBuilder,
    sharedContext,
    {
      onTaskComplete: (task, workerId) => {
        console.log(`[Design ParallelOrchestrator] Worker ${workerId} completed: ${task.name}`);
      },
      onTaskFailure: (task, error, workerId) => {
        console.error(`[Design ParallelOrchestrator] Worker ${workerId} failed: ${task.name} - ${error.message}`);
        if (state.context?.featurePath && state._httpJobId) {
          try {
            const { getExecutionLogger } = require('../../../../core/utils/executionLogger');
            const failLogger = getExecutionLogger({
              featurePath: state.context.featurePath,
              jobId: state._httpJobId,
              jobType: 'design',
            });
            failLogger.logTaskFail(task.id, {
              taskName: task.name,
              errorMessage: error.message,
              errorStack: error.stack,
              workerId,
            });
          } catch (_) { /* non-critical */ }
        }
      },
      onWorkerTerminate: (workerId: number) => {
        if (state.deps?.workflowUpdate?.clearWorkers && state._httpJobId) {
          Promise.resolve(
            state.deps.workflowUpdate.clearWorkers(state._httpJobId, [workerId])
          ).catch((err: Error) => {
            console.warn(`[Design ParallelOrchestrator] Failed to clear terminated worker ${workerId}:`, err.message);
          });
        }
      },
      onInterruption: (reason, runningTaskIds) => {
        if (state.context?.featurePath && state._httpJobId) {
          import('../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
            const execLogger = getExecutionLogger({
              featurePath: state.context.featurePath!,
              jobId: state._httpJobId!,
              jobType: 'design',
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
            undefined, // recursionCount
            undefined, // recursionLimit
            tokenUsage,
          );
        }
      },
      onCheckpoint: async (checkpoint) => {
        if (state.deps?.session && state.context.featureFolder) {
          try {
            // Merge failed tasks into taskQueue so full task definitions survive
            // process termination (user stop, kill, etc.).
            const failedAsQueue = checkpoint.failedTasks.map(f => ({
              ...f.task,
              _failed: true,
              _failureReason: f.error.message,
            }));
            const failedIds = new Set(failedAsQueue.map((t: any) => t.id));
            const dedupedQueue = checkpoint.taskQueue.filter(t => !failedIds.has(t.id));

            await state.deps.session.updateArtifacts(
              state.context.project,
              state.context.featureFolder,
              'design',
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
                  estimatingTokenUsage: (state as any)._estimatingTokenUsage,
                  jobId: (state as any).jobId,
                  jobTiming: (state as any).jobTiming,
                  parallelMode: true,
                  uiDesignSource: state.uiDesignSource,
                  figmaConfig: state.figmaConfig,
                  detectionReport: state.detectionReport,
                  ...(checkpoint.interruption ? {
                    interruption: {
                      reason: checkpoint.interruption.reason,
                      message: `Design paused: ${checkpoint.interruption.reason}`,
                      timestamp: new Date().toISOString(),
                      canResume: checkpoint.interruption.canResume,
                    },
                  } : {}),
                },
              },
            );
            const failedCount = checkpoint.failedTasks.length;
            console.log(`💾 [Design ParallelOrchestrator] Checkpoint saved (${checkpoint.completedTasks.length} completed, ${checkpoint.taskQueue.length} queued${failedCount > 0 ? `, ${failedCount} failed` : ''})`);
          } catch (err) {
            console.warn(`⚠️ [Design ParallelOrchestrator] Checkpoint save failed:`, err);
          }
        }
      },
    },
    {
      maxWorkers,
      checkpointInterval: 60000,
      barriers: {
        assets: true,
        spec: true,
      },
    },
    state.completedTasksDetails || [],  // Resume: pass previously completed tasks
  );

  registerActiveOrchestrator(orchestrator);
  let result;
  try {
    result = await orchestrator.run();
  } finally {
    unregisterActiveOrchestrator();
  }

  // Clear stale worker entries from WorkflowBroadcaster
  // Workers' last node (usually 'learn') stays in activeWorkers until cleared
  if (state.deps?.workflowUpdate?.clearWorkers && state._httpJobId) {
    await state.deps.workflowUpdate.clearWorkers(state._httpJobId);
  }

  console.log(`\n🔀 [Design ParallelOrchestrator] Completed:`);
  console.log(`   Completed: ${result.completedTasks.length}`);
  console.log(`   Failed: ${result.failedTasks.length}`);
  console.log(`   Remaining: ${result.remainingQueue.length}`);
  
  // ✅ Log parallel_complete to debug/logs/
  if (state.context?.featurePath && state._httpJobId) {
    try {
      const { getExecutionLogger } = await import('../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'design',
      });
      await execLogger.logParallelComplete({
        taskIds: result.completedTasks.map((t: any) => t.id),
        elapsedMs: Date.now() - parallelStartTime,
      });
    } catch (_) { /* non-critical */ }
  }
  if (result.failedTasks.length > 0) {
    for (const f of result.failedTasks) {
      console.error(`   ❌ FAILED: "${f.task.name}" (id=${f.task.id}) — ${f.error.message}`);
    }
  }

  // ✅ If any tasks permanently failed, save interrupted state to session
  if (result.hasFailures && state.deps?.session && state.context.featureFolder) {
    try {
      const failedAsQueue = result.failedTasks.map(f => ({
        ...f.task,
        _failed: true,
        _failureReason: f.error.message,
      }));

      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'design',
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
            estimatingTokenUsage: (state as any)._estimatingTokenUsage,
            jobId: (state as any).jobId,
            jobTiming: (state as any).jobTiming,
            parallelMode: true,
            uiDesignSource: state.uiDesignSource,
            figmaConfig: state.figmaConfig,
            detectionReport: state.detectionReport,
            interruption: {
              reason: 'tasks_failed',
              message: `${result.failedTasks.length} task(s) failed during parallel execution`,
              timestamp: new Date().toISOString(),
              canResume: true,
            },
          },
        },
      );
      console.log(`💾 [Design ParallelOrchestrator] Saved interrupted state (${result.failedTasks.length} failed tasks)`);
    } catch (err) {
      console.warn(`⚠️ [Design ParallelOrchestrator] Failed to save interrupted state:`, err);
    }
  }

  return {
    completedTasks: result.completedTasks.map(t => t.id),
    completedTasksDetails: result.completedTasks,
    currentTask: undefined,
    tokenUsage: result.tokenUsage || (state as any).tokenUsage,
    interruption: result.hasInterruptedTasks ? {
      reason: result.interruptReason || 'recursion_limit',
      message: result.interruptReason === 'user_stopped'
        ? `Task stopped by user (${result.remainingQueue.length} task(s) remaining)`
        : result.interruptReason === 'figma_rate_limited'
        ? `Figma API rate limit exceeded. Please retry later. (${result.remainingQueue.length} task(s) remaining)`
        : `Task(s) paused: recursion limit reached during parallel execution (${result.remainingQueue.length} task(s) remaining)`,
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
        tasksRemaining: result.failedTasks.length + result.remainingQueue.length,
      },
    } : undefined,
  } as any;
}

export function buildDesignGraph() {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      workspaceConfig: null as any,
      
      // Dependencies (MUST be in channels to be passed between nodes!)
      deps: null as any,
      
      // ✅ CRITICAL: Detection Report (unified environment detection result)
      // Contains: workType (ui-design/system-design), jobMode, environment, domain
      detectionReport: null as any,
      
      // ✅ Error handling for invalid requests (e.g., modify without documents)
      designError: null as any,
      
      // Artifacts
      prd: null as any,
      directive: null as any,
      design: null as any,
      existingDesignDocs: null as any,
      sourceDocuments: null as any,
      
      // Task Queue (like code graph)
      taskQueue: null as any,
      currentTask: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      
      // Job tracking (for timing and continuity)
      jobId: null as any,
      jobTiming: null as any,
      
      // Token usage tracking (task-level and job-level)
      _currentTaskTokenUsage: null as any,
      tokenUsage: null as any,
      _estimatingTokenUsage: null as any,
      
      // Execution
      planText: null as any,
      files: null as any,
      filesToDelete: null as any,
      lessons: null as any,
      
      // Tool Calling Support
      llmResponse: null as any,
      conversationHistory: null as any,
      
      // For tracking in UI
      _httpJobId: null as any,
      _phaseTimings: null as any,  // ✅ Per-node timing for phaseBreakdown
      _uiLocale: null as any,     // ✅ UI locale (ko/en) from directive
      
      // Chat integration
      overrideDirective: null as any,
      chatSource: null as any,
      
      // Triage System
      skipTriage: null as any,
      triageResult: null as any,
      workspaceState: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      
      // UI document generation context
      uiReferences: null as any,
      uiAssetsList: null as any,

      // Figma integration (resolve -> detectEnvironment -> figmaExplore -> docGen)
      figmaConfig: null as any,
      uiDesignSource: null as any,
      figmaExplorationResult: null as any,
      
      // ✅ Resume flag (set by runner before graph invoke)
      isResume: null as any,
      
      // ✅ Recursion tracking (for UI gauge display)
      recursionCount: null as any,
      recursionLimit: null as any,
      
      // ✅ Parallel orchestrator failure signal (propagated to learn for failure-aware handling)
      interruption: null as any,

      // ✅ DocGen call budget tracking
      _docGenCallIndex: null as any,
      _callLimitReached: null as any,
      _noOutputCallCount: null as any,
      _toolResultCache: null as any,
      fileErrors: null as any,

      // ✅ Clarify state (MUST be in channels for LangGraph state propagation)
      awaitingDetectClarify: null as any,
      awaitingClarify: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("triage" as const, triage as any);  // ✅ Triage: analyze intent and prerequisites
  graph.addNode("detectEnvironment" as const, detectEnvironment as any);
  graph.addNode("figmaExplore" as const, figmaExplore as any);  // ✅ Figma exploration (Phase 0)
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("revise" as const, revise as any);  // ✅ Task queue revision (on resume with new directive)
  graph.addNode("plan" as const, plan as any);
  graph.addNode("docGen" as const, docGen as any);  // ✅ XML streaming + immediate file writes (like code job)
  graph.addNode("tool" as const, tool as any);  // ✅ Tool execution (for UI Design multimodal image loading)
  graph.addNode("checkTaskStatus" as const, checkTaskStatus as any);
  graph.addNode("learn" as const, learn as any);
  graph.addNode("parallelOrchestrator" as const, parallelOrchestrator as any);

  // ✅ Unified flow: resolve → [4-way routing] → ... → [plan → docGen → check] → learn
  // Design job now writes files immediately like code job (no separate writeFiles node)
  // docGen: XML streaming + immediate writes to disk (with LAST_SECTION handling)
  (graph as any).addEdge("__start__", "resolve");
  
  // ✅ 6-way conditional routing after resolve
  // 1. isResume + awaitingClarify + overrideDirective → docGen (clarify direct route — skip triage/detect/decompose)
  // 2. isResume + spec workType + overrideDirective + !hasTaskQueue → decompose (spec iterative modification)
  // 3. isResume + hasTaskQueue + hasNewDirective → revise (task queue modification)
  // 4. isResume + hasTaskQueue (no new directive) → plan (continue from where we left off)
  // 5. isResume + !hasTaskQueue + hasDetectionReport → decompose (interrupted after detect but before decompose)
  // 6. !isResume (new job) → triage (full flow)
  graph.addConditionalEdges(
    "resolve" as any,
    ((s: DesignGraphState) => {
      const isResume = s.isResume === true;
      const hasTaskQueue = Boolean(s.taskQueue && !s.taskQueue.isEmpty());
      const hasDetectionReport = Boolean(s.detectionReport);
      const hasNewDirective = Boolean(s.overrideDirective);
      
      // Path 0: Detect clarify resume — user chose spec vs system-design
      if (isResume && s.awaitingDetectClarify && hasNewDirective) {
        console.log(`🔀 [Resolve→Router] isResume + awaitingDetectClarify + newDirective → detectEnvironment (clarify resume)`);
        return "detectEnvironment";
      }
      
      // Path 1: Clarify response — skip straight to docGen with conversation history
      if (isResume && s.awaitingClarify && hasNewDirective) {
        console.log(`🔀 [Resolve→Router] isResume + awaitingClarify + newDirective → docGen (clarify direct)`);
        return "docGen";
      }
      
      // Path 2: Spec iterative modification — simplified decompose for single-task spec update
      if (isResume && hasNewDirective && !hasTaskQueue && s.detectionReport?.workType === 'spec') {
        console.log(`🔀 [Resolve→Router] isResume + spec + newDirective (no tasks) → decompose (spec modification)`);
        return "decompose";
      }
      
      if (isResume && hasTaskQueue && hasNewDirective) {
        console.log(`🔀 [Resolve→Router] isResume + taskQueue + newDirective → revise`);
        return "revise";
      }
      if (isResume && hasTaskQueue) {
        const concurrency = getTaskConcurrency();
        if (concurrency > 1) {
          console.log(`🔀 [Resolve→Router] isResume + taskQueue, concurrency=${concurrency} → parallelOrchestrator`);
          return "parallelOrchestrator";
        }
        console.log(`🔀 [Resolve→Router] isResume + taskQueue → plan (continue)`);
        return "plan";
      }
      if (isResume && hasDetectionReport) {
        console.log(`🔀 [Resolve→Router] isResume + detectionReport (no tasks) → decompose`);
        return "decompose";
      }
      
      console.log(`🔀 [Resolve→Router] New job → triage`);
      return "triage";
    }) as any,
    { triage: "triage", revise: "revise", plan: "plan", parallelOrchestrator: "parallelOrchestrator", decompose: "decompose", docGen: "docGen", detectEnvironment: "detectEnvironment" } as any
  );
  
  // ✅ Triage → Conditional (proceed to detectEnvironment or end)
  graph.addConditionalEdges(
    "triage" as any,
    routeAfterTriage as any,
    {
      detectEnvironment: "detectEnvironment",  // work:proceed → continue
      __end__: "__end__"  // ask, redirect, blocked → end (await choice or show message)
    } as any
  );
  
  // ✅ Conditional routing from detectEnvironment
  // - designError → END (e.g., modification without documents, Figma MCP unavailable)
  // - awaitingDetectClarify → END (paused for user choice between spec/system-design)
  // - uiDesignSource === 'figma' → figmaExplore → decompose
  // - otherwise → decompose (reference mode or non-UI)
  graph.addConditionalEdges(
    "detectEnvironment" as any,
    ((s: DesignGraphState) => {
      if (s.designError) {
        console.log(`❌ [Graph] Design error detected, terminating job`);
        return "__end__";
      }
      if (s.awaitingDetectClarify) {
        console.log(`⏸️  [Graph] Detect clarify — paused for user choice`);
        return "__end__";
      }
      if (s.uiDesignSource === 'figma') {
        console.log(`🎨 [Graph] Figma mode → figmaExplore`);
        return "figmaExplore";
      }
      return "decompose";
    }) as any,
    { __end__: "__end__", decompose: "decompose", figmaExplore: "figmaExplore" } as any
  );
  
  // ✅ figmaExplore → conditional: designError → END, otherwise → decompose
  graph.addConditionalEdges(
    "figmaExplore" as any,
    ((s: DesignGraphState) => {
      if (s.designError) {
        console.log(`❌ [Graph] Figma explore failed (${s.designError.type}), terminating job`);
        return "__end__";
      }
      return "decompose";
    }) as any,
    { __end__: "__end__", decompose: "decompose" } as any
  );
  
  // ✅ Decompose → conditional: parallel or sequential
  graph.addConditionalEdges(
    "decompose" as any,
    ((s: DesignGraphState) => {
      const concurrency = getTaskConcurrency();
      if (concurrency > 1) {
        console.log(`[Design Decompose→Router] ANT_TASK_CONCURRENCY=${concurrency} → parallelOrchestrator`);
        return "parallelOrchestrator";
      }
      console.log(`[Design Decompose→Router] ANT_TASK_CONCURRENCY=1 → sequential plan`);
      return "plan";
    }) as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // ✅ ParallelOrchestrator → learn (after all tasks are done)
  (graph as any).addEdge("parallelOrchestrator", "learn");
  
  // ✅ Revise → conditional: parallel or sequential
  graph.addConditionalEdges(
    "revise" as any,
    ((s: DesignGraphState) => {
      const concurrency = getTaskConcurrency();
      if (concurrency > 1) {
        return "parallelOrchestrator";
      }
      return "plan";
    }) as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  (graph as any).addEdge("plan", "docGen");
  
  // ✅ Conditional routing: docGen → tool / checkTaskStatus / docGen (with call budget safety net)
  graph.addConditionalEdges(
    "docGen" as any,
    routeAfterDocGen as any,
    { tool: "tool", checkTaskStatus: "checkTaskStatus", docGen: "docGen" } as any
  );
  
  // ✅ Tool → docGen (loop back for next LLM turn)
  (graph as any).addEdge("tool", "docGen");
  
  // ✅ Conditional routing: validation retry → docGen, interrupted → learn, more tasks → plan, all done → learn
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    ((s: DesignGraphState) => {
      if (s._assetValidationFailed) {
        return "docGen";  // ← Asset validation failed — retry with guidance
      }
      if ((s as any).interruption) {
        return "learn";  // ← Interrupted (call limit / recursion) — skip to cleanup
      }
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        return "plan";  // ← Next task
      } else {
        return "learn";  // ← All done
      }
    }) as any,
    { plan: "plan", learn: "learn", docGen: "docGen" } as any
  );
  
  // ✅ CRITICAL: learn 노드 이후 END로 이동
  (graph as any).addEdge("learn", "__end__");

  return graph.compile();
}
