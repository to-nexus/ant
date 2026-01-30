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
import { generateTaskKeywords, displayKeywords, logKeywords } from "./keywordGeneration";
import { combineCodeContext } from "./combineCodeContext";
import { loadReferenceContexts } from "./referenceLoader";
import { generatePlanText } from "./planGeneration";
import { extractFilesFromViolations } from "../shared/violationFormatter";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;

  const isRetry = state.violations && state.violations.length > 0;
  
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
  } else {
    nextTask = state.taskQueue?.pop();
    
    if (!nextTask) {
      throw new Error('[Plan] No tasks in queue');
    }
    
    console.log(`\n📋 [Plan] Next task: ${nextTask.name}\n`);
    
    // Start timing
    const { TaskTimingHelper } = await import('../../state');
    console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
    nextTask = TaskTimingHelper.startTask(nextTask);
    
    // ✅ Initialize token usage tracking for new task
    const { resetTaskTokenUsage } = await import('../../../common/llmHelpers');
    resetTaskTokenUsage(state as any);
    
    // Update Kanban UI
    console.log(`\n🔍 [Plan] Kanban check: _httpJobId=${state._httpJobId}, kanbanUpdate=${!!state.deps?.kanbanUpdate}`);
    if (state._httpJobId && state.deps?.kanbanUpdate) {
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
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Generate task-specific keywords (LLM 1st request)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let taskKeywords;
  
  if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    const generatedKeywords = await generateTaskKeywords(llm, nextTask, state);
    
    // ✅ STEP 1.5: Merge with violation files (after LLM response)
    const errorFilesFromViolations = extractFilesFromViolations(state.violations);
    
    if (errorFilesFromViolations.length > 0) {
      console.log(`🔍 [Plan] Merging ${errorFilesFromViolations.length} file(s) from violations:`);
      errorFilesFromViolations.forEach(f => console.log(`   - ${f}`));
    }
    
    taskKeywords = {
      errorFiles: [...errorFilesFromViolations, ...generatedKeywords.errorFiles],
      keywords: generatedKeywords.keywords,
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
      git
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
    if (nextTask.type === 'setup') return undefined;  // Setup tasks don't need UI spec
    
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
  
  const planText = await generatePlanText(
    llm,
    nextTask,
    state,
    projectCodeContext,
    referenceCodeContexts,
    state.violations,  // ✅ Pass violations for retry context
    uiDocForPlan  // ✅ Pass uiDoc for UI-related tasks
  );
  
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
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan');
    }
    
    return updatedState;
  } catch (error: any) {
    console.error('\n❌ [Plan] Failed to update state:', error);
    throw error;
  }
}
