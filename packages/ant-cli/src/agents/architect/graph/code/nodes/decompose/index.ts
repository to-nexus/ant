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
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { getEstimatingLabel } from "../../../common/timing/estimatingLabels";

// Import submodules
import { validateTasks } from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareDesignDocument } from "./designSelector";
import { callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, createTaskQueue, logTaskSummary } from "./responseParser";
import { loadCodebaseFilePaths } from "./codebaseLoader";

/**
 * Decompose Node - Main Entry Point
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('decompose', state._uiLocale), 'decompose');
  }
  
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
      0,
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
  if (state.detectionReport?.jobMode === 'explain') {
    console.log('💡 [Decompose] Explain mode detected - creating single explanation task\n');
    
    const explainTask: CodeTask = {
      id: 'explain-1',
      name: 'Explain code',
      type: 'explain',
      priority: 200,
      ui: false,
      description: state.directive || 'Explain the codebase'
    };
    
    const taskQueue = new TaskQueue<CodeTask>();
    taskQueue.push(explainTask);
    
    // ✅ Workflow exitNode (explain 조기 반환에서도 호출 필요)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
    }
    
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
  
  
  if (state.detectionReport?.requireRag && state.decomposeKeywords) {
    const result = await loadCodebaseFilePaths(state);
    codebaseFilePaths = result.filePaths.length > 0 ? result.filePaths : undefined;
    gitDiffResult = result.gitDiff;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Prepare design documents (environment-aware)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { designDoc, hasDesignDoc } = prepareDesignDocument(state);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!state.deps?.promptEngine) {
    throw new Error('[Decompose] PromptEngine not available');
  }
  
  // ✅ CRITICAL: Check if project has existing code via git (fallback if Vector DB empty)
  // Vector DB might be empty even when code exists (user hasn't run 'ant index')
  let hasProjectCode = false;
  if (state.deps?.git) {
    try {
      const repoRoot = await state.deps.git.getRepoRoot();
      console.log(`   🔍 [Decompose] Checking project code at: ${repoRoot}`);
      
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Simple check: does src/ or lib/ or any .ts/.js file exist?
      const entries = await fs.readdir(repoRoot, { withFileTypes: true });
      
      // Check for common source directories
      const hasSourceDir = entries.some((e: any) => 
        e.isDirectory() && (e.name === 'src' || e.name === 'lib' || e.name === 'app')
      );
      
      // Check for package.json (strong indicator of existing project)
      const hasPackageJson = entries.some((e: any) => 
        e.isFile() && e.name === 'package.json'
      );
      
      hasProjectCode = hasSourceDir || hasPackageJson;
      console.log(`   ${hasProjectCode ? '✅' : '❌'} Project code exists: ${hasProjectCode} (hasSourceDir=${hasSourceDir}, hasPackageJson=${hasPackageJson})`);
      
      if (hasProjectCode && (!codebaseFilePaths || codebaseFilePaths.length === 0)) {
        console.log(`⚠️  [Decompose] Project has code but Vector DB is empty`);
        console.log(`   Tip: Run 'ant index ${state.context.project}' to enable semantic search\n`);
      }
    } catch (error) {
      console.warn(`⚠️  [Decompose] Failed to check project code existence:`, error);
      // Don't fail the entire decompose, just assume no code
      hasProjectCode = false;
    }
  }
  
  // ✅ Generate UI sections summary for split injection (shows available sections without full content)
  const uiSectionsSummary = state.parsedUiDocs 
    ? ArtifactService.getUiSectionsSummary(state.parsedUiDocs) 
    : undefined;
  
  const decomposeVars = {
    directive: state.directive || '',
    designDoc,
    hasDesignDoc,
    mode: state.detectionReport?.jobMode || 'unknown',
    profile: state.profile,
    codebaseFilePaths,  // ✅ File paths from keyword search (for task planning)
    hasProjectCode,     // ✅ CRITICAL: Actual codebase existence (git-based, not Vector DB)
    uiSectionsSummary,  // ✅ UI sections summary with token estimates (for split injection)
    runtimeAssetsIndex: state.runtimeAssetsIndex
  };
  
  const prompt = await state.deps.promptEngine.buildDecomposePrompt(decomposeVars);
  
  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'decompose',
        prompt.length,
        {
          templatePath: 'code/phases/decompose/base',
          usedTemplates: [
            'code/phases/decompose/rules',
            'code/phases/decompose/mode-guide',
            'code/phases/decompose/error-or-general',
            'code/phases/decompose/existing-code-check',
            'code/phases/decompose/design-doc-guide',
          ],
          injectedVariables: {
            directive: decomposeVars.directive ? `[${decomposeVars.directive.length} chars]` : undefined,
            designDoc: designDoc ? `[${designDoc.length} chars]` : undefined,
            hasDesignDoc,
            mode: decomposeVars.mode,
            hasProjectCode,
            codebaseFilePaths: codebaseFilePaths?.length || 0,
            uiSectionsSummary: uiSectionsSummary ? `[${uiSectionsSummary.length} chars]` : undefined,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Decompose] Failed to log prompt:`, logError);
    }
  }
  
  let rawResponse: string;
  let decomposeTokenUsage: any;
  try {
    const result = await callLLMForDecompose(llm, prompt, state.workspaceConfig);
    rawResponse = result.response;
    decomposeTokenUsage = result.tokenUsage;
    
    // ✅ Accumulate decompose token usage to job-level (not task-level, as decompose runs before tasks)
    if (decomposeTokenUsage) {
      const { finalizeStreamTokenUsage } = await import('../../../common/llmHelpers');
      finalizeStreamTokenUsage(state as any, decomposeTokenUsage, { taskLevel: false, jobLevel: true });
    }
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
  validateTasks(tasks, state.detectionReport?.jobMode, state.directive);
  
  const { taskQueue, featureTasks } = createTaskQueue(tasks);
  logTaskSummary(tasks, referenceRequests);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.5: Exit decompose node for workflow tracking
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
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
  
  let timingJobId: string;
  let jobTiming: any;
  const finalPhaseTimings = { ...(state._phaseTimings || {}), decompose: Date.now() - phaseStart };
  
  if (replanJobId) {
    console.log(`🔄 [Decompose] Replan: Preserving job timing (Job ID: ${replanJobId})`);
    timingJobId = replanJobId;
    jobTiming = replanJobTiming;
  } else {
    // ✨ Get jobId from session (already initialized in resolve node)
    const sessionData = await state.deps?.session?.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    timingJobId = sessionData?.state?.jobId || state._httpJobId!;
    const existingJobTiming = sessionData?.state?.jobTiming || JobTimingManager.initializeNewJob(state._httpJobId!).jobTiming;
    
    // ✅ CRITICAL: Finalize estimating phase (detectEnvironment + decompose)
    const estimatingStartTime = existingJobTiming.startedAt || new Date().toISOString();
    jobTiming = JobTimingManager.finalizeEstimatingPhase(existingJobTiming, estimatingStartTime, finalPhaseTimings);
    
    console.log(`⏱️  [Decompose] Using job ID from session: ${timingJobId}`);
    console.log(`⏰  [Decompose] Estimating phase finalized: ${Math.round((jobTiming.estimatingDuration || 0) / 1000)}s`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8.5: Snapshot estimating phase token usage
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Capture job-level tokenUsage BEFORE tasks begin. At this point, state.tokenUsage
  // contains only estimating phase tokens (detectEnvironment + decompose).
  const estimatingTokenUsage = (state as any).tokenUsage
    ? { ...(state as any).tokenUsage }
    : undefined;
  if (estimatingTokenUsage) {
    console.log(`📊 [Decompose] Estimating phase tokens captured: ${estimatingTokenUsage.inputTokens + estimatingTokenUsage.outputTokens} (input: ${estimatingTokenUsage.inputTokens}, output: ${estimatingTokenUsage.outputTokens}, cacheRead: ${estimatingTokenUsage.cacheReadTokens || 0}, cacheCreate: ${estimatingTokenUsage.cacheCreationTokens || 0})`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 9: Save checkpoint with actual tasks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const updatedState = {
    ...state,  // ✅ Includes tokenUsage accumulated from decompose LLM call
    taskQueue,
    featureTasks,
    referenceRequests: referenceRequests || state.referenceRequests || [],
    projectCodeContext,
    referenceCodeContexts: [],
    totalSubtasks: tasks.length + 1,
    subtaskIndex: 0,
    completedTasks: state.completedTasks || [],
    completedTasksDetails: state.completedTasksDetails || [],
    jobId: timingJobId,
    jobTiming,
    _estimatingTokenUsage: estimatingTokenUsage,
    _phaseTimings: finalPhaseTimings,
  };
  
  // ✅ Update broadcaster with finalized jobTiming (includes estimatingDuration + phaseBreakdown)
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(jobTiming);
  }

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
