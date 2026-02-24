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
import { generatePlanText, runPlanLLMWithTools, buildPlanPrompt, PLAN_TOOL_LOOP_MAX, taskRequiresPlan } from "./planGeneration";
import { extractFilesFromViolations, formatViolations } from "../shared/violationFormatter";

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
    
    console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})\n`);
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
  // STEP 0.9: Re-entry from tool (plan↔tool loop)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state._planExploring === true && state.planConversationHistory?.length) {
    const overLimit = state.planConversationHistory.length >= PLAN_TOOL_LOOP_MAX * 2; // ~2 messages per round
    if (overLimit) {
      console.log(`\n⚠️ [Plan] Plan↔tool loop limit (${PLAN_TOOL_LOOP_MAX}) reached; falling back to plan without tools`);
      state._planExploring = false;
      state.planConversationHistory = undefined;
      forceNoTools = true;
      // Fall through to STEP 0.8 and continue with normal flow
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
        const planText = result.planText;
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
  
  if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    const generatedKeywords = await generateTaskKeywords(llm, nextTask, state, directoryTree);
    
    // ✅ STEP 1.5: Merge with violation files (after LLM response)
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
    
    // ✅ Display merged keywords to UI
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
    if (nextTask.type === 'setup' || nextTask.type === 'doc') return undefined;
    
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
  const planToolRounds = (state.planConversationHistory?.length ?? 0) / 2;
  const tryToolsFirst = llm && requiresPlan && planToolRounds < PLAN_TOOL_LOOP_MAX && !forceNoTools;

  if (tryToolsFirst) {
    const violationsText = state.violations?.length ? formatViolations(state.violations) : undefined;
    const prompt = await buildPlanPrompt(state, nextTask, projectCodeContext, violationsText, uiDocForPlan, remainingTasks);
    const messages = [{ role: 'user' as const, content: prompt }];
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
  
  // ✅ DO NOT clear violations here! They need to be passed to CodeGen node for retry context
  // Plan node consumes violations to generate retry context, but CodeGen also needs them
  // to inject violation warnings into the LLM prompt
  if (state.violations && state.violations.length > 0) {
    console.log(`📋 [Plan] Passing ${state.violations.length} violation(s) to CodeGen for prompt injection`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Update state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  try {
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      projectCodeContext,
      referenceCodeContexts,
      lessons,  // ✅ Include lessons from RAG for prompt injection
      planText,  // ✅ Store in state.planText (single source of truth)
      retries: isRetry ? state.retries : 0,  // ✅ Clear retries for new task
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      workspaceConfig: state.workspaceConfig,  // ✅ CRITICAL: Explicitly preserve workspaceConfig
      _planExploring: false,
      planConversationHistory: undefined,
      // ✅ violations and violationMessage are preserved in state (not cleared)
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
