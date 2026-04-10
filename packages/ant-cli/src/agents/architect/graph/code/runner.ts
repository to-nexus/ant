import { ArchitectGraphState } from "./state";
import { TaskQueue, CodeTask } from "../../types/task";
import { buildCodeGraph } from "./graph";
import { getChatAPIClient } from "../../../../core/adapters/ChatAPIClient";
import { resetKeywordDedup } from "./nodes/plan/keywordGeneration";

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
  resetKeywordDedup();

  const app = buildCodeGraph();
  let state: ArchitectGraphState = initial;
  let isRecursionLimit = false;
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? 200 
    : recursionLimit;
  
  // Recursion limit configured
  
  // ✅ CRITICAL: Check for resumable session BEFORE invoke
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
        console.log(`🔄 Resuming: ${session.state.taskQueue?.length || 0} tasks in queue, ${session.state.completedTasks?.length || 0} completed`);
        
        // ✅ CRITICAL: Set isResume flag for graph router
        initial.isResume = true;
        
        // Reconstruct TaskQueue from saved array
        initial.taskQueue = TaskQueue.from<CodeTask>(session.state.taskQueue);
        initial.currentTask = undefined;  // Already moved to queue in save
        initial.completedTasks = session.state.completedTasks || [];
        initial.completedTasksDetails = session.state.completedTasksDetails || [];
        initial.retries = 0;  // Resume = user's fresh attempt, reset counter
        initial.maxRetries = session.state.maxRetries || 3;
        initial.previousAttempts = session.state.previousAttempts || [];
        initial.enforcementHistory = session.state.enforcementHistory || [];
        initial.lastViolations = session.state.lastViolations || [];
        initial.previousFileCount = session.state.previousFileCount;
        initial.resolvedCategories = (session.state.resolvedCategories || []) as any;
        initial.recursionCount = 0;  // Reset per invoke (must match LangGraph's per-invoke recursionLimit)
        // ✅ Use the HIGHER of session limit vs current env limit
        // Prevents stale low limits from old sessions overriding a raised RECURSION_LIMIT
        initial.recursionLimit = Math.max(session.state.recursionLimit || 0, finalLimit);
        initial.tokenUsage = session.state.tokenUsage;  // ✅ CRITICAL: Restore job-level token usage
        initial._estimatingTokenUsage = session.state.estimatingTokenUsage;
        
        if (session.state.detectionReport) {
          initial.detectionReport = session.state.detectionReport;
        }
        
        if (session.state.referenceRequests) {
          initial.referenceRequests = session.state.referenceRequests;
        }
        
        if (session.state.designDocUnknownPackages) {
          initial.designDocUnknownPackages = session.state.designDocUnknownPackages;
        }
        
        const restoredProfile = session.state.profile
          ?? session.state.detectionReport?.profile;
        if (restoredProfile) {
          initial.profile = restoredProfile;
        }
        
        if (session.state.projectCodeContext) {
          initial.projectCodeContext = {
            ...session.state.projectCodeContext,
            stats: {
              filesLoaded: session.state.projectCodeContext.stats?.filesLoaded ?? 0,
              estimatedTokens: session.state.projectCodeContext.stats?.estimatedTokens ?? 0,
            },
          };
        }
        
        // ✅ Restore planText for task-level resume (skip plan regeneration)
        if (session.state.planText) {
          initial.planText = session.state.planText;
        }
        
        // ✅ Restore conversationHistory for mid-task resume (execute continues from interruption point)
        if (session.state.conversationHistory && session.state.conversationHistory.length > 0) {
          initial.conversationHistory = session.state.conversationHistory;
        }
        
        // CRITICAL: workspaceConfig is already set in initial state (from orchestrator)
        
        // Restore directive/design/prd from session
        if (session.state.overrideDirective) {
          initial.directive = session.state.overrideDirective;
        } else if (session.state.directives && session.state.directives.length > 0) {
          initial.directive = session.state.directives[0];
        }
        
        if (session.state.design) {
          initial.design = session.state.design;
        } else if (session.artifacts?.design) {
          initial.design = session.artifacts.design;
        }
        
        if (session.state.prd) {
          initial.prd = session.state.prd;
        }
        
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
        
        if (session.state.jobId) {
          initial.jobId = session.state.jobId;
        }
        if (session.state.jobTiming) {
          initial.jobTiming = session.state.jobTiming;
        }
      } else if (session?.state && process.env.ANT_IS_RESUME === 'true') {
        // Restore partial state from early-interrupted session (triage/detectEnv stage)
        // GUARD: Only when API explicitly says this is a resume (ANT_IS_RESUME)
        const savedDirective = session.state.directive || session.state.overrideDirective;
        if (savedDirective && !initial.directive) {
          console.log(`🔄 [CodeRunner] Restoring directive from early-interrupted session`);
          initial.directive = savedDirective;
        }
        if (session.state.detectionReport && !initial.detectionReport) {
          console.log(`🔄 [CodeRunner] Restoring detectionReport from session`);
          initial.detectionReport = session.state.detectionReport;
        }
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
      }
    } catch (err) {
      console.warn('⚠️  Failed to check for resumable session:', err);
    }
  }
  
  // ✅ Initialize recursion tracking in state (if not restored)
  initial.recursionLimit = initial.recursionLimit || finalLimit;
  initial.recursionCount = initial.recursionCount || 0;
  
  // ✅ Set jobTiming on broadcaster for resume (so SSE broadcasts include timing from first event)
  if (initial.jobTiming && initial.deps?.kanbanUpdate?.setJobTiming) {
    initial.deps.kanbanUpdate.setJobTiming(initial.jobTiming);
  }
  
  // ✅ Also set isResume from env var (for cloud mode where session restoration may be partial)
  if (!initial.isResume && process.env.ANT_IS_RESUME === 'true') {
    initial.isResume = true;
  }

  // Write resume marker to token log so run boundaries are visible
  if (initial.isResume && initial.context?.featurePath && initial.jobId) {
    const { getTokenLogger } = await import('../../../../core/utils/tokenLogger');
    const logger = getTokenLogger({ featurePath: initial.context.featurePath, jobId: initial.jobId });
    logger.logResumeMarker().catch(() => {});
  }
  
  // ✅ FIX: Save directive to session EARLY (before graph invoke)
  // Ensures directive survives early interruptions (triage/detectEnvironment stage)
  // Without this, if job is interrupted before decompose, directive is lost
  if (initial.deps?.session && initial.context.featureFolder && initial.directive) {
    try {
      const session = await initial.deps.session.load(
        initial.context.project,
        initial.context.featureFolder,
        'code'
      );
      if (!session.state?.directive) {
        await initial.deps.session.updateArtifacts(
          initial.context.project,
          initial.context.featureFolder,
          'code',
          {
            state: {
              ...session.state,
              directive: initial.directive,
              overrideDirective: initial.overrideDirective,
              userLanguage: initial.context.userLanguage,
            }
          }
        );
        console.log(`💾 [CodeRunner] Saved directive to session (early checkpoint)`);
      }
    } catch (err) {
      // Non-critical: directive save is a safety net
    }
  }
  
  try {
    state = await (app as any).invoke(initial as any, {
      recursionLimit: finalLimit  // ✅ LangGraph RunnableConfig uses camelCase (NOT snake_case!)
    }) as ArchitectGraphState;
  } catch (error: any) {
    // Recursion limit or other errors
    if (error.message.includes('Recursion limit')) {
      console.log(`⚠️ Recursion limit reached (${finalLimit} nodes)`);
    } else {
      console.log(`⚠️ Execution interrupted: ${error.message}`);
    }
    
    // ✅ Try to restore state from last checkpoint
    if (error.state) {
      state = error.state;
    } else if (initial.deps?.session && error.message.includes('Recursion limit')) {
      // Restore from the last saved checkpoint
      try {
        const session = await initial.deps.session.load(
          initial.context.project,
          initial.context.featureFolder || 'default',
          'code'
        );
        
        if (session.state && session.state.taskQueue) {
          state = {
            ...initial,
            taskQueue: TaskQueue.from<CodeTask>(session.state.taskQueue),
            currentTask: session.state.currentTask,
            completedTasks: session.state.completedTasks || [],
            completedTasksDetails: session.state.completedTasksDetails || [],
            retries: 0,
            maxRetries: session.state.maxRetries || 3,
            previousAttempts: session.state.previousAttempts || [],
            enforcementHistory: session.state.enforcementHistory || [],
            lastViolations: session.state.lastViolations || [],
            previousFileCount: session.state.previousFileCount,
            resolvedCategories: (session.state.resolvedCategories || []) as any,
            recursionCount: session.state.recursionCount || 0,
            recursionLimit: Math.max(session.state.recursionLimit || 0, finalLimit),
            ...(session.state.profile || session.state.detectionReport?.profile) && {
              profile: session.state.profile ?? session.state.detectionReport?.profile
            },
            ...(session.state.jobId && { jobId: session.state.jobId }),
            ...(session.state.jobTiming && { jobTiming: session.state.jobTiming }),
            ...(session.state.detectionReport && { detectionReport: session.state.detectionReport }),
            ...(session.state.referenceRequests && { referenceRequests: session.state.referenceRequests }),
            ...(session.state.designDocUnknownPackages && { designDocUnknownPackages: session.state.designDocUnknownPackages }),
            ...(session.state.projectCodeContext && { projectCodeContext: session.state.projectCodeContext }),
          } as any;
          if (session.state.userLanguage) {
            state.context.userLanguage = session.state.userLanguage;
          }
        }
      } catch (restoreError) {
        console.warn('⚠️  Failed to restore from checkpoint:', restoreError);
      }
    }
    
    // Re-throw if not recursion limit
    if (!error.message.includes('Recursion limit')) {
      // ✅ CRITICAL: Cleanup any active chat message before re-throwing
      // This prevents stale currentMessage in Redis when the job fails
      try {
        const chatAPI = getChatAPIClient();
        if (chatAPI.hasActiveMessage()) {
          console.log('🧹 [CodeRunner] Cleaning up active message after error...');
          await chatAPI.finalizeMessage(true); // cancelled = true
        }
      } catch (cleanupError) {
        console.warn('⚠️ [CodeRunner] Failed to cleanup message:', cleanupError);
      }
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
    
    // Move currentTask back to queue FIRST (before learn node)
    if (state.currentTask && state.taskQueue) {
      const { TaskTimingHelper } = await import('./state');
      const pausedTask = TaskTimingHelper.pauseTask(state.currentTask);
      pausedTask.interrupted = true;
      
      const remaining = state.taskQueue.getAll().filter((t: any) => t.id !== state.currentTask!.id);
      state.taskQueue = TaskQueue.from<CodeTask>([pausedTask, ...remaining]);
      state.currentTask = undefined;
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
    
    // Save pause state BEFORE learn node (learn node can fail)
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('./nodes/checkpoint');
        state.currentTask = undefined;
        
        const pausedState = {
          ...state,
          interruption
        };
        await saveCheckpoint(pausedState);
      } catch (saveError) {
        // Failed to save pause state
      }
    }
    
    // ✅ CRITICAL: Set interruption in state before learn node
    state.interruption = interruption;
    
    // Try to run learn node for cleanup (optional, can fail safely)
    try {
      const { learn } = await import('./nodes/index');
      state = await learn(state);
      
      if (!state.interruption) {
        state.interruption = interruption;
      }
    } catch (learnError) {
      // Learn node failed (non-critical)
    }
    
    console.log(`⏸️ Paused: ${state.completedTasks?.length || 0} completed, ${remainingTasks} remaining`);
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
    interruption: state.interruption,
    triageResult: state.triageResult,  // ✅ Pass triage result for ask/redirect/blocked handling
  };
}
