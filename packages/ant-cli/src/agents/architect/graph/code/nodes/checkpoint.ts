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
    queueSize: state.taskQueue?.size() ?? 0
  });
  
  try {
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
    };
    
    // ✅ Include jobId and jobTiming if present
    if ((state as any).jobId) {
      (sessionState as any).jobId = (state as any).jobId;
    }
    if ((state as any).jobTiming) {
      (sessionState as any).jobTiming = (state as any).jobTiming;
    }
    
    // ✅ Include interruption details if present
    if ((state as any).interruption) {
      (sessionState as any).interruption = (state as any).interruption;
    }
    
    // ✅ Only include currentTask if it exists
    if (state.currentTask) {
      sessionState.currentTask = state.currentTask;
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

