import path from 'node:path';
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import type { TaskType } from '@ant/shared';
import { DetectableFields } from '../../../common/graph/annotationHelpers';
import { ArchitectGraphState } from "./state";
import { CodeTask } from "../../types/task";
import { codeResolveStrategy } from "./nodes/resolve";
import { createResolveNode } from "../../../common/graph/nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/graph/nodes/triage";  // ✅ Triage System
import { createDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { codeDetectStrategy } from './nodes/detect/strategy.js';
import { decompose } from "./nodes/decompose";
import { direct } from "./nodes/direct";
import { plan } from "./nodes/plan";
import { execute } from "./nodes/execute/index";
import { tool } from "./nodes/tool";
import { learn } from "./nodes/learn";
import { checkTaskStatus } from "./nodes/checkTaskStatus";
import { routeAfterExecute } from "./routers/executeRouter";
import { routeAfterPlan } from "./routers/planRouter";
import { routeAfterTool } from "./routers/toolRouter";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from "./parallel/types";
import { buildResumableFailedTask } from "./parallel/resumeBudgetReset";
import { hooksForTaskType } from "./tasks/_shared/registry";
import * as routing from "./routing";
import { JobTimingManager } from "../../../common/graph/timing/JobTimingManager";
import { withPhaseTracking } from "../../../common/graph/llmHelpers";
import type { InterruptionReason } from '../../../../core/types/session';
import { getExecutionLogger } from '../../../../core/utils/executionLogger';

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
  const _parBasis = state.resolvedAction?.basis;
  if (!_parBasis) {
    console.warn(`⚠️  [ParallelOrchestrator] state.resolvedAction.basis is ${_parBasis === undefined ? 'undefined' : 'falsy'} — workers will NOT have basis templates`);
  } else {
    console.log(`📐 [ParallelOrchestrator] basis present: stack=${_parBasis.techTier?.stack || 'none'}, visualTier=${_parBasis.visualTier ? Object.keys(_parBasis.visualTier).join(',') : 'none'}`);
  }
  const sharedContext = {
    context: state.context,
    workspaceConfig: state.workspaceConfig,
    deps: state.deps,
    gitPort: state.gitPort,
    artifacts: state.artifacts,
    resolvedArtifacts: state.resolvedArtifacts,
    resolvedAction: state.resolvedAction,
    directive: state.directive,
    code: state.code,
    codeHead: state.codeHead,
    profile: state.profile,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    sessionContext: state.sessionContext,
    featureName: state.featureName,
    maxRetries: state.maxRetries || 3,
    recursionCount: state.recursionCount || 0,
    recursionLimit: state.recursionLimit,  // ✅ Always set by runner.ts from env RECURSION_LIMIT
    _httpJobId: state._httpJobId,
    _uiLocale: state._uiLocale,
    jobId: state.jobId,
    // turnId propagation to worker subgraph — without this every worker's
    // state.turnId is undefined and downstream callers (writeBreadcrumb /
    // recordUserTurnMeta / ChatLogAppender) silently skip. Even though
    // workers themselves do NOT emit BC (gated by `!isWorkerContext`),
    // task-internal trace lines still need the owning turnId so they
    // attribute correctly in chat.jsonl. job-context-bridge T1 fix.
    turnId: state.turnId,
    executionTier: state.executionTier,
    jobTiming: state.jobTiming,
    featureTasks: state.featureTasks,
    referenceRequests: state.referenceRequests,
    _sharedFileBuffer: sharedFileBuffer,
    taskQueue: state.taskQueue,
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
        // Task-type-specific post-completion side effects live in
        // `tasks/{type}/hooks/orchestrator.ts onTaskComplete`. For error
        // tasks the hook auto-enqueues a Final Verification (Recheck)
        // when none is already in flight. R1 — no task.type branches.
        const hook = hooksForTaskType(task.type as TaskType)?.orchestrator?.onTaskComplete;
        if (hook) {
          hook({
            task,
            taskQueue,
            queueSnapshot: taskQueue.getAll() as readonly CodeTask[],
            runningSnapshot: orchestrator.getRunningTasks() as readonly CodeTask[],
            completedSnapshot: orchestrator.getCompletedTasks() as readonly CodeTask[],
            resolvedAction: state.resolvedAction,
          });
        }
      },
      onTaskFailure: (task, error, workerId) => {
        console.error(`[ParallelOrchestrator] Worker ${workerId} failed: ${task.name} - ${error.message}`);
        // Log task_fail to debug/logs/ for post-mortem analysis.
        // Static import + synchronous writeQueue update — see
        // executionLogger contract (vast-curling-perch C-3 RCA).
        if (state.context?.featurePath && state._httpJobId) {
          const isRecLimit = /recursion limit/i.test(error.message);
          void getExecutionLogger({
            featurePath: state.context.featurePath,
            jobId: state._httpJobId,
            jobType: 'code',
          }).logTaskFail(task.id, {
            taskName: task.name,
            reason: isRecLimit ? 'recursion_limit' : 'unknown',
            errorMessage: error.message.substring(0, 500),
            elapsedMs: task.timing?.elapsedTime,
            inputTokens: task.tokenUsage?.inputTokens,
            outputTokens: task.tokenUsage?.outputTokens,
            cacheReadTokens: task.tokenUsage?.cacheReadTokens,
            llmCallCount: task.tokenUsage?.callCount,
          }).catch(() => { /* non-blocking */ });
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
        // ✅ Also drop the worker's battery from the chat-input token gauge so
        // the tooltip / more-dropdown no longer lists a terminated worker.
        state.deps?.kanbanUpdate?.clearWorkerPhaseTokenUsage?.(workerId);
      },
      onInterruption: (reason, runningTaskIds) => {
        // ✅ Log job_interrupted event to debug/logs/.
        // Static import + synchronous writeQueue update — see
        // executionLogger contract (vast-curling-perch C-3 RCA).
        if (state.context?.featurePath && state._httpJobId) {
          void getExecutionLogger({
            featurePath: state.context.featurePath,
            jobId: state._httpJobId,
            jobType: 'code',
          }).logJobInterrupted({
            reason,
            runningTaskIds,
            remainingTaskCount: taskQueue.size(),
            completedTaskCount: orchestrator.getCompletedTasks().length,
          }).catch(() => { /* non-blocking */ });
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
        // Merge failed tasks into taskQueue so full task definitions survive
        // process termination (user stop, kill, etc.). Without this, only
        // summary data (taskId/taskName/error) is persisted and the task
        // cannot be resumed.
        //
        // Mark them as `interrupted: true` so the UI's TaskCard shows the
        // "Paused" badge — semantically "all permanent failures are also
        // interrupted at the job level". `_failed` / `_failureReason` are
        // kept for the resume path (`TaskOrchestrator` clears them on retry)
        // and for batchSplit handling. The helper also resets task-owned
        // VerificationBudget axes so the user-resume gets a fresh budget
        // (vast-curling-perch RCA — `JobCleanupManager` reads this Redis
        // checkpoint as parallel-mode SSOT, so this writer must reset too).
        const failedAsQueue = checkpoint.failedTasks.map(f =>
          buildResumableFailedTask(f.task as CodeTask, f.error.message),
        );
        // Deduplicate: if a failed task was re-enqueued (e.g. verification after
        // batch split), the re-enqueued version in checkpoint.taskQueue has the
        // same id. Keep only the failed-record copy to avoid duplicate ids in the
        // persisted taskQueue.
        const failedIds = new Set(failedAsQueue.map((t: any) => t.id));
        const dedupedQueue = checkpoint.taskQueue.filter(t => !failedIds.has(t.id));
        const mergedQueue = [...failedAsQueue, ...dedupedQueue];

        if (state.deps?.session && state.context.featureFolder) {
          try {
            await state.deps.session.updateArtifacts(
              state.context.project,
              state.context.featureFolder,
              'code',
              {
                state: {
                  taskQueue: mergedQueue,
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
        //
        // Send the SAME mergedQueue we just wrote to the session so the SSOT
        // stays consistent. Without this, JobCleanupManager's parallel-mode
        // path overwrites session.taskQueue with Redis's queue (which would
        // not include failed tasks), erasing the failed cards from the UI.
        if (state.deps?.kanbanUpdate?.saveCheckpointSnapshot && state._httpJobId) {
          state.deps.kanbanUpdate.saveCheckpointSnapshot(
            mergedQueue,
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

  // ✅ Log parallel_start (and job_resumed if resuming) events to debug/logs/.
  // Static import + synchronous writeQueue update — see executionLogger
  // contract (vast-curling-perch C-3 RCA).
  const parallelStartTime = Date.now();
  if (state.context?.featurePath && state._httpJobId) {
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    // ✅ Log job_resumed when this is a resume run with an existing task queue
    if (state.isResume) {
      void execLogger.logJobResumed({
        fromCompletedTaskCount: (state.completedTasksDetails || []).length,
        remainingTaskCount: taskQueue.size(),
      }).catch(() => { /* non-blocking */ });
    }
    const allTaskIds = taskQueue.getAll().map((t: any) => t.id);
    void execLogger.logParallelStart({
      taskIds: allTaskIds,
      concurrency: maxWorkers,
    }).catch(() => { /* non-blocking */ });
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

  // ✅ Log parallel_complete event to debug/logs/.
  // Static import + synchronous writeQueue update — see executionLogger
  // contract (vast-curling-perch C-3 RCA).
  if (state.context?.featurePath && state._httpJobId) {
    void getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    }).logParallelComplete({
      taskIds: result.completedTasks.map((t: any) => t.id),
      elapsedMs: Date.now() - parallelStartTime,
    }).catch(() => { /* non-blocking */ });
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
      const failedAsQueue = result.failedTasks.map(f =>
        buildResumableFailedTask(f.task as CodeTask, f.error.message),
      );

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
  // Failed tasks go back to the queue with `interrupted: true` (so the UI's
  // TaskCard shows the "Paused" badge) plus `_failed` / `_failureReason`
  // (used by the resume path and batchSplit) for visibility.
  if (result.hasFailures && !result.hasInterruptedTasks && state.deps?.session && state.context.featureFolder) {
    try {
      const failedAsQueue = result.failedTasks.map(f =>
        buildResumableFailedTask(f.task as CodeTask, f.error.message),
      );

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

/**
 * SSOT: All channel definitions for the code graph.
 * Both main graph and worker subgraph spread this to stay in sync.
 * Worker subgraph adds worker-only fields on top.
 */
export const CodeGraphChannels = {
      ...DetectableFields,

      // Job-specific fields (not in common chain)
      workspaceConfig: Annotation<any>,
      gitPort: Annotation<any>,
      artifacts: Annotation<any>,
      code: Annotation<any>,
      codeHead: Annotation<any>,
      profile: Annotation<any>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
      }),
      runtimeAssetsIndex: Annotation<any>,
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
      turnId: Annotation<any>,
      jobTiming: Annotation<any>,
      failedTasks: Annotation<any>,
      unresolvedErrors: Annotation<any>,
      evaluationReport: Annotation<any>,
      lessons: Annotation<any>,
      referenceRequests: Annotation<any>,
      branch: Annotation<any>,
      filesWritten: Annotation<any>,
      reportFile: Annotation<any>,
      directives: Annotation<any>,
      _currentTaskTokenUsage: Annotation<any>,
      _estimatingTokenUsage: Annotation<any>,
      _executeCallIndex: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => 0,
      }),
      commandHistory: Annotation<any>,
      llmResponse: Annotation<any>,
      toolResults: Annotation<any>,
      interruption: Annotation<any>,
      _activePhase: Annotation<any>,
      _nextPlanEntry: Annotation<any>,
      _lastToolBatchMutatedFiles: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => false,
      }),
      _detectedPackageManager: Annotation<any>,
      _otherWorkerFiles: Annotation<any>,
      _existingCodebaseFiles: Annotation<any>,
      figmaFileKey: Annotation<any>,
      figmaStartNodeId: Annotation<any>,
      boundary: Annotation<any>,
      awaitingDecomposeClarify: Annotation<any>,
      executionTier: Annotation<any>,
      directHints: Annotation<any>,
      featureContext: Annotation<any>,
      specClarify: Annotation<any>,
      needsEscalation: Annotation<any>,
      _promotedThisJob: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => false,
      }),
      _specClarifyBypassed: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => false,
      }),
      workerId: Annotation<any>,
      _isStopRequested: Annotation<any>,
      _batchSplitRequeued: Annotation<any>,
      verifiedTasks: Annotation<any>,
      _verifyEntered: Annotation<any>({
        reducer: (_prev: any, next: any) => next,
        default: () => false,
      }),
} as const;

const ArchitectCodeGraphStateAnnotation = Annotation.Root(CodeGraphChannels);

export function buildCodeGraph() {
  const graph = new StateGraph(ArchitectCodeGraphStateAnnotation);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Node Registration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  graph.addNode("resolve", createResolveNode(codeResolveStrategy) as any);
  graph.addNode("triage", triage as any);
  graph.addNode('detect', createDetectNode(codeDetectStrategy) as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("direct", withPhaseTracking('directCode', direct) as any);  // ✅ oneshot / exploratory ReAct loop
  graph.addNode("revise", withPhaseTracking('revise', revise) as any);  // ✅ Task queue revision (continue/modify)
  graph.addNode("plan", withPhaseTracking('plan', plan) as any);
  graph.addNode("execute", withPhaseTracking('execute', execute) as any);
  graph.addNode("tool", tool as any);
  graph.addNode("checkTaskStatus", checkTaskStatus as any);
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
  
  // ✅ Decompose → conditional: clarify/spec-clarify pause, direct (oneshot|exploratory),
  //                              parallelOrchestrator or plan (todo)
  graph.addConditionalEdges(
    "decompose" as any,
    routing.routeAfterDecompose as any,
    {
      __end__: "__end__",
      direct: "direct",
      parallelOrchestrator: "parallelOrchestrator",
      plan: "plan",
    } as any
  );

  // ✅ Direct → conditional: escalate back to decompose (1-shot) or complete via learn
  graph.addConditionalEdges(
    "direct" as any,
    routing.routeAfterDirect as any,
    { decompose: "decompose", learn: "learn" } as any
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
  // All task types: execute(done) → checkTaskStatus → (plan retry | learn)
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    routing.routeAfterCheckTaskStatus as any,
    { plan: "plan", learn: "learn" } as any
  );

  
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
