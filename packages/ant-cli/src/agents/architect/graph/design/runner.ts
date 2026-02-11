import { buildDesignGraph } from "./graph";
import { DesignGraphState } from "./state";
import { DesignTask } from "../../types/task";
import { getChatAPIClient } from "../../../../core/adapters/ChatAPIClient";

/**
 * Design Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 * 
 * ✅ Resume Architecture (aligned with Code Runner):
 * - Loads session state BEFORE graph invoke
 * - Sets isResume flag for graph router (4-way routing after resolve)
 * - Restores: taskQueue, completedTasks, planText, conversationHistory, etc.
 */
export async function runDesignGraph(initial: DesignGraphState) {
  const app = buildDesignGraph();
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? MIN_RECURSION_LIMIT 
    : recursionLimit;
  
  console.log(`🔍 [DesignRunner] Recursion limit: ${finalLimit}`);
  
  // ✅ CRITICAL: Check for resumable session BEFORE invoke
  // If session has taskQueue with interruption, restore it to initial state
  if (initial.deps?.session && initial.context.featureFolder) {
    try {
      const session = await initial.deps.session.load(
        initial.context.project,
        initial.context.featureFolder,
        'design'
      );
      
      const hasInterruption = Boolean(session?.state?.interruption);
      const hasTaskQueue = Boolean(session?.state?.taskQueue && session.state.taskQueue.length > 0);
      
      if (hasInterruption && hasTaskQueue && session.state) {
        console.log(`🔄 [DesignRunner] Resuming: ${session.state.taskQueue?.length || 0} tasks in queue, ${session.state.completedTasks?.length || 0} completed`);
        
        // ✅ Set isResume flag for graph router
        initial.isResume = true;
        
        // Reconstruct TaskQueue from saved array
        const { TaskQueue } = await import('../code/state');
        const taskQueue = new TaskQueue<DesignTask>();
        session.state.taskQueue?.forEach((task: any) => taskQueue.push(task));
        
        // ✅ Restore ALL state from checkpoint
        initial.taskQueue = taskQueue;
        initial.currentTask = undefined;  // Already moved to queue in save
        initial.completedTasks = session.state.completedTasks || [];
        initial.completedTasksDetails = session.state.completedTasksDetails || [];
        initial.tokenUsage = session.state.tokenUsage;
        initial._estimatingTokenUsage = (session.state as any).estimatingTokenUsage;  // ✅ Restore estimating phase snapshot
        
        // ✅ Restore detectionReport (required for workType routing in docGen)
        if ((session.state as any).detectionReport) {
          initial.detectionReport = (session.state as any).detectionReport;
        }
        
        // ✅ Restore planText for task-level resume (skip plan regeneration if applicable)
        if (session.state.planText) {
          initial.planText = session.state.planText;
        }
        
        // ✅ Restore conversationHistory for mid-task resume (docGen continues from interruption)
        if (session.state.conversationHistory && session.state.conversationHistory.length > 0) {
          initial.conversationHistory = session.state.conversationHistory;
        }
        
        // ✅ Restore generated files (design docs written to disk between tasks)
        if ((session.state as any).files) {
          initial.files = (session.state as any).files;
        }
        if ((session.state as any).filesToDelete) {
          initial.filesToDelete = (session.state as any).filesToDelete;
        }
        
        // ✅ Restore directive/overrideDirective from session
        if (session.state.overrideDirective) {
          initial.directive = session.state.overrideDirective;
        } else if (session.state.directives && session.state.directives.length > 0) {
          initial.directive = session.state.directives[0];
        }
        initial.overrideDirective = session.state.overrideDirective;
        initial.chatSource = session.state.chatSource;
        
        // ✅ Restore design artifacts for downstream prompts
        if ((session.state as any).design) {
          initial.design = (session.state as any).design;
        }
        if ((session.state as any).prd) {
          initial.prd = (session.state as any).prd;
        }
        
        // ✅ Restore jobId and jobTiming
        if ((session.state as any).jobId) {
          initial.jobId = (session.state as any).jobId;
        }
        if ((session.state as any).jobTiming) {
          initial.jobTiming = (session.state as any).jobTiming;
        }
        
      } else if (session?.state && process.env.ANT_IS_RESUME === 'true') {
        // ✅ FIX: Restore directive from early-interrupted session (triage/detectEnv stage)
        // GUARD: Only when API explicitly says this is a resume (ANT_IS_RESUME)
        // Without this guard, a new job could inherit stale directive from a previous session
        const savedDirective = (session.state as any).directive || session.state.overrideDirective;
        if (savedDirective && !initial.directive) {
          console.log(`🔄 [DesignRunner] Restoring directive from early-interrupted session`);
          initial.directive = savedDirective;
        }
        // Restore detectionReport (enables decompose-direct routing after detectEnv interruption)
        if ((session.state as any).detectionReport && !initial.detectionReport) {
          console.log(`🔄 [DesignRunner] Restoring detectionReport from session`);
          initial.detectionReport = (session.state as any).detectionReport;
        }
      }
    } catch (err) {
      console.warn('⚠️  [DesignRunner] Failed to check for resumable session:', err);
    }
  }
  
  // ✅ Also set isResume from env var (for cloud mode where session restoration may be partial)
  if (!initial.isResume && process.env.ANT_IS_RESUME === 'true') {
    initial.isResume = true;
  }
  
  // ✅ Initialize recursion tracking in state (for UI gauge display)
  initial.recursionCount = initial.recursionCount || 0;
  initial.recursionLimit = initial.recursionLimit || finalLimit;
  
  // ✅ Set jobTiming on broadcaster for resume (so SSE broadcasts include timing from first event)
  if ((initial as any).jobTiming && initial.deps?.kanbanUpdate?.setJobTiming) {
    initial.deps.kanbanUpdate.setJobTiming((initial as any).jobTiming);
  }
  
  // ✅ FIX: Save directive to session EARLY (before graph invoke)
  // Ensures directive survives early interruptions (triage/detectEnvironment stage)
  if (initial.deps?.session && initial.context.featureFolder && initial.directive) {
    try {
      const session = await initial.deps.session.load(
        initial.context.project,
        initial.context.featureFolder,
        'design'
      );
      if (!(session.state as any)?.directive) {
        await initial.deps.session.updateArtifacts(
          initial.context.project,
          initial.context.featureFolder,
          'design',
          {
            state: {
              ...session.state,
              directive: initial.directive,
              overrideDirective: initial.overrideDirective,
            }
          }
        );
        console.log(`💾 [DesignRunner] Saved directive to session (early checkpoint)`);
      }
    } catch (err) {
      // Non-critical
    }
  }
  
  try {
    const state = await (app as any).invoke(initial as any, {
      recursionLimit: finalLimit  // ✅ LangGraph RunnableConfig uses camelCase (NOT snake_case!)
    }) as DesignGraphState;
    
    // ✅ Return minimal results (all files were saved in writeFiles node)
    // No need to return paths - they are deterministic from context
    return state;
  } catch (error: any) {
    // ✅ Handle recursion limit (same pattern as code runner)
    if (error.message?.includes('Recursion limit')) {
      console.log(`⚠️ [DesignRunner] Recursion limit reached (${finalLimit} nodes)`);
      
      let state: DesignGraphState = error.state || initial;
      
      // Try to restore from last checkpoint
      if (!error.state && initial.deps?.session) {
        try {
          const session = await initial.deps.session.load(
            initial.context.project,
            initial.context.featureFolder || 'default',
            'design'
          );
          
          if (session.state?.taskQueue) {
            const { TaskQueue } = await import('../code/state');
            const taskQueue = new TaskQueue<DesignTask>();
            session.state.taskQueue.forEach((task: any) => taskQueue.push(task));
            
            state = {
              ...initial,
              taskQueue,
              currentTask: session.state.currentTask,
              completedTasks: session.state.completedTasks || [],
              completedTasksDetails: session.state.completedTasksDetails || [],
            } as any;
          }
        } catch (restoreError) {
          console.warn('⚠️  [DesignRunner] Failed to restore from checkpoint:', restoreError);
        }
      }
      
      // Check if all tasks actually completed
      const hasRemainingWork = (state.taskQueue && !state.taskQueue.isEmpty()) || state.currentTask;
      if (!hasRemainingWork) {
        console.log('✅ [DesignRunner] Recursion limit reached but all tasks completed\n');
        return state;
      }
      
      // Move currentTask back to queue with interrupted flag
      if (state.currentTask && state.taskQueue) {
        const { TaskTimingHelper } = await import('../code/state');
        const pausedTask = TaskTimingHelper.pauseTask(state.currentTask);
        pausedTask.interrupted = true;
        
        const { TaskQueue } = await import('../code/state');
        const newQueue = new TaskQueue<DesignTask>();
        newQueue.push(pausedTask);
        state.taskQueue.getAll().forEach((task: any) => {
          if (task.id !== state.currentTask!.id) {
            newQueue.push(task);
          }
        });
        state.taskQueue = newQueue;
        state.currentTask = undefined;
      }
      
      // Save interruption checkpoint
      const interruption = {
        reason: 'recursion_limit' as const,
        message: `Design task paused: Graph recursion limit reached (${finalLimit} node executions)`,
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: {
          recursionLimit: finalLimit,
          tasksRemaining: (state.taskQueue?.size() || 0)
        }
      };
      
      if (state.deps?.session && state.context.featureFolder) {
        try {
          await state.deps.session.updateArtifacts(
            state.context.project,
            state.context.featureFolder,
            'design',
            {
              state: {
                taskQueue: state.taskQueue?.getAll() || [],
                currentTask: undefined,
                completedTasks: state.completedTasks || [],
                completedTasksDetails: state.completedTasksDetails || [],
                interruption,
                jobId: state.jobId,
                jobTiming: state.jobTiming,
                tokenUsage: state.tokenUsage,
                overrideDirective: state.overrideDirective,
                chatSource: state.chatSource,
                files: state.files || [],
                filesToDelete: state.filesToDelete || [],
                detectionReport: state.detectionReport,
                planText: state.planText,
                conversationHistory: state.conversationHistory || [],
              }
            }
          );
          console.log(`💾 [DesignRunner] Interruption checkpoint saved\n`);
        } catch (saveError) {
          console.warn('⚠️  [DesignRunner] Failed to save interruption checkpoint:', saveError);
        }
      }
      
      // Set interruption in state
      (state as any).interruption = interruption;
      
      // Try to run learn node for cleanup
      try {
        const { learn } = await import('./nodes/learn');
        state = await learn(state);
        if (!(state as any).interruption) {
          (state as any).interruption = interruption;
        }
      } catch (learnError) {
        // Learn node failed (non-critical)
      }
      
      console.log(`⏸️ [DesignRunner] Paused: ${state.completedTasks?.length || 0} completed, ${state.taskQueue?.size() || 0} remaining`);
      return state;
    }
    
    // Non-recursion-limit error
    console.error(`❌ [DesignRunner] Graph execution failed:`, error);
    
    // ✅ CRITICAL: Cleanup any active chat message before re-throwing
    try {
      const chatAPI = getChatAPIClient();
      if (chatAPI.hasActiveMessage()) {
        console.log('🧹 [DesignRunner] Cleaning up active message after error...');
        await chatAPI.finalizeMessage(true); // cancelled = true
      }
    } catch (cleanupError) {
      console.warn('⚠️ [DesignRunner] Failed to cleanup message:', cleanupError);
    }
    
    throw error;
  }
}
