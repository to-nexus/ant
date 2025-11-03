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
  
  try {
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      {
        state: {
          taskQueue: state.taskQueue?.getAll() || [],
          currentTask: state.currentTask,
          completedTasks: state.completedTasks || [],
          retries: state.retries || 0,
          maxRetries: state.maxRetries || 3,
          previousAttempts: state.previousAttempts || [],
          enforcementHistory: state.enforcementHistory || [],
          lastViolations: state.lastViolations || [],
          previousFileCount: state.previousFileCount,
          resolvedCategories: state.resolvedCategories || [],
          planText: state.planText,  // ✅ Save plan for reuse on resume
        }
      }
    );
    
    // Don't log on every checkpoint (too noisy)
    // console.log(`💾 Checkpoint saved`);
  } catch (error) {
    console.warn(`⚠️  Failed to save checkpoint: ${error}`);
  }
}

