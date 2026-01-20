import { ArchitectGraphState } from "../state";

/**
 * Save checkpoint for resuming after interruption (recursion limit, etc.)
 * 
 * This checkpoint saves:
 * - Task queue state
 * - Completed tasks
 * - Current retries
 * - Previous attempts
 * - Enforcement history
 * 
 * Called from:
 * - plan node (after planning)
 * - execute node (after code generation)
 * - runtimeValidate node (after validation)
 */
export async function saveCheckpoint(state: ArchitectGraphState): Promise<void> {
  if (!state.deps?.session) {
    return; // No session port available
  }
  
  console.log(`[saveCheckpoint] 💾 Saving checkpoint:`, {
    completedTasksCount: state.completedTasks?.length ?? 0,
    completedTasksDetailsCount: state.completedTasksDetails?.length ?? 0,
    completedTasksDetailsIds: state.completedTasksDetails?.map(t => t.id) ?? [],
    currentTask: state.currentTask?.name,
    queueSize: state.taskQueue?.size() ?? 0,
    referenceRequestsCount: state.referenceRequests?.length ?? 0,
    projectCodeContextFilesCount: state.projectCodeContext?.filePaths?.length ?? 0  // ✅ DEBUG: Check if projectCodeContext is present
  });
  
  try {
    // ✅ Build directives array from state.directive (split by separator)
    let directivesArray: string[] = [];
    if (state.directive) {
      // Check if already separated by our marker
      if (state.directive.includes('\n\n---\n\n')) {
        directivesArray = state.directive.split('\n\n---\n\n').filter(d => d.trim());
      } else {
        // Single directive
        directivesArray = [state.directive];
      }
    }
    
    // ✅ Build state object, conditionally include currentTask
    const sessionState: any = {
      taskQueue: state.taskQueue?.getAll() || [],
      completedTasks: state.completedTasks || [],
      completedTasksDetails: state.completedTasksDetails || [], // ✅ NEW: Save full task details
      retries: state.retries || 0,
      maxRetries: state.maxRetries || 3,
      previousAttempts: state.previousAttempts || [],
      enforcementHistory: state.enforcementHistory || [],
      lastViolations: state.lastViolations || [],
      previousFileCount: state.previousFileCount,
      resolvedCategories: state.resolvedCategories || [],
      planText: state.planText,  // ✅ Save plan for reuse on resume
      recursionCount: state.recursionCount,  // ✅ Save current recursion count
      recursionLimit: state.recursionLimit,  // ✅ Save recursion limit
      directives: directivesArray,  // ✅ Save directives array (newest first)
      overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
      chatSource: state.chatSource,  // ✅ Save chat source flag
      referenceRequests: state.referenceRequests || [],  // ✅ Save reference requests for tool calling
      // ✅ Save DetectionReport (unified detection result)
      detectionReport: state.detectionReport,
      // ✅ CRITICAL: Save artifacts for CodeGen validation on resume
      directive: state.directive,  // ✅ Save directive (for CodeGen validation)
      design: state.design,  // ✅ Save design document
      spec: state.spec,  // ✅ Save spec
      prd: state.prd,  // ✅ Save PRD if exists
      // ✅ NOTE: parsedUiDocs is NOT saved (contains Map, heavy)
      // It's reloaded from disk in resolve/codeGen when needed
      // ✅ CRITICAL: Save projectCodeContext (filePaths only, NOT files content)
      // Why: files content is heavy (~500KB) and redundant (already on disk)
      // Solution: Save filePaths (~5KB) only, LLM can read_file when needed
      // ALWAYS save as object (even if empty) to ensure field exists in JSON
      projectCodeContext: state.projectCodeContext ? {
        source: state.projectCodeContext.source,
        filePaths: state.projectCodeContext.filePaths || [],
        files: [],  // ❌ DON'T save content (too heavy!)
        stats: state.projectCodeContext.stats || { filesLoaded: 0, estimatedTokens: 0 }
      } : {
        source: 'plan' as const,
        filePaths: [],
        files: [],
        stats: { filesLoaded: 0, stackTraceCount: 0, semanticCount: 0, deduplicatedCount: 0, estimatedTokens: 0 }
      },
    };
    
    // ✅ Include jobId and jobTiming if present
    if ((state as any).jobId) {
      (sessionState as any).jobId = (state as any).jobId;
    }
    if ((state as any).jobTiming) {
      (sessionState as any).jobTiming = (state as any).jobTiming;
    }
    
    // ✅ CRITICAL: Include job-level token usage
    if ((state as any).tokenUsage) {
      (sessionState as any).tokenUsage = (state as any).tokenUsage;
    }
    
    // ✅ Include interruption details if present
    if ((state as any).interruption) {
      (sessionState as any).interruption = (state as any).interruption;
    }
    
    // ✅ Only include currentTask if it exists
    if (state.currentTask) {
      // ✅ CRITICAL: Include real-time token usage for in-progress task
      // This allows UI to show token consumption even before task completes
      const currentTaskWithTokens = {
        ...state.currentTask,
        tokenUsage: (state as any)._currentTaskTokenUsage || state.currentTask.tokenUsage
      };
      sessionState.currentTask = currentTaskWithTokens;
    }
    
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      'code',  // ✅ Add job parameter
      {
        state: sessionState
      }
    );
    
    const hasInterruption = !!(state as any).interruption;
    console.log(`[saveCheckpoint] ✅ Checkpoint saved successfully (interrupted: ${hasInterruption}, recursion: ${state.recursionCount}/${state.recursionLimit})`);
  } catch (error) {
    console.warn(`⚠️  Failed to save checkpoint: ${error}`);
  }
}

