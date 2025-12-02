/**
 * Decompose Node (Refactored)
 * 
 * Meta-level planning: Break the overall task into executable tasks
 * This runs ONCE at the beginning to create the initial task queue.
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - validation.ts: Task validation logic
 * - sessionManager.ts: Session restore/save logic
 * - designSelector.ts: Design document selection (environment-aware)
 * - llmCaller.ts: LLM prompt building and calling
 * - responseParser.ts: Parse LLM response into tasks
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, Task, TaskQueue } from "../../state";
import { JobTimingManager } from "../../../common/timing/JobTimingManager";
import { logErrorHeader } from "../shared/errorHandler";

// Import submodules
import { detectErrorInDirective, validateTasks } from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareDesignDocument } from "./designSelector";
import { buildDecomposePrompt, callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, createTaskQueue, logTaskSummary } from "./responseParser";

/**
 * Decompose Node - Main Entry Point
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // Increment recursion count
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'decompose', 
      taskInfo, 
      llmInfo,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 DECOMPOSE: Breaking down specification into tasks');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 EXPLAIN MODE: Skip decompose, create single explain task
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.mode === 'explain') {
    console.log('💡 [Decompose] Explain mode detected - creating single explanation task\n');
    
    const explainTask: Task = {
      id: 'explain-1',
      name: 'Explain code',
      type: 'explain',
      priority: 200,
      description: state.directive || 'Explain the codebase'
    };
    
    const taskQueue = new TaskQueue();
    taskQueue.push(explainTask);
    
    return {
      ...state,
      taskQueue,
      featureTasks: new Map(),
      referenceRequests: [],
      projectCodeContext: undefined,
      referenceCodeContexts: [],
      totalSubtasks: 1,
      subtaskIndex: 0,
      completedTasks: [],
      completedTasksDetails: []
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Check for existing session (resume support)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const sessionCheck = await checkSessionRestore(state);
  
  if (sessionCheck.shouldRestore && sessionCheck.session) {
    if (sessionCheck.hasAdditionalDirective) {
      // Replan: merge directives and decompose
      console.log('🔄 [Decompose] Replan mode: merging directives and re-decomposing');
      state = {
        ...state,
        directive: sessionCheck.mergedDirective,
        completedTasks: sessionCheck.session.state.completedTasks || [],
        completedTasksDetails: sessionCheck.session.state.completedTasksDetails || [],
        referenceRequests: sessionCheck.session.state.referenceRequests || [],
        retries: 0,
        previousAttempts: [],
        enforcementHistory: [],
        lastViolations: [],
        resolvedCategories: []
      } as any;
      
      (state as any)._replanJobId = sessionCheck.session.jobId;
      (state as any)._replanJobTiming = sessionCheck.session.jobTiming;
      
      // Fall through to decomposition
    } else {
      // Normal resume
      return restoreFromSession(state, sessionCheck.session);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Conditional RAG (if requireRagForDecompose)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let codebaseFilePaths: string[] | undefined = undefined;
  let gitDiffResult: any = undefined;
  
  if (state.requireRagForDecompose && state.decomposeKeywords?.codebase && state.decomposeKeywords.codebase.length > 0) {
    console.log(`🔍 [Decompose] RAG required - searching with keywords...`);
    
    const retriever = state.deps?.retriever;
    const vectorDB = state.deps?.vectorDB;
    const git = state.deps?.git;
    
    if (!retriever || !vectorDB) {
      console.warn(`⚠️  [Decompose] Retriever or VectorDB not available, skipping RAG`);
    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 2a. Vector DB Search (main project) - FILE PATHS ONLY
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const searchQuery = state.decomposeKeywords.codebase.join(' ');
      const searchResult = await retriever.retrieve(
        searchQuery,
        state.context.workingDir,
        { vectorDB, git },
        {
          project: state.context.project,
          maxTokens: 5000,
          maxFiles: 20,
          mode: state.mode || 'refactor'
        }
      );
      
      // Extract file paths only (no content)
      codebaseFilePaths = searchResult.files?.map((f: any) => 
        typeof f === 'string' ? f : f.path
      ) || [];
      
      console.log(`   ✅ Found ${codebaseFilePaths.length} relevant files`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 2b. Git Diff Summary
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (git) {
        const { generateGitDiffSummary } = require('../../../../../core/codebase/GitDiffSummary');
        gitDiffResult = await generateGitDiffSummary(git, state.context.workingDir, codebaseFilePaths);
        
        if (gitDiffResult?.hasChanges) {
          console.log(`   ✅ Git diff: ${gitDiffResult.changedFiles.length} changed files`);
        }
      }
    }
  } else {
    console.log(`ℹ️  [Decompose] RAG not required (generate mode or no keywords)`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Prepare design documents (environment-aware)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { designDoc, hasDesignDoc } = prepareDesignDocument(state);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const prompt = await buildDecomposePrompt(
    state.deps?.promptEngine,
    {
      directive: state.directive || '',
      designDoc,
      hasDesignDoc,
      mode: state.mode || 'unknown',
      profile: state.profile,
      codebaseFilePaths
      // gitDiff injected via injection file in PromptEngine
    }
  );
  
  let rawResponse: string;
  try {
    rawResponse = await callLLMForDecompose(llm, prompt);
  } catch (error) {
    logErrorHeader('Decompose');
    console.error(error);
    throw error;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 5: Parse response and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let parsed;
  try {
    parsed = parseLLMResponse(rawResponse);
  } catch (error) {
    logErrorHeader('Decompose');
    console.error(error);
    throw error;
  }
  
  const { tasks, referenceRequests } = parsed;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Validate and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const hasErrorInDirective = detectErrorInDirective(state.directive);
  validateTasks(tasks, state.mode, state.directive, hasErrorInDirective);
  
  const { taskQueue, featureTasks } = createTaskQueue(tasks);
  logTaskSummary(tasks, referenceRequests);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 7: Store codebase context (file paths + gitDiff)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const projectCodeContext = codebaseFilePaths && codebaseFilePaths.length > 0 ? {
    filePaths: codebaseFilePaths,
    files: [],
    gitDiff: gitDiffResult,
    stats: {
      filesLoaded: codebaseFilePaths.length,
      estimatedTokens: 0
    },
    source: 'decompose' as const
  } : undefined;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8: Initialize job timing (if new job)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Note: jobId and jobTiming are not part of ArchitectGraphState
  // They're managed separately by JobTimingManager
  
  // Check if replan preserved jobId/jobTiming
  const replanJobId = (state as any)._replanJobId;
  const replanJobTiming = (state as any)._replanJobTiming;
  
  if (replanJobId) {
    console.log(`🔄 [Decompose] Replan: Preserving job timing (Job ID: ${replanJobId})`);
  } else {
    // New job - timing will be initialized by runner
    console.log(`⏱️  [Decompose] New job - timing will be managed by runner`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 9: Return updated state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    ...state,
    taskQueue,
    featureTasks,
    referenceRequests: referenceRequests || state.referenceRequests || [],
    projectCodeContext,
    referenceCodeContexts: [],
    totalSubtasks: tasks.length + 1,
    subtaskIndex: 0,
    completedTasks: state.completedTasks || [],
    completedTasksDetails: state.completedTasksDetails || []
  };
}
