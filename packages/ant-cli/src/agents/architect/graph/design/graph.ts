import { Annotation, StateGraph } from "@langchain/langgraph";
import { DetectableFields } from '../../../common/graph/annotationHelpers';
import { CONV_KEYS, getConv } from '../../../common/graph/conversations';
import { DesignGraphState } from "./state";
import { DesignTask } from "../../types/task";
import { designResolveStrategy } from "./nodes/resolve";
import { createResolveNode } from "../../../common/graph/nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/graph/nodes/triage";  // ✅ Triage System
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen/index";  // ✅ XML streaming + immediate file writes
import { tool } from "./nodes/tool";  // ✅ Tool execution node (for UI Design multimodal)
import { learn } from "./nodes/learn";
import { createInferDetectNode } from '../../../common/graph/nodes/detect/index.js';
import { augmentDesignFigma } from './nodes/detect/augmentFigma.js';
import { figmaExplore } from "./nodes/figmaExplore";
import { revise } from "./nodes/revise";
import { getTaskConcurrency } from '../../../common/graph/parallelTypes';
import { buildResumableFailedTaskBase } from '../../../common/graph/resumableFailedTask';
import { routeAfterDocGen } from "./routers/docGenRouter";
import { isFigmaPipeline, isFigmaDataPopulated } from "@ant/shared";
import * as designRouting from "./routing";
import {
  saveInterruptionCheckpoint,
  saveTaskCompleteCheckpoint,
  saveOrchestratorCheckpoint,
} from './session/checkpoint';
import { JobTimingManager } from "../../../common/graph/timing/JobTimingManager";
import { withPhaseTracking } from "../../../common/graph/llmHelpers";
import { designDirOf } from "@ant/shared";
import path from "node:path";
import { toFeatureRelative, appendOrUpdatePool } from '../../../../core/prompt/builder/ArtifactPipeline';
import { getExecutionLogger } from '../../../../core/utils/executionLogger';

const INTERNAL_MARKER_RE = /\n?<!-- (?:SECTION_PATTERN|LAST_SECTION)[^>]*-->\s*/g;

async function stripInternalMarkers(
  fileSystem: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void> },
  featurePath: string,
  targetFile: string,
  targetDir?: string,
): Promise<void> {
  try {
    const dir = targetDir ?? designDirOf(targetFile);
    const filePath = path.join(featurePath, dir, targetFile);
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

/**
 * Validate asset references for both UI and GameArt surfaces.
 *
 * - `ui-assets.json` — every `src` field must point to a locally
 *   downloaded file (external-only — UI surface has no inline kind).
 * - `game-art-assets.json` — only entries with `kind: 'external'` are
 *   validated (D20). `kind: 'inline'` entries carry their data inside
 *   the JSON (`svg` / `css` / `oscillator`) and are skipped.
 *
 * The validation runs against whichever document the active task
 * targets (`ui-assets-*` → ui doc; `game-art-assets-*` → game-art doc).
 */
async function validateAssetReferences(state: DesignGraphState): Promise<{
  valid: boolean;
  missingFiles: string[];
  totalRefs: number;
}> {
  const featurePath = state.context.featurePath;
  const fs = await import('fs/promises');
  const taskId = state.currentTask?.id ?? '';

  const isGameArt = taskId.startsWith('game-art-assets-');
  const assetPath = isGameArt
    ? path.join(featurePath, 'visual', 'game-art', 'ant', 'game-art-assets.json')
    : path.join(featurePath, 'visual', 'ui', 'ant', 'ui-assets.json');

  try {
    const content = await fs.readFile(assetPath, 'utf-8');
    const parsed = JSON.parse(content);
    const srcPaths = isGameArt
      ? extractGameArtExternalSrcs(parsed)
      : extractAllSrcFields(parsed);
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
 * Walk `game-art-assets.json` (category dictionary of entry arrays) and
 * return the `src` of every `kind: 'external'` entry. Inline entries
 * (`kind: 'inline'`) carry their data inline and are skipped.
 */
function extractGameArtExternalSrcs(parsed: any): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const srcs: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '_meta') continue;
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry === 'object' && (entry as any).kind === 'external' && typeof (entry as any).src === 'string') {
        srcs.push((entry as any).src);
      }
    }
  }
  return srcs;
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
  
  // Note: the historical "Call limit interruption" gate was retired alongside
  // the code job's Safety Net D/E. Runaway docGen loops are bounded by
  // LangGraph `recursionLimit`; the `call_limit` interruption reason is gone.

  // ✅ FIGMA CONNECTION LOST INTERRUPTION: Figma MCP failed N consecutive times
  if (state._figmaConnectionLost && state.currentTask) {
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../common/graph/llmHelpers');
    
    const taskTokenUsage = getTaskTokenUsage(state);
    if (taskTokenUsage) {
      accumulateTokenUsage(state, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
    const pausedTask = TaskTimingHelper.pauseTask(state.currentTask);
    (pausedTask as any).interrupted = true;
    
    console.warn(`⚠️  [checkTaskStatus] Figma connection lost for "${state.currentTask.name}" (${state._figmaConsecutiveErrors || 0} failures) — creating interruption`);
    
    const { TaskQueue: TQ } = await import('../../types/task');
    const newQueue = new TQ<DesignTask>();
    newQueue.push(pausedTask);
    state.taskQueue?.getAll().forEach((t: any) => {
      if (t.id !== state.currentTask!.id) newQueue.push(t);
    });
    
    const interruption = {
      reason: 'figma_connection_lost' as const,
      message: `Figma Desktop connection lost after ${state._figmaConsecutiveErrors || 0} consecutive failures. Ensure Figma is open and retry.`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        consecutiveErrors: state._figmaConsecutiveErrors || 0,
        tasksRemaining: newQueue.size(),
        completedCount: (state.completedTasks || []).length,
      }
    };
    
    await saveInterruptionCheckpoint(state, { taskQueue: newQueue.getAll(), interruption });

    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        null,
        newQueue.getAll(),
        state.completedTasksDetails || [],
        state.recursionCount,
        state.recursionLimit,
        state.tokenUsage
      );
    }
    
    console.log(`⏸️  [checkTaskStatus] Figma connection lost. ${(state.completedTasks || []).length} completed, ${newQueue.size()} remaining`);
    
    return {
      currentTask: undefined,
      taskQueue: newQueue,
      _figmaConnectionLost: false,
      _figmaConsecutiveErrors: 0,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
      _toolResultCache: undefined,
      fileErrors: undefined,
      interruption,
      tokenUsage: state.tokenUsage,
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

  // Asset validation gate: verify all src paths exist before completing
  // ui-assets / game-art-assets tasks. game-art-assets validates only
  // entries with `kind: 'external'` — `kind: 'inline'` carry their data
  // inline (D20).
  const isAssetTask = state.currentTask?.id.startsWith('ui-assets-')
    || state.currentTask?.id.startsWith('game-art-assets-');
  if (isAssetTask && (state._assetValidationRetried || 0) >= 2) {
    console.warn(`⚠️  [checkTaskStatus] Asset validation retry limit reached (${state._assetValidationRetried}). Proceeding with incomplete assets.`);
  }
  if (isAssetTask && (state._assetValidationRetried || 0) < 2) {
    const validation = await validateAssetReferences(state);
    if (!validation.valid) {
      const docLabel = state.currentTask?.id.startsWith('game-art-assets-')
        ? 'game-art-assets.json (kind:external entries)'
        : 'ui-assets.json';
      console.warn(`⚠️  [checkTaskStatus] Asset validation failed: ${validation.missingFiles.length}/${validation.totalRefs} not downloaded:`);
      for (const f of validation.missingFiles) console.warn(`   - ${f}`);

      const retryMessage = {
        role: 'user' as const,
        content: `VALIDATION FAILED: ${validation.missingFiles.length} assets referenced in ${docLabel} are not downloaded:\n${
          validation.missingFiles.map(f => `- ${f}`).join('\n')
        }\n\nEither download the missing files (kind:external must point at a local file) or convert the entry to kind:inline with simple-shape SVG/CSS/oscillator data.`,
      };

      return {
        conversations: { [CONV_KEYS.NODE_DOCGEN]: [...getConv(state.conversations, CONV_KEYS.NODE_DOCGEN), retryMessage] },
        _assetValidationFailed: true,
        _assetValidationRetried: (state._assetValidationRetried || 0) + 1,
        _docGenCallIndex: 0,
        _noOutputCallCount: 0,
      };
    }
  }
  
  // ✅ Current task completed successfully
  if (state.currentTask) {
    // ✅ Get helpers
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../../../common/graph/llmHelpers');
    
    // ✅ Get task-level token usage
    const taskTokenUsage = getTaskTokenUsage(state);
    
    // ✅ Complete task with timing and token usage
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    
    // ✅ Accumulate task tokens into job-level tokenUsage
    if (taskTokenUsage) {
      accumulateTokenUsage(state, taskTokenUsage, { taskLevel: false, jobLevel: true });
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
          llmCallCount: taskTokenUsage?.callCount ?? state._docGenCallIndex ?? 0,
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
      await stripInternalMarkers(state.deps.fileSystem as any, state.context.featurePath, taskForMarkers.targetFile, taskForMarkers.targetDir);
    }
    
    // Save checkpoint after completing a task (task-complete boundary).
    // Clears currentTask + conversations (runtime uses retention policy separately).
    await saveTaskCompleteCheckpoint(state, { completedTasks, completedTasksDetails });
    
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
        state.tokenUsage  // ✅ FIX: Pass job-level token usage to prevent badge reset
      );
    }
    
    // Pool update: append generated files to artifact pool before clearing files[]
    const featurePath = state.context.featurePath || '';
    const newOutputs = (state.files || [])
      .filter(f => f.content && f.path && f.actionType !== 'delete')
      .map(f => ({
        path: toFeatureRelative(f.path, featurePath),
        content: f.content,
        role: 'ref' as const,
      }));
    const updatedPool = appendOrUpdatePool(state.artifacts || [], newOutputs);

    // Apply conversation retention policy (compact or discard based on context)
    const { applyRetention } = await import('../../../../core/utils/conversationRetention');
    const nextTask = state.taskQueue?.peek();
    const retainedHistory = applyRetention({
      jobType: 'design',
      intentGroup: (state.resolvedAction?.intentGroup as any) || 'design-system',
      currentTask: { targetFile: state.currentTask.targetFile, id: state.currentTask.id },
      nextTask: nextTask ? { targetFile: (nextTask as any).targetFile, id: nextTask.id } : undefined,
      nodeHistory: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN) as any,
    });
    
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      planText: '',
      conversations: { [CONV_KEYS.NODE_DOCGEN]: retainedHistory },
      files: [],
      artifacts: updatedPool,
      fileErrors: undefined,
      tokenUsage: state.tokenUsage,
      _docGenCallIndex: 0,
      _noOutputCallCount: 0,
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

  // ✅ Workflow instrumentation: Enter node
  // Mirrors the signature used by workerCheckTaskStatus (parallel/workerGraph.ts):
  //   enterNode(httpJobId, nodeName, workerId, taskInfo?, llmInfo?, recursionCount?, recursionLimit?)
  // workerId=0 because this is an orchestrator-level (non-worker) node.
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'parallelOrchestrator',
      0,
      undefined,
      undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  try {
  // ✅ Log parallel_start to debug/logs/
  if (state.context?.featurePath && state._httpJobId) {
    try {
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
  console.log(`🔧 [Design ParallelOrchestrator] resolvedAction.intentGroup=${state.resolvedAction?.intentGroup || 'MISSING'}, intent=${state.resolvedAction?.intent || 'N/A'}`);
  const sharedContext = {
    context: state.context,
    workspaceConfig: state.workspaceConfig,
    deps: state.deps,
    resolvedAction: state.resolvedAction,
    artifacts: state.artifacts,
    directive: state.directive,
    existingDesignDocs: state.existingDesignDocs,
    uiAssetsList: state.uiAssetsList,
    figmaConfig: state.figmaConfig,
    figmaExplorationResult: state.figmaExplorationResult,
    figmaAvailable: state.figmaAvailable,
    figmaFileKey: state.figmaFileKey,
    figmaStartNodeId: state.figmaStartNodeId,
    _httpJobId: state._httpJobId,
    _uiLocale: state._uiLocale,
    jobId: state.jobId,
    jobTiming: state.jobTiming,
    // ✅ Pass recursionLimit so worker subgraph uses the correct limit
    // Without this, LangGraph defaults to 25 which is too low for complex tasks
    recursionLimit: state.recursionLimit,  // ✅ Always set by runner.ts from env RECURSION_LIMIT
    _allTasksSummary: taskQueue.getAll().map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      targetFile: (t as any).targetFile,
    })),
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
          void getExecutionLogger({
            featurePath: state.context.featurePath,
            jobId: state._httpJobId,
            jobType: 'design',
          }).logTaskFail(task.id, {
            taskName: task.name,
            reason: 'unknown',
            errorMessage: `[worker=${workerId}] ${error.message}`,
          }).catch(() => {});
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
        // Drop the worker's chat-input gauge battery entry on termination.
        state.deps?.kanbanUpdate?.clearWorkerPhaseTokenUsage?.(workerId);
      },
      onInterruption: (reason, runningTaskIds) => {
        if (state.context?.featurePath && state._httpJobId) {
          void getExecutionLogger({
            featurePath: state.context.featurePath,
            jobId: state._httpJobId,
            jobType: 'design',
          }).logJobInterrupted({
            reason,
            runningTaskIds,
            remainingTaskCount: taskQueue.size(),
            completedTaskCount: orchestrator.getCompletedTasks().length,
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
        await saveOrchestratorCheckpoint(state, checkpoint);
      },
    },
    {
      maxWorkers,
      checkpointInterval: 60000,
      barriers: {
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

  // Mark job timing as paused so resume calculates accurate totalPausedDuration
  if (result.hasFailures || result.hasInterruptedTasks) {
    state.jobTiming = JobTimingManager.pauseJob(state.jobTiming);
  }

  // ✅ If any tasks permanently failed, persist the merged queue (_failed markers)
  // + interruption via the unified checkpoint writer. Disk SSOT: taskQueue carries
  // the _failed entries that surface as Retry cards on resume.
  if (result.hasFailures) {
    await saveOrchestratorCheckpoint(state, {
      taskQueue: result.remainingQueue,
      // Orchestrator has fully drained at this point; no in-flight workers.
      runningTasks: [],
      completedTasks: result.completedTasks,
      failedTasks: result.failedTasks,
      tokenUsage: result.tokenUsage,
      parallelMode: true,
      interruption: { reason: 'tasks_failed', canResume: true },
    });
  }

  // Re-populate live state.taskQueue with failed (with _failed markers) + remaining
  // so learn detects failures via the queue (SSOT). No separate state.failedTasks
  // channel — the marker on each task IS the signal. The marker trio is owned by
  // `buildResumableFailedTaskBase` so the shape stays uniform with the design
  // checkpoint writer and the code job's wrapper.
  if (state.taskQueue) {
    for (const f of result.failedTasks) {
      state.taskQueue.push(
        buildResumableFailedTaskBase<DesignTask>(f.task, f.error.message),
      );
    }
    for (const t of result.remainingQueue) {
      state.taskQueue.push(t);
    }
  }

  // Inter-task self-output — workers operate on separate state copies, so
  // their `task.files` outputs are not yet in `state.artifacts`. Splice
  // them in here using the same role-preserving pattern as the serial
  // task-completion edge above; this keeps the pool aligned with the
  // post-RAC SSOT (RAC-resolved artifacts + this job's own outputs).
  // The legacy whole-tree scan helper is intentionally NOT used — it
  // would pull in arbitrary `architecture/**` / `visual/**` files that the user did
  // not put in the RAC. See `AGENTS.md` "state.artifacts Post-RAC
  // SSOT".
  const parallelFeaturePath = state.context.featurePath || '';
  const completedFileOutputs = result.completedTasks.flatMap(t =>
    (t.files || [])
      .filter(f => f.content && f.path && f.actionType !== 'delete')
      .map(f => ({
        path: toFeatureRelative(f.path, parallelFeaturePath),
        content: f.content,
        role: 'ref' as const,
      }))
  );
  const refreshedPool = appendOrUpdatePool(state.artifacts || [], completedFileOutputs);

  return {
    completedTasks: result.completedTasks.map(t => t.id),
    completedTasksDetails: result.completedTasks,
    currentTask: undefined,
    artifacts: refreshedPool,
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
  } finally {
    // ✅ Workflow instrumentation: Exit node (single exit for all paths)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'parallelOrchestrator', 0);
    }
  }
}

/**
 * SSOT: All channel definitions for the design graph.
 * Both main graph and worker subgraph spread this to stay in sync.
 * Worker subgraph adds worker-only fields on top.
 */
export const DesignGraphChannels = {
  ...DetectableFields,

  // Job-specific fields (not in common chain)
  workspaceConfig: Annotation<any>,
  designError: Annotation<any>,
  artifacts: Annotation<any>,
  existingDesignDocs: Annotation<any>,
  profile: Annotation<any>,
  taskQueue: Annotation<any>,
  currentTask: Annotation<any>,
  completedTasks: Annotation<any>,
  completedTasksDetails: Annotation<any>,
  jobId: Annotation<any>,
  turnId: Annotation<any>,
  jobTiming: Annotation<any>,
  _currentTaskTokenUsage: Annotation<any>,
  _estimatingTokenUsage: Annotation<any>,
  planText: Annotation<any>,
  files: Annotation<any>,
  filesToDelete: Annotation<any>,
  lessons: Annotation<any>,
  llmResponse: Annotation<any>,
  uiAssetsList: Annotation<any>,
  figmaConfig: Annotation<any>,
  figmaExplorationResult: Annotation<any>,
  figmaAvailable: Annotation<any>,
  figmaFileKey: Annotation<any>,
  figmaStartNodeId: Annotation<any>,
  interruption: Annotation<any>,
  _docGenCallIndex: Annotation<any>,
  _noOutputCallCount: Annotation<any>,
  _toolResultCache: Annotation<any>,
  fileErrors: Annotation<any>,
  _assetValidationFailed: Annotation<any>,
  _assetValidationRetried: Annotation<any>,
  awaitingDetectClarify: Annotation<any>,
  awaitingClarify: Annotation<any>,
  _figmaConsecutiveErrors: Annotation<any>,
  _figmaConnectionLost: Annotation<any>,
  boundary: Annotation<any>,
  featureContext: Annotation<any>,
  workerId: Annotation<any>,
  _isStopRequested: Annotation<any>,
  executionTier: Annotation<any>,
  _activePhase: Annotation<any>,
  _pendingDoneCheck: Annotation<any>,
  _doneCheckEscalation: Annotation<any>,
} as const;

const DesignGraphAnnotation = Annotation.Root(DesignGraphChannels);

export function buildDesignGraph() {
  const graph = new StateGraph(DesignGraphAnnotation);

  graph.addNode("resolve" as const, createResolveNode(designResolveStrategy) as any);
  graph.addNode("triage" as const, triage as any);  // ✅ Triage: analyze intent and prerequisites
  graph.addNode('detect' as const, createInferDetectNode(augmentDesignFigma) as any);
  graph.addNode("figmaExplore" as const, figmaExplore as any);  // ✅ Figma exploration (Phase 0)
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("revise" as const, withPhaseTracking('revise', revise) as any);  // ✅ Task queue revision (on resume with new directive)
  graph.addNode("plan" as const, withPhaseTracking('plan', plan) as any);
  graph.addNode("docGen" as const, withPhaseTracking('docGen', docGen) as any);  // ✅ XML streaming + immediate file writes (like code job)
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
  // 2. isResume + spec intentGroup + overrideDirective + !hasTaskQueue → decompose (spec iterative modification)
  // 3. isResume + hasTaskQueue + hasNewDirective → revise (task queue modification)
  // 4. isResume + hasTaskQueue (no new directive) → plan (continue from where we left off)
  // 5. isResume + !hasTaskQueue + hasResolvedAction → decompose (interrupted after detect but before decompose)
  // 6. !isResume (new job) → triage (full flow)
  graph.addConditionalEdges(
    "resolve" as any,
    designRouting.routeAfterResolve as any,
    { triage: "triage", revise: "revise", plan: "plan", parallelOrchestrator: "parallelOrchestrator", decompose: "decompose", docGen: "docGen", detect: "detect" } as any
  );
  
  // ✅ Triage → Conditional (proceed to detect or end)
  graph.addConditionalEdges(
    "triage" as any,
    routeAfterTriage as any,
    {
      detect: "detect",
      __end__: "__end__"  // ask, redirect, blocked → end (await choice or show message)
    } as any
  );
  
  // ✅ Conditional routing from detect
  // - designError → learn (cleanup, error message, endJob)
  // - awaitingDetectClarify → END (paused for user choice between spec/system-design)
  // - Figma pipeline (intent=gen-ui-figma or rev-ui+figma) → figmaExplore → decompose
  // - otherwise → decompose (reference mode or non-UI)
  graph.addConditionalEdges(
    "detect" as any,
    designRouting.routeAfterDetect as any,
    { learn: "learn", __end__: "__end__", decompose: "decompose", figmaExplore: "figmaExplore" } as any
  );
  
  // ✅ figmaExplore → conditional: designError → learn, otherwise → decompose
  graph.addConditionalEdges(
    "figmaExplore" as any,
    designRouting.routeAfterFigmaExplore as any,
    { learn: "learn", decompose: "decompose" } as any
  );
  
  // ✅ Decompose → conditional: parallel or sequential
  graph.addConditionalEdges(
    "decompose" as any,
    designRouting.routeAfterDecompose as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  
  // ✅ ParallelOrchestrator → learn (after all tasks are done)
  (graph as any).addEdge("parallelOrchestrator", "learn");
  
  // ✅ Revise → conditional: parallel or sequential
  graph.addConditionalEdges(
    "revise" as any,
    designRouting.routeAfterRevise as any,
    { parallelOrchestrator: "parallelOrchestrator", plan: "plan" } as any
  );
  // ✅ Conditional routing: plan → tool (tool-loop round) / docGen (<plan> emitted or fallthrough)
  graph.addConditionalEdges(
    "plan" as any,
    designRouting.routeAfterPlan as any,
    { tool: "tool", docGen: "docGen" } as any
  );

  // ✅ Conditional routing: docGen → tool / checkTaskStatus / docGen (with call budget safety net)
  graph.addConditionalEdges(
    "docGen" as any,
    routeAfterDocGen as any,
    { tool: "tool", checkTaskStatus: "checkTaskStatus", docGen: "docGen" } as any
  );

  // ✅ Conditional routing: tool → plan (plan↔tool loop) / docGen (docGen↔tool loop) — dispatched via _activePhase
  graph.addConditionalEdges(
    "tool" as any,
    designRouting.routeAfterTool as any,
    { plan: "plan", docGen: "docGen" } as any
  );
  
  // ✅ Conditional routing: validation retry → docGen, interrupted → learn, more tasks → plan, all done → learn
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    designRouting.routeAfterCheckTaskStatus as any,
    { plan: "plan", learn: "learn", docGen: "docGen" } as any
  );
  
  // ✅ CRITICAL: learn 노드 이후 END로 이동
  (graph as any).addEdge("learn", "__end__");

  return graph.compile();
}
