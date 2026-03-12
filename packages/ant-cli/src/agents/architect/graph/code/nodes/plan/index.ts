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
import { ArchitectGraphState, TASK_PRIORITIES } from "../../state";
import { CodeTask } from "../../../../types/task";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";

// Import submodules
import { generateTaskKeywords, displayKeywords, logKeywords, updateKeywordsWithRetrieval } from "./keywordGeneration";
import { combineCodeContext, TaskKeywords } from "./combineCodeContext";
import { loadReferenceContexts } from "./referenceLoader";
import { generatePlanText, runPlanLLMWithTools, buildPlanPrompt, buildPlanPromptBlocks, PLAN_TOOL_LOOP_MAX, taskRequiresPlan, finalizePlanFromExploration } from "./planGeneration";
import { extractFilesFromViolations, formatViolations } from "../shared/violationFormatter";
import { detectTestFiles } from "./testFileDetector";

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
 * When a diagnostic task (verification/error) finishes its plan tool-loop with
 * build/test already passing and no plan to execute, codeGen would only ask the
 * LLM to output `<done>true</done>` — a wasted call.  Detect this and let the
 * plan node set `done: true` directly so planRouter skips codeGen entirely.
 */
function isDiagnosticPassWithoutCodeGen(
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

/**
 * Detect batched diagnostic plan and split into sub-tasks.
 * Called from every path that produces a planText for diagnostic tasks.
 *
 * When the plan JSON contains a `batches` array with >1 entries,
 * each batch becomes an independent error sub-task with prePlanText.
 * The original task is re-enqueued (not completed) so it re-runs after all error fixes.
 *
 * @returns updated planText (empty string if split occurred, original otherwise)
 */
function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  const isDiagnosticTask = nextTask.type === 'verification' || nextTask.type === 'error';

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

  if (!isDiagnosticTask) {
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

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    const parallelGroup = hasFileOverlap ? undefined : `error-batch-${Date.now()}`;

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
        parallelGroup,
      };
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // Re-enqueue the original task (clean state) instead of creating a new one.
    // Priority FINAL_VERIFICATION(1000) > error priority(999) ensures it runs last.
    const requeuedTask: CodeTask = {
      ...nextTask,
      timing: undefined,
      interrupted: undefined,
    };
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
    const prevCallIndex = state._codeGenCallIndex || 0;
    const isVerificationRetry = nextTask.type === 'verification';
    
    if (isVerificationRetry) {
      // Verification retry: preserve conversationHistory and callIndex.
      // Clearing these causes enableThinking=true on every retry (because
      // isAfterToolCall checks history length), which triggers a thinking-only
      // loop where the LLM produces only a thinking block with no tool calls.
      state._finalTaskLoopCount = 0;
      console.log(`\n🔄 [Plan] Verification retry: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})`);
      console.log(`   ♻️  Preserved: conversationHistory (${state.conversationHistory?.length ?? 0}), _codeGenCallIndex (${prevCallIndex})`);
      console.log(`   ♻️  Reset: _finalTaskLoopCount → 0\n`);
    } else {
      state._codeGenCallIndex = 0;
      state._finalTaskLoopCount = 0;
      state.conversationHistory = [];
      console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})`);
      console.log(`   ♻️  Reset: _codeGenCallIndex ${prevCallIndex}→0, conversationHistory cleared\n`);
    }
  } else if (state._planExploring === true && state.currentTask) {
    nextTask = state.currentTask;
    console.log(`\n🔄 [Plan] Re-entry from tool loop for task: ${nextTask.name}\n`);
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
    state._codeGenCallIndex = 0;

    // ✅ Initialize verification tracker for diagnostic tasks (verification + error)
    if (nextTask.type === 'verification' || nextTask.type === 'error') {
      const testsRequired = nextTask.type === 'verification'
        ? detectTestFiles(state.projectCodeContext)
        : false; // error tasks: build only, tests deferred to Final Verification
      state._verificationTracker = {
        buildPassed: false,
        testPassed: false,
        testsRequired,
      };
      console.log(`🔍 [Plan] VerificationTracker initialized: type=${nextTask.type}, testsRequired=${testsRequired}`);
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
    }
    
    // ✅ CRITICAL: Save checkpoint after task started so session has correct currentTask
    // Without this, manual cancel during codeGen can't find the in-progress task
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
      undefined,
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
  // When skipped: preserves planText + conversationHistory → codeGen continues from interruption point
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
  // with prePlanText already set. Skip all plan generation and go straight to codeGen.
  const hasPrePlanText = !isRetry && (nextTask as CodeTask).prePlanText && (nextTask as CodeTask).prePlanText!.length > 50;
  
  if (hasPrePlanText) {
    console.log(`\n⚡ [Plan] Pre-planned error task "${nextTask.name}" — using prePlanText (${(nextTask as CodeTask).prePlanText!.length} chars)`);
    console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);
    console.log(`   Build guard: disabled (deferred to Final Verification)`);
    
    // Clear verificationTracker — build guard is handled by Final Verification
    state._verificationTracker = undefined;
    
    // Exit node for workflow tracking
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
    }
    
    return {
      ...state,
      currentTask: nextTask,
      planText: (nextTask as CodeTask).prePlanText!,
      retries: 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      conversationHistory: [],
      _planExploring: false,
      planConversationHistory: undefined,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0.7: Diagnostic task retry — always re-diagnose
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Diagnostic tasks (verification/error) must re-run build/test on retry to get
  // fresh error state. Never skip to reuse old planText — the codebase has changed.
  if (isRetry && (nextTask.type === 'verification' || nextTask.type === 'error')) {
    console.log(`\n🔄 [Plan] Diagnostic retry — will re-run build/test via tool loop for fresh error analysis`);
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
        const diagnosticPass = isDiagnosticPassWithoutCodeGen(state, finalizedPlan, batchSplitOccurred);
        state._planExploring = false;
        state.planConversationHistory = undefined;
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
        }
        return {
          ...state,
          currentTask: nextTask,
          projectCodeContext: state.projectCodeContext,
          referenceCodeContexts: state.referenceCodeContexts,
          lessons: state.lessons ?? [],
          planText: finalizedPlan,
          _planExploring: false,
          planConversationHistory: undefined,
          retries: isRetry ? state.retries : 0,
          completedTasksDetails: state.completedTasksDetails || [],
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          workspaceConfig: state.workspaceConfig,
          ...((batchSplitOccurred || diagnosticPass) ? {
            llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] },
          } : {}),
        };
      }
      console.log(`⚠️ [Plan] finalizePlanFromExploration failed; falling back to generatePlanText`);
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
        const diagnosticPass = isDiagnosticPassWithoutCodeGen(state, planText, batchSplitOccurred);
        const updatedState = {
          ...state,
          currentTask: nextTask,
          projectCodeContext: state.projectCodeContext,
          referenceCodeContexts: state.referenceCodeContexts,
          lessons: state.lessons ?? [],
          planText,
          _planExploring: false,
          planConversationHistory: undefined,
          retries: isRetry ? state.retries : 0,
          completedTasksDetails: state.completedTasksDetails || [],
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          workspaceConfig: state.workspaceConfig,
          ...((batchSplitOccurred || diagnosticPass) ? {
            llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] },
          } : {}),
        };
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', (state as any).workerId ?? 0);
        }
        return updatedState;
      }
      // null: fall through to normal flow
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
      
      // ✅ Save retrieval results to keyword debug log (non-blocking)
      const ctx = combinedResult.context;
      updateKeywordsWithRetrieval(state, nextTask.id, {
        requiredFilesLoaded: ctx.files.filter(f => taskKeywords.requiredFiles.includes(f.path)).map(f => f.path),
        errorFilesLoaded: ctx.files.filter(f => taskKeywords.errorFiles.includes(f.path)).map(f => f.path),
        semanticFilesLoaded: ctx.files.filter(f => 
          !taskKeywords.requiredFiles.includes(f.path) && !taskKeywords.errorFiles.includes(f.path)
        ).map(f => f.path),
        totalFilesLoaded: ctx.stats.filesLoaded,
      }).catch(() => {});
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
    
    // Check if UI injection is needed
    const needsUi = (() => {
      if (nextTask.ui === true) return true;
      if (nextTask.ui === false) return false;
      
      // Fallback: check task name/description for UI keywords
      const text = `${nextTask.name}\n${nextTask.description}`.toLowerCase();
      return /(ui|ux|header|footer|layout|component|section|hero|card|button|nav|style|css|token|theme)/.test(text);
    })();
    
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
  const isDiagnosticTask = nextTask.type === 'verification' || nextTask.type === 'error';
  const planToolRounds = (state.planConversationHistory?.length ?? 0) / 2;
  const tryToolsFirst = llm && (requiresPlan || isDiagnosticTask) && planToolRounds < PLAN_TOOL_LOOP_MAX && !forceNoTools;

  if (tryToolsFirst) {
    const violationsText = state.violations?.length ? formatViolations(state.violations) : undefined;
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
    if (isDiagnosticTask) {
      // Diagnostic tasks (verification/error): tool loop didn't produce a plan,
      // meaning build/test wasn't run in exploration. Generate empty plan —
      // codeGen will handle via its diagnostic template.
      planText = '';
      console.log(`📋 [Plan] Diagnostic task "${nextTask.name}": tool loop did not produce plan, proceeding with empty planText`);
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
  const diagnosticPass = isDiagnosticPassWithoutCodeGen(state, planText, batchSplitOccurred);
  
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
      retries: isRetry ? state.retries : 0,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,
      _planExploring: false,
      planConversationHistory: undefined,
      ...((batchSplitOccurred || diagnosticPass) ? {
        llmResponse: { done: true, textResponse: '', thinking: '', toolCalls: [] },
      } : {}),
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
