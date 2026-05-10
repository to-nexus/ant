import { ArchitectGraphState } from "../state";
import type { SessionState } from "../../../../../core/types/session";

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
 */
export async function saveCheckpoint(state: ArchitectGraphState): Promise<void> {
  if (!state.deps?.session) {
    return; // No session port available
  }
  
  // Workers must NOT write global session checkpoint — orchestrator handles it.
  // Worker state has taskQueue=undefined, so writing here would clobber the
  // session's taskQueue with [] and lose all queued tasks.
  const _wid = state.workerId;
  if (_wid !== undefined && _wid !== null) {
    return;
  }
  
  console.log(`[saveCheckpoint] 💾 Saving checkpoint:`, {
    completedTasksCount: state.completedTasks?.length ?? 0,
    completedTasksDetailsCount: state.completedTasksDetails?.length ?? 0,
    completedTasksDetailsIds: state.completedTasksDetails?.map(t => t.id) ?? [],
    currentTask: state.currentTask?.name,
    queueSize: state.taskQueue?.size() ?? 0,
    referenceRequestsCount: state.referenceRequests?.length ?? 0,
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
    const sessionState: Partial<SessionState> = {
      taskQueue: state.taskQueue?.getAll() || [],
      completedTasks: state.completedTasks || [],
      completedTasksDetails: state.completedTasksDetails || [],
      retries: state.retries || 0,
      maxRetries: state.maxRetries || 3,
      previousAttempts: state.previousAttempts || [],
      enforcementHistory: state.enforcementHistory || [],
      previousFileCount: state.previousFileCount,
      resolvedCategories: state.resolvedCategories || [],
      planText: state.planText,
      conversations: state.conversations || {},
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      directives: directivesArray,
      overrideDirective: state.overrideDirective,
      chatSource: state.chatSource,
      referenceRequests: state.referenceRequests || [],
      profile: state.profile,
      userLanguage: state.context.userLanguage,
      resolvedAction: state.resolvedAction,
      directive: state.directive,
      ...(state.jobId && { jobId: state.jobId }),
      ...(state.jobTiming && { jobTiming: state.jobTiming }),
      ...(state.tokenUsage && { tokenUsage: state.tokenUsage }),
      ...(state._estimatingTokenUsage && { estimatingTokenUsage: state._estimatingTokenUsage }),
      ...(state.interruption && { interruption: state.interruption }),
      // Tier-Verification Alignment: persist the LLM-classified
      // executionTier so post-mortem analysis (debug logs, session
      // inspection) can distinguish direct vs task paths without
      // reverse-engineering from phaseBreakdown / callCount. Also
      // persist directHints — the direct node needs these on resume
      // to rebuild its framing without re-running decompose.
      ...(state.executionTier !== undefined && { executionTier: state.executionTier }),
      ...(state.analysis && { analysis: state.analysis }),
      ...(state.directHints && { directHints: state.directHints }),
    };
    
    // ✅ Only include currentTask if it exists
    if (state.currentTask) {
      // ✅ CRITICAL: Include real-time token usage for in-progress task
      // This allows UI to show token consumption even before task completes
      const currentTaskWithTokens = {
        ...state.currentTask,
        tokenUsage: state._currentTaskTokenUsage || state.currentTask.tokenUsage
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
    
    const hasInterruption = !!state.interruption;
    console.log(`[saveCheckpoint] ✅ Checkpoint saved successfully (interrupted: ${hasInterruption}, recursion: ${state.recursionCount}/${state.recursionLimit})`);
  } catch (error) {
    console.warn(`⚠️  Failed to save checkpoint: ${error}`);
  }
}

