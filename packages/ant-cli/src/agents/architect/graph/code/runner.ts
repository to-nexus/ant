import { ArchitectGraphState } from "./state";
import { buildCodeGraph } from "./graph";

/**
 * Code Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 * 
 * ✅ RecursionLimit: Configurable via RECURSION_LIMIT env var (default: 50)
 * ✅ Learn node is ALWAYS executed on exit (success/error/recursion limit)
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  let state: ArchitectGraphState = initial;
  let isRecursionLimit = false;
  
  // ✅ Configurable recursion limit via environment variable (minimum: 5)
  const MINIMUM_RECURSION_LIMIT = 5;
  const DEFAULT_RECURSION_LIMIT = 50;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || String(DEFAULT_RECURSION_LIMIT), 10);
  
  // Validate and log
  let finalLimit: number;
  if (isNaN(recursionLimit) || recursionLimit < 1) {
    console.warn(`⚠️  Invalid RECURSION_LIMIT: ${process.env.RECURSION_LIMIT}, using default: ${DEFAULT_RECURSION_LIMIT}`);
    finalLimit = DEFAULT_RECURSION_LIMIT;
  } else if (recursionLimit < MINIMUM_RECURSION_LIMIT) {
    console.warn(`⚠️  RECURSION_LIMIT (${recursionLimit}) is below minimum (${MINIMUM_RECURSION_LIMIT}), using minimum`);
    finalLimit = MINIMUM_RECURSION_LIMIT;
  } else {
    console.log(`⚙️  Recursion limit: ${recursionLimit} (from RECURSION_LIMIT env var)\n`);
    finalLimit = recursionLimit;
  }
  
  // ✅ Initialize recursion tracking in state
  initial.recursionLimit = finalLimit;
  initial.recursionCount = 0;
  
  try {
    state = await (app as any).invoke(initial as any, {
      recursionLimit: finalLimit,
    }) as ArchitectGraphState;
  } catch (error: any) {
    // ✅ CRITICAL: Recursion limit or other errors
    console.log(`\n⚠️  Execution interrupted: ${error.message}\n`);
    
    // ✅ Try to restore state from last checkpoint
    if (error.state) {
      state = error.state;
    } else if (initial.deps?.session && error.message.includes('Recursion limit')) {
      // LangGraph recursion limit doesn't provide state in error
      // So we restore from the last saved checkpoint
      console.log('📥 Restoring state from last checkpoint...');
      try {
        const session = await initial.deps.session.load(
          initial.context.project,
          initial.context.featureFolder || 'default'
        );
        
        if (session.state && session.state.taskQueue) {
          console.log(`   ✅ Restored ${session.state.taskQueue.length} tasks from checkpoint`);
          // Reconstruct TaskQueue from saved array
          const { TaskQueue } = await import('./state');
          const taskQueue = new TaskQueue();
          session.state.taskQueue.forEach((task: any) => taskQueue.push(task));
          
          state = {
            ...initial,
            taskQueue,
            currentTask: session.state.currentTask,  // ✅ CRITICAL: Restore currentTask (will be moved to queue below)
            completedTasks: session.state.completedTasks || [],
            completedTasksDetails: session.state.completedTasksDetails || [], // ✅ NEW: Restore full task details
            retries: session.state.retries || 0,
            maxRetries: session.state.maxRetries || 3,
            previousAttempts: session.state.previousAttempts || [],
            enforcementHistory: session.state.enforcementHistory || [],
            lastViolations: session.state.lastViolations || [],
            previousFileCount: session.state.previousFileCount,
            resolvedCategories: (session.state.resolvedCategories || []) as any,
            recursionCount: session.state.recursionCount || 0,  // ✅ CRITICAL: Restore recursion count
            recursionLimit: session.state.recursionLimit || finalLimit,  // ✅ CRITICAL: Restore recursion limit
          };
        }
      } catch (restoreError) {
        console.warn('⚠️  Failed to restore from checkpoint:', restoreError);
      }
    }
    
    // Re-throw if not recursion limit
    if (!error.message.includes('Recursion limit')) {
      throw error;
    }
    
    isRecursionLimit = true;
    
    // ✅ Calculate remaining tasks (including currentTask if exists)
    const queueSize = state.taskQueue?.size() || 0;
    const currentTaskCount = state.currentTask ? 1 : 0;
    const remainingTasks = queueSize + currentTaskCount;
    
    // ✅ CRITICAL: Move currentTask back to queue FIRST (before learn node)
    // This ensures state is correct even if learn node fails
    if (state.currentTask && state.taskQueue) {
      console.log(`📥 Moving current task "${state.currentTask.name}" back to front of queue`);
      // Create a new task queue with currentTask at the front
      const { TaskQueue } = await import('./state');
      const newQueue = new TaskQueue();
      newQueue.push(state.currentTask);
      // ✅ Filter out duplicate task IDs to prevent duplicates
      state.taskQueue.getAll().forEach((task: any) => {
        if (task.id !== state.currentTask!.id) {
          newQueue.push(task);
        }
      });
      state.taskQueue = newQueue;
      state.currentTask = undefined; // Clear current task
      console.log(`  ✅ Queue now has ${newQueue.size()} tasks`);
    }
    
    // ✅ Create interruption details for recursion limit (before checkpoint)
    const interruption = {
      reason: 'recursion_limit' as const,
      message: `Task paused: Reached recursion limit (${finalLimit} iterations)`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        recursionCount: state.recursionCount || 0,
        recursionLimit: finalLimit,
        tasksRemaining: remainingTasks
      }
    };
    
    // ✅ CRITICAL: Save pause state BEFORE learn node (learn node can fail)
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('./nodes/checkpoint');
        // ✅ Explicitly set currentTask to undefined (it's been moved to queue)
        state.currentTask = undefined;
        
        const pausedState = {
          ...state,
          interruption
        };
        await saveCheckpoint(pausedState);
        console.log(`💾 Pause state saved to session (recursion limit)`);
      } catch (saveError) {
        console.warn(`⚠️  Failed to save pause state:`, saveError);
      }
    }
    
    // ✅ CRITICAL: Preserve interruption before learn node (learn may overwrite state)
    const savedInterruption = interruption;
    
    // ✅ Try to run learn node for cleanup (optional, can fail safely)
    try {
      console.log('🧠 Running learn node for cleanup and learning...\n');
      const { learn } = await import('./nodes/index');
      state = await learn(state);
      
      // ✅ CRITICAL: Restore interruption after learn node
      (state as any).interruption = savedInterruption;
    } catch (learnError) {
      console.warn('⚠️  Learn node failed (non-critical):', learnError);
    }
    
    console.log(`\n⏸️  Session paused due to recursion limit`);
    console.log(`📊 Progress saved:`);
    console.log(`   ✅ ${state.completedTasks?.length || 0} tasks completed`);
    console.log(`   ⏳ ${remainingTasks} tasks remaining`);
    if (state.currentTask) {
      console.log(`      └─ 1 in progress: "${state.currentTask.name}"`);
    }
    if (queueSize > 0) {
      console.log(`      └─ ${queueSize} in queue`);
    }
    console.log(`\n💡 Run the same command again to resume from checkpoint\n`);
  }

  // Return results (all saving was done in learn node)
  const filesGenerated = state.filesWritten || 0;
  
  // ✅ Calculate remaining tasks (including currentTask if exists)
  const queueSize = state.taskQueue?.size() || 0;
  const currentTaskCount = state.currentTask ? 1 : 0;
  const tasksRemaining = queueSize + currentTaskCount;
  
  let reportMessage = `Generated ${filesGenerated} files on branch ${state.branch || 'none'}`;
  if (isRecursionLimit && tasksRemaining > 0) {
    reportMessage += ` (paused: ${tasksRemaining} tasks remaining due to recursion limit)`;
  }
  
  return { 
    branch: state.branch!, 
    reportFile: reportMessage,
    filesChanged: filesGenerated,
    interruption: isRecursionLimit ? state.interruption : undefined
  };
}
