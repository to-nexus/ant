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

// Import submodules
import { generateTaskKeywords, displayKeywords, logKeywords } from "./keywordGeneration";
import { loadStackTraceFiles } from "./stackTraceLoader";
import { loadSemanticFiles } from "./semanticSearch";
import { loadReferenceContexts } from "./referenceLoader";
import { generatePlanText } from "./planGeneration";
import { extractFilesFromCode } from "./utils";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;

  const enforcementReason = state.enforcementReason;
  const isRetry = Boolean(enforcementReason);
  
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
    
    // Update Kanban UI
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      console.log(`\n🔥 [Plan] Updating Kanban → task started`);
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
  // STEP 1: Generate task-specific keywords
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let taskKeywords = {
    stackTrace: [] as string[],
    keywords: [] as string[],
    references: new Map<string, string[]>()
  };
  
  if (llm) {
    console.log(`🔑 [Plan] Generating search keywords...`);
    taskKeywords = await generateTaskKeywords(llm, nextTask, state);
    
    await displayKeywords(taskKeywords);
    logKeywords(taskKeywords);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Load code context (Stack Trace + Semantic)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let projectCodeContext: any = undefined;
  let referenceCodeContexts: any[] = [];
  
  // ✅ CRITICAL: On retry, reuse existing projectCodeContext to avoid outdated vector DB content
  // We'll reload files from disk to get latest changes
  if (isRetry && state.projectCodeContext && state.projectCodeContext.filePaths && state.projectCodeContext.filePaths.length > 0) {
    const git = state.deps?.git;
    console.log(`🔄 [Plan] Retry detected - reloading ${state.projectCodeContext.filePaths.length} files from disk for latest content...`);
    
    if (git) {
      const reloadedFiles: any[] = [];
      for (const filePath of state.projectCodeContext.filePaths) {
        try {
          const fullPath = require('path').join(state.context.workingDir, filePath);
          const content = await git.readFile(fullPath);
          if (content) {
            reloadedFiles.push({ path: filePath, content });
          }
        } catch (e: any) {
          console.warn(`   ⚠️  Failed to reload ${filePath}: ${e.message}`);
        }
      }
      
      projectCodeContext = {
        ...state.projectCodeContext,
        files: reloadedFiles,
        filePaths: reloadedFiles.map(f => f.path),
        stats: {
          ...state.projectCodeContext.stats,
          filesLoaded: reloadedFiles.length
        }
      };
      
      console.log(`   ✅ Reloaded ${reloadedFiles.length} files from disk (latest version)`);
    }
  }
  
  const hasStackTrace = taskKeywords.stackTrace.length > 0;
  const hasKeywords = taskKeywords.keywords.length > 0;
  
  if (!projectCodeContext && (hasStackTrace || hasKeywords)) {
    const retriever = state.deps?.retriever;
    const vectorDB = state.deps?.vectorDB;
    const git = state.deps?.git;
    
    if (retriever && vectorDB && git) {
      console.log(`🔍 [Plan] Two-tier search (stackTrace → semantic)...`);
      
      // Tier 1: Stack trace files (priority)
      const stackFiles = await loadStackTraceFiles(
        taskKeywords.stackTrace,
        state,
        retriever,
        vectorDB,
        git,
        extractFilesFromCode
      );
      
      // Tier 2: Semantic files (context, dynamic quota)
      const semanticFiles = await loadSemanticFiles(
        taskKeywords.keywords,
        state,
        retriever,
        vectorDB,
        git,
        extractFilesFromCode,
        stackFiles.map(f => f.path)  // ✅ Exclude already loaded - avoid duplicate content
      );
      
      // Merge & Deduplicate (simple)
      // Stack trace files come first (priority), then semantic
      const allFiles = [...stackFiles, ...semanticFiles];
      const uniqueFiles = Array.from(
        new Map(allFiles.map(f => [f.path, f])).values()
      );
      
      projectCodeContext = {
        filePaths: uniqueFiles.map(f => f.path),
        files: uniqueFiles,
        stats: {
          filesLoaded: uniqueFiles.length,
          stackTraceCount: stackFiles.length,
          semanticCount: semanticFiles.length,
          deduplicatedCount: allFiles.length - uniqueFiles.length
        },
        source: 'plan' as const
      };
      
      console.log(`   ✅ Total: ${projectCodeContext.stats.filesLoaded} files (${stackFiles.length} stack + ${semanticFiles.length} semantic)`);
      if (projectCodeContext.stats.deduplicatedCount > 0) {
        console.log(`   🔄 Deduplicated: ${projectCodeContext.stats.deduplicatedCount} duplicates removed`);
      }
      
      if (projectCodeContext.filePaths.length > 0) {
        projectCodeContext.filePaths.forEach((f: string) => console.log(`      📄 ${f}`));
      }
      
      // Git diff summary
      if (git) {
        const { generateGitDiffSummary } = require('../../../../../../core/codebase/GitDiffSummary');
        projectCodeContext.gitDiff = await generateGitDiffSummary(git, state.context.workingDir, projectCodeContext.filePaths);
      }
      
      // Load reference projects
      if (state.referenceRequests && state.referenceRequests.length > 0) {
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
  // STEP 3: Generate implementation plan
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const planText = await generatePlanText(
    llm,
    nextTask,
    state,
    projectCodeContext,
    referenceCodeContexts
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Update state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const shouldClearEnforcement = !isRetry;
  
  try {
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      projectCodeContext,
      referenceCodeContexts,
      planText,
      retries: shouldClearEnforcement ? 0 : state.retries,
      enforcementReason: shouldClearEnforcement ? null : state.enforcementReason,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit
    };
    
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
