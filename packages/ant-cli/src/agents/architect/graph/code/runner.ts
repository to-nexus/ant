import { ArchitectGraphState } from "./state";
import { TaskQueue, CodeTask } from "../../types/task";
import { buildCodeGraph } from "./graph";

/**
 * Code Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 * 
 * ✅ RecursionLimit: Read from RECURSION_LIMIT env var (minimum: 5)
 * ✅ Learn node is ALWAYS executed on exit (success/error/recursion limit)
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  let state: ArchitectGraphState = initial;
  let isRecursionLimit = false;
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? MIN_RECURSION_LIMIT 
    : recursionLimit;
  
  console.log(`🔍 [CodeRunner] RECURSION_LIMIT debug:`);
  console.log(`   Raw env: "${process.env.RECURSION_LIMIT}"`);
  console.log(`   Parsed: ${recursionLimit}`);
  console.log(`   isNaN: ${isNaN(recursionLimit)}`);
  console.log(`   Final limit: ${finalLimit}`);
  
  if (isNaN(recursionLimit) || !process.env.RECURSION_LIMIT) {
    console.warn(`⚠️  RECURSION_LIMIT not set, using minimum: ${MIN_RECURSION_LIMIT}`);
  } else if (recursionLimit < MIN_RECURSION_LIMIT) {
    console.warn(`⚠️  RECURSION_LIMIT (${recursionLimit}) below minimum (${MIN_RECURSION_LIMIT}), using minimum`);
  } else {
    console.log(`⚙️  Recursion limit: ${recursionLimit}\n`);
  }
  
  // ✅ CRITICAL: Check for resumable session BEFORE invoke
  // If session has taskQueue with interruption, restore it to initial state
  if (initial.deps?.session && initial.context.featureFolder) {
    try {
      const session = await initial.deps.session.load(
        initial.context.project,
        initial.context.featureFolder,
        'code'
      );
      
      const hasInterruption = Boolean(session?.state?.interruption);
      const hasTaskQueue = Boolean(session?.state?.taskQueue && session.state.taskQueue.length > 0);
      
      if (hasInterruption && hasTaskQueue && session.state) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔄 RESUMING FROM CHECKPOINT');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`   Interruption reason: ${session.state.interruption?.reason || 'unknown'}`);
        console.log(`   Tasks in queue: ${session.state.taskQueue?.length || 0}`);
        console.log(`   Completed tasks: ${session.state.completedTasks?.length || 0}\n`);
        
        // Reconstruct TaskQueue from saved array
        const { TaskQueue } = await import('./state');
        const taskQueue = new TaskQueue<CodeTask>();
        session.state.taskQueue?.forEach((task: any) => taskQueue.push(task));
        
        // ✅ Restore ALL state from checkpoint
        initial.taskQueue = taskQueue;
        initial.currentTask = undefined;  // Already moved to queue in save
        initial.completedTasks = session.state.completedTasks || [];
        initial.completedTasksDetails = session.state.completedTasksDetails || [];
        initial.retries = session.state.retries || 0;
        initial.maxRetries = session.state.maxRetries || 3;
        initial.previousAttempts = session.state.previousAttempts || [];
        initial.enforcementHistory = session.state.enforcementHistory || [];
        initial.lastViolations = session.state.lastViolations || [];
        initial.previousFileCount = session.state.previousFileCount;
        initial.resolvedCategories = (session.state.resolvedCategories || []) as any;
        initial.recursionCount = session.state.recursionCount || 0;
        initial.recursionLimit = session.state.recursionLimit || finalLimit;
        
        // ✅ CRITICAL: Restore directive/design/spec from session
        // CodeGen validation requires either directive or design
        if (session.state.overrideDirective) {
          initial.directive = session.state.overrideDirective;
          console.log(`   ✅ Directive restored from overrideDirective`);
        } else if (session.state.directives && session.state.directives.length > 0) {
          initial.directive = session.state.directives[0];  // First directive (newest)
          console.log(`   ✅ Directive restored from session`);
        }
        
        if ((session.state as any).design) {
          initial.design = (session.state as any).design;
          console.log(`   ✅ Design restored from session`);
        } else if (session.artifacts?.design) {
          // Try loading from artifacts (if session saved it there)
          initial.design = session.artifacts.design;
          console.log(`   ✅ Design restored from artifacts`);
        }
        
        if ((session.state as any).spec) {
          initial.spec = (session.state as any).spec;
          console.log(`   ✅ Spec restored from session`);
        }
        
        if ((session.state as any).prd) {
          initial.prd = (session.state as any).prd;
          console.log(`   ✅ PRD restored from session`);
        }
        
        if ((session.state as any).jobId) {
          (initial as any).jobId = (session.state as any).jobId;
        }
        if ((session.state as any).jobTiming) {
          (initial as any).jobTiming = (session.state as any).jobTiming;
        }
        
        
        // ✅ CRITICAL: Restore projectCodeContext.files from filePaths
        // Why: We only save filePaths to checkpoint (lightweight), but need files for LLM prompt
        if ((session.state as any).projectCodeContext && 
            (session.state as any).projectCodeContext.filePaths?.length > 0 &&
            (!(session.state as any).projectCodeContext.files || 
             (session.state as any).projectCodeContext.files.length === 0)) {
          
          console.log('🔄 Restoring projectCodeContext.files from disk...');
          const filePaths = (session.state as any).projectCodeContext.filePaths;
          const files = [];
          
          for (const path of filePaths) {
            try {
              const content = await initial.deps!.git!.readFile(path);
              files.push({ path, content });
            } catch (err) {
              console.warn(`   ⚠️  Could not read ${path}: ${(err as Error).message}`);
            }
          }
          
          initial.projectCodeContext = {
            ...(session.state as any).projectCodeContext,
            files
          };
          
          console.log(`   ✅ Restored ${files.length}/${filePaths.length} files from disk`);
        } else if ((session.state as any).projectCodeContext) {
          // projectCodeContext exists but no filePaths (or files already present)
          initial.projectCodeContext = (session.state as any).projectCodeContext;
          console.log(`   ✅ projectCodeContext restored (${((session.state as any).projectCodeContext.files || []).length} files)`);
        }
        
        console.log('✅ State restored from checkpoint - ready to resume\n');
      }
    } catch (err) {
      console.warn('⚠️  Failed to check for resumable session:', err);
    }
  }
  
  // ✅ Initialize recursion tracking in state (if not restored)
  initial.recursionLimit = initial.recursionLimit || finalLimit;
  initial.recursionCount = initial.recursionCount || 0;
  
  try {
    state = await (app as any).invoke(initial as any, {
      recursionLimit: finalLimit  // ✅ LangGraph RunnableConfig uses camelCase (NOT snake_case!)
    }) as ArchitectGraphState;
  } catch (error: any) {
    // ✅ CRITICAL: Recursion limit or other errors
    if (error.message.includes('Recursion limit')) {
      const actualCount = error.state?.recursionCount || state.recursionCount || 0;
      console.log(`\n⚠️  Execution interrupted: Graph recursion limit reached`);
      console.log(`   📊 Node executions: ${actualCount}/${finalLimit}`);
      console.log(`   ℹ️  This counts every node executed (resolve, plan, execute, validate, etc.)\n`);
    } else {
      console.log(`\n⚠️  Execution interrupted: ${error.message}\n`);
    }
    
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
          initial.context.featureFolder || 'default',
          'code'  // ✅ Add job parameter
        );
        
        if (session.state && session.state.taskQueue) {
          console.log(`   ✅ Restored ${session.state.taskQueue.length} tasks from checkpoint`);
          // Reconstruct TaskQueue from saved array
          const { TaskQueue } = await import('./state');
          const taskQueue = new TaskQueue<CodeTask>();
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
            ...(session.state as any).jobId && { jobId: (session.state as any).jobId },  // ✅ CRITICAL: Restore jobId
            ...(session.state as any).jobTiming && { jobTiming: (session.state as any).jobTiming },  // ✅ CRITICAL: Restore jobTiming
          } as any;
        }
      } catch (restoreError) {
        console.warn('⚠️  Failed to restore from checkpoint:', restoreError);
      }
    }
    
    // Re-throw if not recursion limit
    if (!error.message.includes('Recursion limit')) {
      throw error;
    }
    
    // ✅ CRITICAL: Check if all tasks are actually completed
    // If taskQueue is empty and no currentTask, then we're done (not an error!)
    const hasRemainingWork = (state.taskQueue && !state.taskQueue.isEmpty()) || state.currentTask;
    
    if (!hasRemainingWork) {
      console.log('✅ Recursion limit reached but all tasks completed - treating as success\n');
      // Continue to learn node execution below (don't set isRecursionLimit)
      // LangGraph will have already executed learn node, so state should be final
      return {
        ...state,
        design: state.design || ''
      };
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
      const newQueue = new TaskQueue<CodeTask>();
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
      message: `Task paused: Graph recursion limit reached (${finalLimit} total node executions, ${state.recursionCount || 0} plan iterations)`,
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        recursionCount: state.recursionCount || 0,
        recursionLimit: finalLimit,
        tasksRemaining: remainingTasks,
        nodeExecutionCount: finalLimit  // Total graph node executions
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
    
    // ✅ CRITICAL: Set interruption in state before learn node
    (state as any).interruption = interruption;
    
    // ✅ Try to run learn node for cleanup (optional, can fail safely)
    try {
      console.log('🧠 Running learn node for cleanup and lesson extraction...\n');
      const { learn } = await import('./nodes/index');
      state = await learn(state);
      
      // ✅ CRITICAL: Ensure interruption is preserved after learn node
      if (!(state as any).interruption) {
        (state as any).interruption = interruption;
      }
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
