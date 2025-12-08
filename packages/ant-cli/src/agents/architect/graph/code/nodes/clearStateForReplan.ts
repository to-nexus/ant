import { ArchitectGraphState } from "../state";
import { TaskQueue, CodeTask } from "../../../types/task";

/**
 * Clear State For Replan Node
 * 
 * Responsibilities:
 * 1. Reset task queue and related state
 * 2. Merge directives into single directive for re-decomposition
 * 3. Mark as replanning
 * 
 * After this node, flow goes back to decompose for fresh task breakdown.
 */
export async function clearStateForReplan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'clearStateForReplan',
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n🔄 [ClearStateForReplan] Restarting with new plan...');
  
  const directives = state.directives || [];
  const completedCount = state.completedTasks?.length || 0;
  
  console.log(`   Previous progress: ${completedCount} task(s) completed`);
  console.log(`   Merging ${directives.length} directive(s) for re-decomposition\n`);
  
  // Merge directives: newest feedback gets more weight
  // Format: [Initial] + [Feedback 1] + ... (clear context for LLM)
  let mergedDirective = state.directive;
  
  if (directives.length > 1) {
    const [initial, ...feedbacks] = directives.slice().reverse(); // oldest first
    
    const parts = [`[Initial Request]\n${initial}`];
    
    feedbacks.forEach((feedback, idx) => {
      parts.push(`[Updated Request ${idx + 1}]\n${feedback}`);
    });
    
    // Most recent feedback is last = most visible
    mergedDirective = parts.join('\n\n---\n\n');
    
    console.log(`   ✅ Directive structure:`);
    console.log(`      - Initial: "${initial.substring(0, 50)}..."`);
    feedbacks.forEach((f, idx) => {
      console.log(`      - Update ${idx + 1}: "${f.substring(0, 50)}..."`);
    });
    console.log('');
  }
  
  // Clear state for fresh decomposition
  const cleanState: ArchitectGraphState = {
    ...state,
    
    // Task system reset
    taskQueue: new TaskQueue<CodeTask>(),
    featureTasks: new Map(),
    currentTask: undefined,
    completedTasks: [],
    completedTasksDetails: [],
    
    // Retry/attempt reset
    retries: 0,
    previousAttempts: [],
    enforcementHistory: [],
    lastViolations: [],
    violations: undefined,
    enforcementReason: undefined,
    
    // Plan reset
    planText: '',
    
    // Directive (merged)
    directive: mergedDirective,
    
    // Replan flags
    isReplanning: true,
    replanAction: undefined,  // Clear decision (will be set again if needed)
    replanReason: undefined,
    tasksToModify: undefined,
    
    // Files tracking (keep existing files for context)
    // Don't reset: code, codeHead, files, profile
    // LLM will see what was already done
    
    // Runtime validation
    runtimeValidationResult: undefined,
    
    // Preserve: context, deps, spec, design, prd, profile
  };
  
  console.log(`📋 [ClearStateForReplan] State cleared, ready for decompose`);
  console.log(`   Next: decompose will create new task breakdown\n`);
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'clearStateForReplan');
  }
  
  return cleanState;
}

