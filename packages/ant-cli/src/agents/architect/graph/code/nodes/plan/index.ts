/**
 * Plan Node (Refactored)
 * 
 * Responsibilities:
 * 1. Pop next task from queue
 * 2. Generate task-specific keywords (LLM)
 * 3. Search Vector DB with keywords (task-specific RAG)
 * 4. Load reference projects (if needed)
 * 5. Generate implementation plan (planText)
 * 6. Update state with codeContext, referenceContexts, planText
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - keywordGeneration.ts: Keyword generation & UI display
 * - stackTraceLoader.ts: Stack trace file loading
 * - semanticSearch.ts: Semantic keyword search
 * - referenceLoader.ts: Reference project loading
 * - planGeneration.ts: Plan text generation
 * - utils.ts: Utility functions
 */

import { LLMClient } from "../../../../../../core/ports";
import type { MessageContentBlock } from "../../../../../../core/ports/llm";
import { extractLLMInfo } from "../../../../../../core/ports/workflow";
import { ArchitectGraphState, TASK_PRIORITIES } from "../../state";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";

// Import submodules
import { generateTaskKeywords, displayKeywords, logKeywords } from "./keywordGeneration";
import { combineCodeContext, TaskKeywords } from "./combineCodeContext";
import { loadReferenceContexts } from "./referenceLoader";
import { generatePlanText, runPlanLLMWithTools, buildPlanPrompt, buildPlanPromptBlocks, PLAN_TOOL_LOOP_MAX, taskRequiresPlan, finalizePlanFromExploration } from "./planGeneration";
import { extractFilesFromViolations, formatViolations } from "../shared/violationFormatter";
import { extractFilesFromPlanToolLoop, computeBudgetFromPlanText } from "./utils";
import { detectTestFilesFromDisk } from "./testFileDetector";

function isTypeScriptProject(state: ArchitectGraphState): boolean {
  const lang = (state.profile?.language || (state as any).detectionReport?.profile?.language || '').toLowerCase();
  return lang.includes('typescript');
}

/**
 * Strip markdown code fences from a string if present.
 * Handles: ```json\n...\n```, ```\n...\n```, etc.
 */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Enrich projectCodeContext with files discovered during Plan's tool loop.
 * Extracts read_file results from planConversationHistory and merges them
 * into projectCodeContext.files, deduplicating against existing RAG files.
 */
function enrichContextFromPlanToolLoop(
  projectCodeContext: any,
  planConversationHistory: Array<{ role: string; content: string | MessageContentBlock[] }> | undefined,
): any {
  if (!projectCodeContext || !planConversationHistory?.length) return projectCodeContext;

  const existingPaths = new Set<string>((projectCodeContext.files || []).map((f: any) => f.path));
  const newFiles = extractFilesFromPlanToolLoop(planConversationHistory, existingPaths);

  if (newFiles.length === 0) return projectCodeContext;

  console.log(`📎 [Plan] Enriching CodeGen context with ${newFiles.length} file(s) from plan tool loop`);

  return {
    ...projectCodeContext,
    files: [...(projectCodeContext.files || []), ...newFiles],
    filePaths: [...(projectCodeContext.filePaths || []), ...newFiles.map(f => f.path)],
    stats: {
      ...projectCodeContext.stats,
      filesLoaded: (projectCodeContext.stats?.filesLoaded || 0) + newFiles.length,
    },
  };
}

/**
 * When a diagnostic task (verification/error) finishes its plan tool-loop with
 * build/test already passing and no plan to execute, execute would only ask the
 * LLM to output `<done>true</done>` — a wasted call.  Detect this and let the
 * plan node set `done: true` directly so planRouter skips execute entirely.
 */
function isVerificationPassWithoutCodeGen(
  state: ArchitectGraphState, planText: string, batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  const task = state.currentTask;
  if (task?.type !== 'verification' && task?.type !== 'error') return false;
  const tracker = state._verificationTracker;
  if (!tracker || !tracker.buildPassed) return false;
  if (tracker.testsRequired && !tracker.testPassed) return false;
  return true;
}

/**
 * Check whether any two batches share files in their modify/create/delete lists.
 * When overlap exists, error sub-tasks must run exclusively (sequential).
 * When no overlap, they can safely run in parallel.
 */
function computeBatchFileOverlap(batches: any[]): boolean {
  const extractFiles = (b: any): Set<string> => {
    const files = new Set<string>();
    for (const m of (b.modify || [])) files.add(typeof m === 'string' ? m : m.file);
    for (const c of (b.create || [])) files.add(typeof c === 'string' ? c : c.file);
    for (const d of (b.delete || [])) files.add(typeof d === 'string' ? d : d);
    return files;
  };
  const allFiles = batches.map(extractFiles);
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      for (const file of allFiles[i]) {
        if (allFiles[j].has(file)) return true;
      }
    }
  }
  return false;
}

const MAX_BATCH_SPLIT_CYCLES = 10;

/**
 * Detect batched diagnostic plan and split into sub-tasks.
 * Called from every path that produces a planText for diagnostic tasks.
 *
 * When the plan JSON contains a `batches` array with >1 entries,
 * each batch becomes an independent error sub-task with prePlanText.
 * The original task is re-enqueued (not completed) so it re-runs after all error fixes.
 *
 * Hard limit: after MAX_BATCH_SPLIT_CYCLES cycles, batch splitting is aborted and
 * planText is returned as-is (single consolidated task). This prevents infinite loops
 * from cascading compiler errors that reveal new layers after each fix cycle.
 *
 * @returns updated planText (empty string if split occurred, original otherwise)
 */
function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  const isVerificationOrErrorTask = nextTask.type === 'verification' || nextTask.type === 'error';

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).log('batch_split', data, nextTask.id);
      }).catch(() => {});
    }
  };

  if (!isVerificationOrErrorTask) {
    return planText;
  }
  if (!planText || planText.length <= 50) {
    logBatchSplit({ action: 'skipped', reason: 'plan_too_short', planTextLen: planText?.length ?? 0, taskName: nextTask.name });
    return planText;
  }
  if (!state.taskQueue || typeof state.taskQueue.push !== 'function' || typeof state.taskQueue.getAll !== 'function') {
    logBatchSplit({ action: 'skipped', reason: 'taskQueue_missing', taskQueueType: typeof state.taskQueue, constructor: state.taskQueue?.constructor?.name ?? 'N/A', taskName: nextTask.name });
    return planText;
  }

  try {
    const jsonStr = stripMarkdownFences(planText);
    const parsed = JSON.parse(jsonStr);
    if (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length <= 1) {
      logBatchSplit({ action: 'skipped', reason: 'no_batches', batchCount: parsed.batches?.length ?? 0, taskName: nextTask.name });
      return planText;
    }

    // ── Hard limit: cap batch split cycles to prevent infinite loops ──
    const splitCount = (nextTask._batchSplitCount || 0) + 1;

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Failing task.`);
      (nextTask as any)._failed = true;
      (nextTask as any)._failureReason = `batch_split_cycle_limit_exceeded (${splitCount} cycles)`;
      state._batchSplitRequeued = true; // release worker slot
      return ''; // batchSplitOccurred=true → llmResponse.done=true → skip execute
    }

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    // Each batch gets a unique parallelGroup so TaskOrchestrator can run them concurrently.
    // Batches with file overlap use exclusive:true (sequential) instead.
    const batchGroupBase = hasFileOverlap ? null : `error-batch-${Date.now()}`;

    const subTaskIds: string[] = [];
    for (let i = 0; i < parsed.batches.length; i++) {
      const batch = parsed.batches[i];
      const batchPlanText = JSON.stringify({
        task: { id: `batch-${i}`, goal: batch.name },
        diagnostics: parsed.diagnostics,
        implementation: {
          modify: batch.modify || [],
          create: batch.create || [],
          delete: batch.delete || [],
        },
      });

      const subTask: CodeTask = {
        id: `error-fix-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: `Fix: ${batch.name}`,
        description: batch.rationale || batch.name,
        type: 'error',
        priority: (nextTask.priority || 500) - 1,
        prePlanText: batchPlanText,
        exclusive: hasFileOverlap,
        parallelGroup: batchGroupBase ? `${batchGroupBase}-${i}` : undefined,
      };
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // Re-enqueue the original task (clean state) instead of creating a new one.
    // Priority FINAL_VERIFICATION(1000) > error priority(999) ensures it runs last.
    // Batch split tracking fields are preserved so the re-enqueued task can detect
    // repeated errors and break the loop on subsequent cycles.
    const requeuedTask: CodeTask = {
      ...nextTask,
      timing: undefined,
      interrupted: undefined,
      _failedAttempts: undefined,
      _failed: undefined,
      _failureReason: undefined,
      // Preserve batch split cycle counter for hard limit
      _batchSplitCount: splitCount,
      _previousBatchDiagnostics: JSON.stringify({
        cycle: splitCount,
        totalErrors: parsed.diagnostics?.totalErrors ?? 0,
        rootCauses: parsed.diagnostics?.rootCauses ?? [],
        batchNames: parsed.batches.map((b: any) => b.name),
      }),
    } as CodeTask;
    state.taskQueue.push(requeuedTask);
    state._batchSplitRequeued = true;

    logBatchSplit({
      action: 'created',
      batchCount: parsed.batches.length,
      totalErrors: parsed.diagnostics?.totalErrors ?? 0,
      rootCauses: parsed.diagnostics?.rootCauses?.length ?? 0,
      subTaskIds,
      taskQueueSize: state.taskQueue.size(),
      taskName: nextTask.name,
      hasFileOverlap,
      splitCount,
    });
    return '';
  } catch (err) {
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;

  const isRetry = state.violations && state.violations.length > 0;
  /** Set when plan↔tool loop limit hit so STEP 3 skips tools and uses generatePlanText only. */
  let forceNoTools = false;
  
  let nextTask: CodeTask | undefined;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0: Pop next task (or retry current)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isRetry && state.currentTask) {
    nextTask = state.currentTask;
    
    // 🚨 CRITICAL: Check if maxRetries exceeded
    if (state.retries >= state.maxRetries) {
      console.error(`\n❌ [Plan] Max retries (${state.maxRetries}) exceeded for task: ${nextTask.name}`);
      console.error(`   Current retries: ${state.retries}`);
      console.error(`   This task has failed repeatedly and cannot be fixed automatically.\n`);
      
      throw new Error(
        `Task "${nextTask.name}" failed after ${state.retries} attempts (max: ${state.maxRetries}). ` +
        `Cannot proceed with automatic fixes.`
      );
    }
    
    // Reset call budget for retry — without this, each retry inherits the
    // previous attempt's call index, progressively shrinking the available
    // budget until the safety-net fires on the very first call.
    const prevCallIndex = state._executeCallIndex || 0;
    const isVerificationRetry = nextTask.type === 'verification';

    if (isVerificationRetry) {
      // Verification retry: clear execute state so LLM starts fresh each cycle.
      // Previously preserved conversationHistory to avoid enableThinking=true loop,
      // but isVerificationWithPlan guard in execute/index.ts now ensures
      // enableThinking=false regardless of history length, making this safe.
      state._executeCallIndex = 0;
      state._finalTaskLoopCount = 0;
      state.conversationHistory = [];
      (state as any)._executeModifiedFiles = false;
      // On retry, force installNeeded=true to bypass dep-hash guard
      // (previous failure may be caused by corrupted/incomplete deps)
      (state as any)._installNeeded = true;
      if (state._verificationTracker) {
        state._verificationTracker.buildAttempted = false;
        state._verificationTracker.testAttempted = false;
        state._verificationTracker.typecheckAttempted = false;
      }
      const _retryAttempt = (state.retries || 0) + 1;
      const _retryMax = state.maxRetries || 3;
      console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (attempt ${_retryAttempt}/${_retryMax})`);
      console.log(`   ♻️  Reset: conversationHistory cleared, _executeCallIndex ${prevCallIndex}→0`);
      console.log(`   ♻️  Reset: _finalTaskLoopCount → 0\n`);
      if (nextTask && state.context?.featurePath && state._httpJobId) {
        const _taskRef = nextTask;
        import('../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
          getExecutionLogger({
            featurePath: state.context!.featurePath!,
            jobId: state._httpJobId!,
            jobType: 'code',
          }).logVerificationRetry(_taskRef.id, {
            taskName: _taskRef.name,
            attempt: _retryAttempt,
            maxAttempts: _retryMax,
            preservedHistoryLength: 0,
            preservedCallIndex: 0,
            violationsFromPrevAttempt: state.violations?.length ?? 0,
          }).catch(() => {});
        }).catch(() => {});
      }
    } else {
      state._executeCallIndex = 0;
      state._finalTaskLoopCount = 0;
      state.conversationHistory = [];
      console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})`);
      console.log(`   ♻️  Reset: _executeCallIndex ${prevCallIndex}→0, conversationHistory cleared\n`);
    }
  } else if (state._planExploring === true && state.currentTask) {
    nextTask = state.currentTask;
    console.log(`\n🔄 [Plan] Re-entry from tool loop for task: ${nextTask.name}\n`);
  } else if ((state as any)._awaitingFinalVerify === true && state.currentTask) {
    // POST-CODEFIX: execute applied fixes, now re-run full diagnostic for final verification
    nextTask = state.currentTask;
    console.log(`\n🔄 [Plan] Post-execute final verification: ${nextTask.name}`);
    console.log(`   Re-initializing VerificationTracker for fresh build/test check\n`);

    // Clear the trigger flag
    (state as any)._awaitingFinalVerify = false;

    // Accumulate applied plans so plan LLM can see ALL previous attempts
    if (state.planText) {
      const history = ((state as any)._appliedPlanHistory || []) as string[];
      history.push(state.planText);
      (state as any)._appliedPlanHistory = history;
    }

    // Reset tracker for fresh verification pass
    state._verificationTracker = {
      buildPassed: false,
      testPassed: false,
      testsRequired: detectTestFilesFromDisk(state.context?.featurePath),
      buildAttempted: false,
      testAttempted: false,
      typecheckPassed: false,
      typecheckAttempted: false,
      typecheckRequired: isTypeScriptProject(state),
    };

    // Reset execute state for potential next fix cycle
    state._executeCallIndex = 0;
    state._finalTaskLoopCount = 0;
    state.conversationHistory = [];
    (state as any)._executeModifiedFiles = false;

    // Recompute installNeeded — execute may have modified dependency declaration files
    const featureRoot = state.deps?.fileSystem?.getRootPath();
    if (featureRoot) {
      try {
        const { computeDepFileHash, hasInstalledDeps } = await import('../tool/handlers/runCommand');
        const currentHash = await computeDepFileHash(featureRoot);
        const savedHash = (state as any)._depFileHash as string | undefined;
        const depsExist = await hasInstalledDeps(featureRoot);
        const installNeeded = !savedHash || savedHash !== currentHash || !depsExist;
        (state as any)._installNeeded = installNeeded;
        console.log(`📦 [Plan] Post-execute installNeeded: ${installNeeded} (savedHash=${savedHash?.substring(0, 8) ?? 'none'}, currentHash=${currentHash?.substring(0, 8) ?? 'none'}, depsExist=${depsExist})`);
      } catch {
        (state as any)._installNeeded = true;
      }
    }
  } else {
    // ✅ Worker context: TaskWorker pre-assigns currentTask via orchestrator
    // Sequential context: pop next task from queue
    const _wid = (state as any).workerId;
    const isWorkerCtx = _wid !== undefined && _wid !== null;
    
    if (isWorkerCtx && state.currentTask) {
      nextTask = state.currentTask;
      console.log(`\n📋 [Plan] Task pre-assigned by orchestrator (worker ${_wid}): ${nextTask.name}\n`);
    } else {
      nextTask = state.taskQueue?.pop();
      
      if (!nextTask) {
        throw new Error('[Plan] No tasks in queue');
      }
      
      console.log(`\n📋 [Plan] Next task: ${nextTask.name}\n`);
    }
    
    // Start timing
    const { TaskTimingHelper } = await import('../../state');
    console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
    nextTask = TaskTimingHelper.startTask(nextTask);
    
    // ✅ Initialize token usage tracking for new task
    const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    resetTaskTokenUsage(state as any);
    state._executeCallIndex = 0;

    // ✅ Initialize verification tracker for verification tasks only.
    // Error tasks are code-fix only — build verification is deferred to the re-enqueued verification task.
    if (nextTask.type === 'verification') {
      const tsProject = isTypeScriptProject(state);
      state._verificationTracker = {
        buildPassed: false,
        testPassed: false,
        testsRequired: detectTestFilesFromDisk(state.context?.featurePath),
        buildAttempted: false,
        testAttempted: false,
        typecheckPassed: false,
        typecheckAttempted: false,
        typecheckRequired: tsProject,
      };
      (state as any)._appliedPlanHistory = [];
      console.log(`🔍 [Plan] VerificationTracker initialized: testsRequired=${state._verificationTracker.testsRequired}, typecheckRequired=${tsProject}`);

      // Compute installNeeded for dependency status prompt signal
      const featureRoot = state.deps?.fileSystem?.getRootPath();
      if (featureRoot) {
        try {
          const { computeDepFileHash, hasInstalledDeps } = await import('../tool/handlers/runCommand');
          const currentHash = await computeDepFileHash(featureRoot);
          const savedHash = (state as any)._depFileHash as string | undefined;
          const depsExist = await hasInstalledDeps(featureRoot);
          const installNeeded = !savedHash || savedHash !== currentHash || !depsExist;
          (state as any)._installNeeded = installNeeded;
          console.log(`📦 [Plan] Dependency install needed: ${installNeeded} (savedHash=${savedHash?.substring(0, 8) ?? 'none'}, currentHash=${currentHash?.substring(0, 8) ?? 'none'}, depsExist=${depsExist})`);
        } catch (err) {
          (state as any)._installNeeded = true; // fail-open: allow install if check fails
          console.warn(`⚠️ [Plan] Dependency hash check failed, defaulting to installNeeded=true: ${err}`);
        }
      }
    }

    // ✅ Log task_start event to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
      const { getExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      });
      execLogger.logTaskStart(nextTask.id, {
        taskName: nextTask.name,
        taskType: nextTask.type,
        priority: nextTask.priority,
        isParallel: !!(nextTask as any).parallelGroup,
        parallelGroup: (nextTask as any).parallelGroup,
      }).catch(() => {});
    }
    
    // Update Kanban UI
    // Skip in worker context — TaskOrchestrator handles kanban for parallel mode
    // (per-worker kanban would overwrite multi-task inProgress with just this worker's task)
    if (!isWorkerCtx && state._httpJobId && state.deps?.kanbanUpdate) {
      console.log(`🔥 [Plan] Updating Kanban → task started`);
      console.log(`   Current: ${nextTask.name}`);
      console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask,
        state.taskQueue?.getAll() || [],
        state.completedTasksDetails || [],
        state.recursionCount,
        state.recursionLimit
      );
    } else if (!isWorkerCtx) {
      if (!state._httpJobId) console.warn(`⚠️ [Plan] Kanban skipped: _httpJobId is missing`);
      if (!state.deps?.kanbanUpdate) console.warn(`⚠️ [Plan] Kanban skipped: deps.kanbanUpdate is null (broadcaster not injected)`);
    } else {
      console.log(`📋 [Plan] Kanban skipped: isWorkerCtx=true (orchestrator handles)`);
    }
    
    // ✅ CRITICAL: Save checkpoint after task started so session has correct currentTask
    // Without this, manual cancel during execute can't find the in-progress task
    // (session still has stale currentTask from previous learn node save)
    // Skip in worker context — orchestrator manages parallel checkpoints separately
    if (!isWorkerCtx && state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('../checkpoint');
        await saveCheckpoint({
          ...state,
          currentTask: nextTask
        });
      } catch (err) {
        // Non-critical: checkpoint save failure shouldn't block plan execution
        console.warn(`⚠️  [Plan] Failed to save task-start checkpoint: ${err}`);
      }
    }
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = {
      id: nextTask.id,
      name: nextTask.name,
      type: nextTask.type,
      description: nextTask.description,
      priority: nextTask.priority
    };
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'plan',
      (state as any).workerId ?? 0,
      taskInfo,
      state.deps?.llm ? extractLLMInfo(state.deps.llm as LLMClient) : undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.5: Check if planText generation can be skipped (task-level resume)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Skip conditions:
  //   1. Not an enforce retry (retry always needs fresh plan with violation context)
  //   2. Task was previously interrupted (not a fresh task from queue)
  //   3. Valid planText already exists from the previous session
  // When skipped: preserves planText + conversationHistory → execute continues from interruption point
  const canSkipPlan = (
    !isRetry &&
    nextTask.interrupted === true &&
    state.planText && state.planText.length > 50
  );
  
  if (canSkipPlan) {
    console.log(`\n⚡ [Plan] Resuming interrupted task "${nextTask.name}" with existing planText (${state.planText!.length} chars)`);
    console.log(`   Skipping: keywords, RAG, planText generation`);
    console.log(`   ConversationHistory: ${state.conversationHistory?.length || 0} messages preserved`);
    
    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
    }
    
    return {
      ...state,
      currentTask: nextTask,
      planText: state.planText,    // Preserve existing plan
      retries: 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      // conversationHistory is preserved in state (not cleared)
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.6: Pre-planned error task — skip plan generation entirely
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // When a diagnostic task splits into batches, each batch becomes an error task
  // with prePlanText already set. Skip all plan generation and go straight to execute.
  // Error tasks always use prePlanText — even on retry.
// budget_exhausted retry should re-attempt the same fix, not re-run tsc diagnostics.
// Re-running diagnostics on retry causes cascade: sibling domain errors → duplicate subtasks.
const hasPrePlanText =
  (nextTask as CodeTask).prePlanText != null &&
  (nextTask as CodeTask).prePlanText!.length > 50 &&
  (!isRetry || nextTask.type === 'error');
  
  if (hasPrePlanText) {
    console.log(`\n⚡ [Plan] Pre-planned error task "${nextTask.name}" — using prePlanText (${(nextTask as CodeTask).prePlanText!.length} chars)`);
    console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);

    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
    }

    return {
      ...state,
      currentTask: nextTask,
      planText: (nextTask as CodeTask).prePlanText!,
      _executeBudget: computeBudgetFromPlanText((nextTask as CodeTask).prePlanText!),
      retries: 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      conversationHistory: [],
      _planExploring: false,
      planConversationHistory: undefined,
      // Error tasks: no VerificationTracker — plan uses error-specific template, not verification diagnostic.
      _verificationTracker: undefined,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.7: Verification task retry — always re-diagnose
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Verification tasks must re-run build/test on retry to get fresh error state.
  // Error tasks are code-fix only — they don't run a diagnostic loop even on retry.
  if (isRetry && nextTask.type === 'verification') {
    console.log(`\n🔄 [Plan] Verification retry — will re-run build/test via tool loop for fresh error analysis`);
    console.log(`   Violations from previous attempt: ${state.violations?.length || 0}`);
    // Fall through to full plan flow (keyword/RAG/tool-loop/planText generation)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.9: Re-entry from tool (plan↔tool loop)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state._planExploring === true && state.planConversationHistory?.length) {
    const overLimit = state.planConversationHistory.length >= PLAN_TOOL_LOOP_MAX * 2; // ~2 messages per round
    if (overLimit) {
      console.log(`\n⚠️ [Plan] Plan↔tool loop limit (${PLAN_TOOL_LOOP_MAX}) reached; finalizing plan from exploration context`);
      let finalizedPlan = await finalizePlanFromExploration(state, state.planConversationHistory, nextTask);
      if (finalizedPlan) {
        const preSplitPlan = finalizedPlan;
        finalizedPlan = processDiagnosticBatchSplit(state, finalizedPlan, nextTask);
        const batchSplitOccurred = preSplitPlan.length > 50 && finalizedPlan === '';
        const diagnosticPass = isVerificationPassWithoutCodeGen(state, finalizedPlan, batchSplitOccurred);
        const enrichedContext = enrichContextFromPlanToolLoop(
          state.projectCodeContext ,
          state.planConversationHistory,
        );
        state._planExploring = false;
        state.planConversationHistory = undefined;
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
        }
        return {
          ...state,
          currentTask: nextTask,
          projectCodeContext: enrichedContext,
          referenceCodeContexts: state.referenceCodeContexts,
          lessons: state.lessons ?? [],
          planText: finalizedPlan,
          _executeBudget: computeBudgetFromPlanText(finalizedPlan),
          _planExploring: false,
          planConversationHistory: undefined,
          retries: isRetry ? state.retries : 0,
          completedTasksDetails: state.completedTasksDetails || [],
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          workspaceConfig: state.workspaceConfig,
          llmResponse: (batchSplitOccurred || diagnosticPass)
            ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
            : { done: false, textResponse: '', thinking: '', toolCalls: [] },
        };
      }
      console.log(`⚠️ [Plan] finalizePlanFromExploration failed; falling back to generatePlanText`);
      if (state.planConversationHistory?.length) {
        state.projectCodeContext = enrichContextFromPlanToolLoop(
          state.projectCodeContext ,
          state.planConversationHistory,
        );
      }
      state._planExploring = false;
      state.planConversationHistory = undefined;
      forceNoTools = true;
    } else {
      const result = await runPlanLLMWithTools(state, state.planConversationHistory, nextTask);
      if (result && '_planExploring' in result) {
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
        }
        return {
          ...state,
          planConversationHistory: result.planConversationHistory,
          _planExploring: true,
          llmResponse: result.llmResponse,
          projectCodeContext: state.projectCodeContext,
          referenceCodeContexts: state.referenceCodeContexts,
          lessons: state.lessons,
        };
      }
      if (result && 'planText' in result) {
        const preSplitPlan = result.planText;
        const planText = processDiagnosticBatchSplit(state, preSplitPlan, nextTask);
        const batchSplitOccurred = preSplitPlan.length > 50 && planText === '';
        const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
        const enrichedContext = enrichContextFromPlanToolLoop(
          state.projectCodeContext ,
          state.planConversationHistory,
        );
        const updatedState = {
          ...state,
          currentTask: nextTask,
          projectCodeContext: enrichedContext,
          referenceCodeContexts: state.referenceCodeContexts,
          lessons: state.lessons ?? [],
          planText,
          _executeBudget: computeBudgetFromPlanText(planText),
          _planExploring: false,
          planConversationHistory: undefined,
          retries: isRetry ? state.retries : 0,
          completedTasksDetails: state.completedTasksDetails || [],
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          workspaceConfig: state.workspaceConfig,
          llmResponse: (batchSplitOccurred || diagnosticPass)
            ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
            : { done: false, textResponse: '', thinking: '', toolCalls: [] },
        };
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
        }
        return updatedState;
      }
      // null: fall through to normal flow — but first enrich context with any files read during tool loop
      if (state.planConversationHistory?.length) {
        state.projectCodeContext = enrichContextFromPlanToolLoop(
          state.projectCodeContext ,
          state.planConversationHistory,
        );
      }
      state._planExploring = false;
      state.planConversationHistory = undefined;
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SETUP FAST PATH: Skip keyword/RAG/tool-loop entirely.
  // New projects have no existing code to search or explore.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (nextTask.type === 'setup') {
    console.log(`⚡ [Plan] Setup task — skipping keyword/RAG/tool-loop (no existing code to search)`);

    const emptyCodeContext = {
      source: 'plan' as const,
      filePaths: [] as string[],
      files: [] as any[],
      stats: { filesLoaded: 0, stackTraceCount: 0, semanticCount: 0, deduplicatedCount: 0, estimatedTokens: 0 },
    };

    const setupRemainingTasks = (state.taskQueue?.getAll() || [])
      .filter(t => t.id !== nextTask.id)
      .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

    const setupPlanText = await generatePlanText(
      llm, nextTask, state, emptyCodeContext, [],
      state.violations, undefined, setupRemainingTasks,
    );

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
    }

    return {
      ...state,
      currentTask: nextTask,
      projectCodeContext: emptyCodeContext,
      referenceCodeContexts: [],
      lessons: [],
      planText: setupPlanText,
      _executeBudget: computeBudgetFromPlanText(setupPlanText ?? ''),
      retries: isRetry ? state.retries : 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _planExploring: false,
      planConversationHistory: undefined,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.8: Generate directory tree early (for keyword LLM)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let directoryTree: string | undefined;
  const planFileSystem = state.deps?.fileSystem;
  if (planFileSystem) {
    try {
      const { generateDirectoryTree } = await import('./combineCodeContext');
      directoryTree = await generateDirectoryTree(planFileSystem, 4);
      if (directoryTree) {
        console.log(`📂 [Plan] Directory tree generated early for keyword LLM`);
      }
    } catch {
      // Non-critical: keyword LLM works without directory tree
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Generate task-specific keywords (LLM 1st request)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let taskKeywords: TaskKeywords;
  
  if (isRetry) {
    // On retry: skip LLM keyword generation entirely.
    // Only extract error files from violations for targeted RAG.
    const errorFilesFromViolations = extractFilesFromViolations(state.violations);
    taskKeywords = {
      errorFiles: errorFilesFromViolations,
      keywords: [],
      requiredFiles: [],
      references: new Map<string, string[]>()
    };
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔄 [Plan] Retry: extracted ${errorFilesFromViolations.length} error file(s) from violations`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    } else {
      console.log(`🔄 [Plan] Retry: no error files in violations, skipping keyword generation`);
    }
  } else if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    const generatedKeywords = await generateTaskKeywords(llm, nextTask, state, directoryTree);
    
    // Merge with violation files (after LLM response)
    const errorFilesFromViolations = extractFilesFromViolations(state.violations);
    
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔍 [Plan] Merging ${errorFilesFromViolations.length} file(s) from violations:`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    }
    
    taskKeywords = {
      errorFiles: [...errorFilesFromViolations, ...generatedKeywords.errorFiles],
      keywords: generatedKeywords.keywords,
      requiredFiles: generatedKeywords.requiredFiles,
      references: generatedKeywords.references
    };
    
    // Display merged keywords to UI
    await displayKeywords(taskKeywords);
    logKeywords(taskKeywords);
  } else {
    // Fallback without LLM
    taskKeywords = {
      errorFiles: extractFilesFromViolations(state.violations),
      keywords: [],
      requiredFiles: [],
      references: new Map<string, string[]>()
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Combine code context (RAG: Vector DB + Git + Local)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let projectCodeContext: any = undefined;
  let referenceCodeContexts: any[] = [];
  let lessons: any[] = [];  // ✅ Lessons from RAG
  
  // ✅ CRITICAL: Always perform fresh RAG (even on retry)
  // - Combines files from Vector DB, Git changes, and local reads
  // - Ensures latest content from all sources
  // - Local RAG is fast enough to run every time
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  
  if (retriever && vectorDB && git) {
    const combinedResult = await combineCodeContext(
      taskKeywords,
      state,
      retriever,
      vectorDB,
      git,
      directoryTree
    );
    
    // ✅ Extract context and lessons from result
    if (combinedResult) {
      projectCodeContext = combinedResult.context;
      lessons = combinedResult.lessons || [];
      
    }
    
    // Load reference projects if needed
    if (projectCodeContext && state.referenceRequests && state.referenceRequests.length > 0) {
      const { extractFilesFromCode } = await import('./utils');
      referenceCodeContexts = await loadReferenceContexts(
        state,
        taskKeywords,
        retriever,
        vectorDB,
        git,
        extractFilesFromCode
      );
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2.5: Ensure projectCodeContext is always defined
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Even if no files were loaded, create empty context for checkpoint
  if (!projectCodeContext) {
    projectCodeContext = {
      source: 'plan' as const,
      filePaths: [],
      files: [],
      stats: {
        filesLoaded: 0,
        stackTraceCount: 0,
        semanticCount: 0,
        deduplicatedCount: 0,
        estimatedTokens: 0
      }
    };
    console.log(`   ℹ️  No files loaded - using empty projectCodeContext`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Generate implementation plan (LLM 2nd request)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  // ✅ Split injection: Extract only needed UI sections for this task
  const uiDocForPlan = (() => {
    if (!state.parsedUiDocs) return undefined;
    if (nextTask.type === 'doc') return undefined;
    
    // UI injection needed for ui and design-system task types only
    const needsUi = nextTask.type === 'ui' || nextTask.type === 'design-system';
    
    if (!needsUi) return undefined;
    
    // ✅ Split injection: Use task.uiSections if available
    const uiDoc = ArtifactService.getUiDocForTask(state.parsedUiDocs, nextTask.uiSections);
    
    if (uiDoc) {
      const sectionInfo = nextTask.uiSections?.length 
        ? `sections: ${nextTask.uiSections.join(', ')}` 
        : 'all sections (no uiSections specified)';
      console.log(`🎨 [Plan] UI doc split injection: ${uiDoc.length} chars (${sectionInfo})`);
    }
    
    return uiDoc;
  })();
  
  // ✅ Extract remaining tasks for cross-task awareness in plan prompt
  const remainingTasks = (state.taskQueue?.getAll() || [])
    .filter(t => t.id !== nextTask.id)
    .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

  let planText: string | undefined;
  const requiresPlan = taskRequiresPlan(nextTask);
  const isVerificationTask = nextTask.type === 'verification';
  const planToolRounds = (state.planConversationHistory?.length ?? 0) / 2;
  // error tasks use tool loop via requiresPlan (true), verification via isVerificationTask
  const tryToolsFirst = llm && (requiresPlan || isVerificationTask) && planToolRounds < PLAN_TOOL_LOOP_MAX && !forceNoTools;

  // ── Inject previous batch split context for re-enqueued verification tasks ──
  // When a verification task was previously batch-split and re-enqueued, attach
  // the history of previous attempts so the LLM can try a different strategy.
  let diagnosticRetryContext: string | undefined;
  if (isVerificationTask && nextTask._previousBatchDiagnostics) {
    const cycle = nextTask._batchSplitCount || 0;
    diagnosticRetryContext =
      `\n\n### PREVIOUS BATCH SPLIT ATTEMPT (Cycle ${cycle})\n` +
      `Error sub-tasks were created and executed, but errors persist.\n` +
      `Previous diagnostics: ${nextTask._previousBatchDiagnostics}\n` +
      `Analyze whether these are NEW errors (cascading from compiler) or SAME errors (fix failed). ` +
      `Adjust strategy accordingly.`;
    console.log(`📋 [Plan] Injecting previous batch split context (cycle ${cycle}) into diagnostic prompt`);
  }

  // Inject completed error task details so the LLM knows what was already tried
  if (isVerificationTask && nextTask._batchSplitCount && nextTask._batchSplitCount > 0) {
    const completedErrorTasks = (state.completedTasksDetails || [])
      .filter((t: any) => t.type === 'error' && (t as any).prePlanText);

    if (completedErrorTasks.length > 0) {
      const MAX_PLAN_CHARS = 2000;
      const MAX_TOTAL_CHARS = 8000;
      let totalChars = 0;
      const attempts: string[] = [];
      for (const [i, t] of completedErrorTasks.entries()) {
        const plan = (t as any).prePlanText!;
        const truncated = plan.length > MAX_PLAN_CHARS
          ? plan.substring(0, MAX_PLAN_CHARS) + '... [truncated]'
          : plan;
        const entry = `#### Error Fix ${i + 1}: ${t.name}\n${t.description || ''}\n\`\`\`json\n${truncated}\n\`\`\``;
        totalChars += entry.length;
        if (totalChars > MAX_TOTAL_CHARS) {
          attempts.push(`... and ${completedErrorTasks.length - i} more error tasks (truncated)`);
          break;
        }
        attempts.push(entry);
      }

      const previousAttemptsContext =
        `\n\n### COMPLETED ERROR FIX TASKS (${completedErrorTasks.length} tasks)\n` +
        `These fixes were applied. Current errors may be cascading (new layer revealed) ` +
        `or regression (fix introduced new issues). Use this context to plan accurately.\n\n` +
        attempts.join('\n\n');

      diagnosticRetryContext = (diagnosticRetryContext || '') + previousAttemptsContext;
    }
  }

  // Inject accumulated plan history so plan LLM can see ALL previous attempts
  const planHistory = ((state as any)._appliedPlanHistory || []) as string[];
  if (planHistory.length > 0 && nextTask.type === 'verification') {
    const recentHistory = planHistory.slice(-3);
    let historyContext = `\n\n### PREVIOUS FIXES APPLIED BUT ERROR PERSISTS\n` +
      `${planHistory.length} remediation plan(s) were applied but the error was NOT resolved:\n\n`;
    recentHistory.forEach((plan, i) => {
      const attemptNum = planHistory.length - recentHistory.length + i + 1;
      historyContext += `#### Attempt ${attemptNum}\n\`\`\`json\n${plan}\n\`\`\`\n\n`;
    });
    if (planHistory.length >= 2) {
      historyContext +=
        `**ESCALATION**: ${planHistory.length} different fixes have failed. ` +
        `The error message is likely a SYMPTOM, not the root cause. ` +
        `Broaden your analysis:\n` +
        `- Observe **warnings and non-error output** from failed commands — they may identify the true cause\n` +
        `- Observe **mode-specific behavior** — success in one mode but failure in another points to environment, not code\n` +
        `- Consider environment-level fixes (scripts, config files, runtime settings) rather than source code changes\n` +
        `- Do NOT try another variation of the same category of fix\n`;
    } else {
      historyContext += `You MUST try a FUNDAMENTALLY DIFFERENT approach. Do NOT repeat the same fix.\n`;
    }
    diagnosticRetryContext = (diagnosticRetryContext || '') + historyContext;
    console.log(`📋 [Plan] Injected ${planHistory.length} previous plan(s) as context — ${planHistory.length >= 2 ? 'ESCALATION triggered' : 'different approach requested'}`);
  }

  if (tryToolsFirst) {
    const baseViolationsText = state.violations?.length ? formatViolations(state.violations) : undefined;
    const violationsText = diagnosticRetryContext
      ? (baseViolationsText || '') + diagnosticRetryContext
      : baseViolationsText;
    const contentBlocks = await buildPlanPromptBlocks(state, nextTask, projectCodeContext, violationsText, uiDocForPlan, remainingTasks, { hasTools: true });
    const messages = [{ role: 'user' as const, content: contentBlocks }];
    const result = await runPlanLLMWithTools(state, messages, nextTask);
    if (result && '_planExploring' in result) {
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
      }
      return {
        ...state,
        currentTask: nextTask,
        planConversationHistory: result.planConversationHistory,
        _planExploring: true,
        llmResponse: result.llmResponse,
        projectCodeContext,
        referenceCodeContexts,
        lessons,
      };
    }
    if (result && 'planText' in result) {
      planText = result.planText;
    }
  }

  if (planText === undefined) {
    if (isVerificationTask) {
      // Verification tasks: tool loop didn't produce a plan,
      // meaning build/test wasn't run in exploration. Generate empty plan —
      // execute will handle via its verification template.
      planText = '';
      console.log(`📋 [Plan] Verification task "${nextTask.name}": tool loop did not produce plan, proceeding with empty planText`);
    } else {
      planText = await generatePlanText(
        llm,
        nextTask,
        state,
        projectCodeContext,
        referenceCodeContexts,
        state.violations,
        uiDocForPlan,
        remainingTasks
      );
    }
  }
  
  // ✅ DO NOT clear violations here! They need to be passed to CodeGen node for retry context
  // Plan node consumes violations to generate retry context, but CodeGen also needs them
  // to inject violation warnings into the LLM prompt
  if (state.violations && state.violations.length > 0) {
    console.log(`📋 [Plan] Passing ${state.violations.length} violation(s) to CodeGen for prompt injection`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3.5: Diagnostic batch split — large error sets become sub-tasks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const preSplitPlanText = planText ?? '';
  planText = processDiagnosticBatchSplit(state, preSplitPlanText, nextTask);
  const batchSplitOccurred = preSplitPlanText.length > 50 && planText === '';
  const diagnosticPass = isVerificationPassWithoutCodeGen(state, planText, batchSplitOccurred);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Update state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  try {
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      projectCodeContext,
      referenceCodeContexts,
      lessons,
      planText,
      _executeBudget: planText ? computeBudgetFromPlanText(planText) : undefined,
      retries: isRetry ? state.retries : 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _planExploring: false,
      planConversationHistory: undefined,
      llmResponse: (batchSplitOccurred || diagnosticPass)
        ? { done: true, textResponse: '', thinking: '', toolCalls: [] }
        : { done: false, textResponse: '', thinking: '', toolCalls: [] },
    };
    
    // ✅ DEBUG: Verify planText is properly stored
    console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
    if (planText) {
      console.log(`   ✅ planText stored in state.planText`);
      console.log(`   Preview: "${planText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } else {
      console.log(`   ⚠️  planText is empty!`);
    }
    
    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
    }
    
    return updatedState;
  } catch (error: any) {
    console.error('\n❌ [Plan] Failed to update state:', error);
    throw error;
  }
}
