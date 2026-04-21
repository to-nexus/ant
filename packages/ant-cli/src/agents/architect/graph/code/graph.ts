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
import { enforce } from "./nodes/enforce";
import { learn } from "./nodes/learn";
import { checkTaskStatus } from "./nodes/checkTaskStatus";
import { routeAfterExecute } from "./routers/executeRouter";
import { routeAfterPlan } from "./routers/planRouter";
import { routeAfterTool } from "./routers/toolRouter";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from "./parallel/types";
import { hooksForTaskType } from "./tasks/_shared/registry";
import * as routing from "./routing";
import { JobTimingManager } from "../../../common/graph/timing/JobTimingManager";
import type { InterruptionReason } from '../../../../core/types/session';

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
        // Log task_fail to debug/logs/ for post-mortem analysis
        if (state.context?.featurePath && state._httpJobId) {
          const _failFeaturePath = state.context.featurePath;
          const _failJobId = state._httpJobId;
          void (async () => {
            const { getExecutionLogger: getExecLogFail } = await import('../../../../core/utils/executionLogger');
            const failLogger = getExecLogFail({
            featurePath: _failFeaturePath,
            jobId: _failJobId,
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
          })().catch(() => {});
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
      turnId: Annotation<any>,
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
      commandHistory: Annotation<any>,
      llmResponse: Annotation<any>,
      toolResults: Annotation<any>,
      interruption: Annotation<any>,
      _activePhase: Annotation<any>,
      _nextPlanEntry: Annotation<any>,
      _executeModifiedFiles: Annotation<any>,
      _detectedPackageManager: Annotation<any>,
      _otherWorkerFiles: Annotation<any>,
      figmaAvailable: Annotation<any>,
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
      verification: Annotation<any>,
      _shortCircuitReason: Annotation<any>,
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
  graph.addNode("direct", direct as any);  // ✅ oneshot / exploratory ReAct loop
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
