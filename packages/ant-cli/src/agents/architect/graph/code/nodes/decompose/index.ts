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
import { ArchitectGraphState, TaskQueue } from "../../state";
import { CodeTask } from "../../../../types/task";
import { JobTimingManager } from "../../../common/timing/JobTimingManager";
import { logErrorHeader } from "../shared/errorHandler";

// Import submodules
import { detectErrorInDirective, validateTasks } from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareDesignDocument } from "./designSelector";
import { callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, createTaskQueue, logTaskSummary } from "./responseParser";
import { loadCodebaseFilePaths } from "./codebaseLoader";

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
    
    const explainTask: CodeTask = {
      id: 'explain-1',
      name: 'Explain code',
      type: 'explain',
      priority: 200,
      description: state.directive || 'Explain the codebase'
    };
    
    const taskQueue = new TaskQueue<CodeTask>();
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
  // STEP 2: Keyword-based RAG (if requireRagForDecompose)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 
  // PURPOSE: Provide file list to LLM for accurate task planning
  // - LLM uses this list to know what files exist
  // - Prevents "Create missing X" when X actually exists
  // - Keywords from detectEnvironment determine search scope
  //
  let codebaseFilePaths: string[] | undefined = undefined;
  let gitDiffResult: any = undefined;
  
  
  if (state.requireRagForDecompose && state.decomposeKeywords) {
    const result = await loadCodebaseFilePaths(state);
    codebaseFilePaths = result.filePaths.length > 0 ? result.filePaths : undefined;
    gitDiffResult = result.gitDiff;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Prepare design documents (environment-aware)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { designDoc, hasDesignDoc } = prepareDesignDocument(state);
  
  // ✅ Detect error in directive BEFORE building prompt
  const hasErrorInDirective = detectErrorInDirective(state.directive);
  if (hasErrorInDirective) {
    console.log(`🚨 [Decompose] Error detected in directive → activating error analysis mode`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!state.deps?.promptEngine) {
    throw new Error('[Decompose] PromptEngine not available');
  }
  
  const prompt = await state.deps.promptEngine.buildDecomposePrompt({
    directive: state.directive || '',
    designDoc,
    hasDesignDoc,
    mode: state.mode || 'unknown',
    profile: state.profile,
    codebaseFilePaths,  // ✅ File paths from keyword search (for task planning)
    hasErrorInDirective // ✅ Pass to prompt for error analysis mode
  });
  
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
  // Note: hasErrorInDirective already calculated in STEP 3
  validateTasks(tasks, state.mode, state.directive, hasErrorInDirective);
  
  const { taskQueue, featureTasks } = createTaskQueue(tasks);
  logTaskSummary(tasks, referenceRequests);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.5: Exit decompose node for workflow tracking
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose');
  }
  
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
  // STEP 8: Handle jobId/jobTiming (for replan scenarios)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { JobTimingManager } = await import('../../../common/timing/JobTimingManager');
  
  // Check if replan preserved jobId/jobTiming
  const replanJobId = (state as any)._replanJobId;
  const replanJobTiming = (state as any)._replanJobTiming;
  
  let jobId: string;
  let jobTiming: any;
  
  if (replanJobId) {
    console.log(`🔄 [Decompose] Replan: Preserving job timing (Job ID: ${replanJobId})`);
    jobId = replanJobId;
    jobTiming = replanJobTiming;
  } else {
    // ✨ Get jobId from session (already initialized in resolve node)
    const sessionData = await state.deps?.session?.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    jobId = sessionData?.state?.jobId || state._httpJobId!;
    jobTiming = sessionData?.state?.jobTiming || JobTimingManager.initializeNewJob(state._httpJobId!).jobTiming;
    console.log(`⏱️  [Decompose] Using job ID from session: ${jobId}`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 9: Save checkpoint with actual tasks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const updatedState = {
    ...state,
    taskQueue,
    featureTasks,
    referenceRequests: referenceRequests || state.referenceRequests || [],
    projectCodeContext,
    referenceCodeContexts: [],
    totalSubtasks: tasks.length + 1,
    subtaskIndex: 0,
    completedTasks: state.completedTasks || [],
    completedTasksDetails: state.completedTasksDetails || [],
    jobId,
    jobTiming
  };
  
  // ✅ Save checkpoint with tasks
  if (state.deps?.session) {
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`✅ [Decompose] Checkpoint saved with ${tasks.length} tasks\n`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 10: Return updated state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return updatedState;
}
