import { ArchitectGraphState } from "./state";
import { TaskQueue, CodeTask } from "../../types/task";
import { buildCodeGraph } from "./graph";
import { normalizeResumedQueueBudgets } from "./parallel/resumeBudgetReset";
import { resetKeywordDedup } from "./nodes/plan/rag";
import {
  loadRecursionLimit, isRecursionLimitError, cleanupChat,
  isEnvResume, logResumeMarker, invokeGraph, saveEarlyDirective,
} from "../../../common/graph/runnerHelpers";
import { markVerifyEntered } from "./tasks/_shared/verify/markVerifyEntered";
import type { InterruptionDetails } from "@ant/shared";
import type { TriageResult } from "../../../common/graph/nodes/triage/types";

export interface CodeGraphResult {
  branch: string;
  reportFile: string;
  filesChanged: number;
  interruption?: InterruptionDetails;
  triageResult?: TriageResult;
}

/**
 * Code Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 * 
 * ✅ RecursionLimit: Read from RECURSION_LIMIT env var (minimum: 5)
 * ✅ Learn node is ALWAYS executed on exit (success/error/recursion limit)
 */
export async function runCodeGraph(initial: ArchitectGraphState): Promise<CodeGraphResult> {
  resetKeywordDedup();

  const app = buildCodeGraph();
  let state: ArchitectGraphState = initial;
  let isRecursionLimit = false;
  const finalLimit = loadRecursionLimit();
  
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
        
        // Reconstruct TaskQueue from saved array. `normalizeResumedQueueBudgets`
        // is the load-boundary safety net — any task carrying `_failed: true`
        // gets its VerificationBudget axes (batchSplitCount / _failedAttempts)
        // reset to 0, regardless of which writer produced the saved state.
        // This makes the resume-after-permanent-fail contract idempotent and
        // recovers from any historical drift (vast-curling-perch RCA — fix
        // re-deploys after pre-fix saves had stale 11 leaked into Redis).
        const loadedQueue = (session.state.taskQueue ?? []) as CodeTask[];
        initial.taskQueue = TaskQueue.from<CodeTask>(normalizeResumedQueueBudgets(loadedQueue));
        initial.currentTask = undefined;  // Already moved to queue in save
        initial.completedTasks = session.state.completedTasks || [];
        initial.completedTasksDetails = session.state.completedTasksDetails || [];
        // Scenario harness escape hatch: when set, preserve seeded retries so
        // `retries >= maxRetries` branches (e.g. S09) can be reproduced.
        // Production code path leaves the env unset → behaviour unchanged.
        initial.retries = process.env.ANT_SCENARIO_PRESERVE_RETRIES === '1'
          ? (session.state.retries ?? 0)
          : 0;
        initial.maxRetries = session.state.maxRetries || 3;
        initial.previousAttempts = session.state.previousAttempts || [];
        initial.enforcementHistory = session.state.enforcementHistory || [];
        initial.previousFileCount = session.state.previousFileCount;
        initial.resolvedCategories = (session.state.resolvedCategories || []) as any;
        initial.recursionCount = 0;  // Reset per invoke (must match LangGraph's per-invoke recursionLimit)
        // ✅ Use the HIGHER of session limit vs current env limit
        // Prevents stale low limits from old sessions overriding a raised RECURSION_LIMIT
        initial.recursionLimit = Math.max(session.state.recursionLimit || 0, finalLimit);
        initial.tokenUsage = session.state.tokenUsage;  // ✅ CRITICAL: Restore job-level token usage
        initial._estimatingTokenUsage = session.state.estimatingTokenUsage;
        
        if (session.state.resolvedAction) {
          initial.resolvedAction = session.state.resolvedAction;
        }
        
        if (session.state.referenceRequests) {
          initial.referenceRequests = session.state.referenceRequests;
        }
        
        if (session.state.profile) {
          initial.profile = session.state.profile;
        }

        // ✅ Restore planText for task-level resume (skip plan regeneration)
        if (session.state.planText) {
          initial.planText = session.state.planText;
        }
        
        // ✅ Restore conversations for mid-task resume (execute continues from interruption point)
        if (session.state.conversations) {
          initial.conversations = session.state.conversations;
        }
        
        // CRITICAL: workspaceConfig is already set in initial state (from orchestrator)
        
        // Restore directive from session (design/prd are rebuilt by resolve from disk)
        if (session.state.overrideDirective) {
          initial.directive = session.state.overrideDirective;
        } else if (session.state.directives && session.state.directives.length > 0) {
          initial.directive = session.state.directives[0];
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

        // Restores `_verifyEntered=true` when a resumed code-job session
        // had already crossed into verify-mode (legacy session.state shape
        // carried a `verification` field — its presence is the witness).
        // Without this flip, a Tier 2 self-verify task interrupted
        // mid-reverify would resume with `_verifyEntered=false` and route
        // the next plan/execute through the apply-phase hooks.
        if ((session.state as { verification?: unknown }).verification !== undefined) {
          markVerifyEntered(initial as ArchitectGraphState);
        }
      } else if (session?.state && process.env.ANT_IS_RESUME === 'true') {
        // Restore partial state from early-interrupted session (triage/detectEnv stage)
        // GUARD: Only when API explicitly says this is a resume (ANT_IS_RESUME)
        const savedDirective = session.state.directive || session.state.overrideDirective;
        if (savedDirective && !initial.directive) {
          console.log(`🔄 [CodeRunner] Restoring directive from early-interrupted session`);
          initial.directive = savedDirective;
        }
        if (session.state.resolvedAction && !initial.resolvedAction) {
          console.log(`🔄 [CodeRunner] Restoring resolvedAction from session`);
          initial.resolvedAction = session.state.resolvedAction;
        }
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
        // Restore Decompose clarify fields (awaiting/bypassed/choice) so
        // routeAfterResolve can branch directly to `decompose` without a
        // fresh triage pass.
        const sRaw = session.state;
        if (sRaw.awaitingDecomposeClarify) {
          initial.awaitingDecomposeClarify = true;
        }
        if (sRaw._specClarifyBypassed === true) {
          initial._specClarifyBypassed = true;
        }
        if (sRaw.specClarify && !initial.specClarify) {
          initial.specClarify = sRaw.specClarify;
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
  
  if (!initial.isResume && isEnvResume()) {
    initial.isResume = true;
  }

  if (initial.isResume && initial.context?.featurePath && initial.jobId) {
    await logResumeMarker(initial.context.featurePath, initial.jobId);
  }
  
  await saveEarlyDirective(initial, 'code');
  
  try {
    state = await invokeGraph(app, initial, finalLimit) as ArchitectGraphState;
  } catch (error: any) {
    if (isRecursionLimitError(error)) {
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
          // Same load-boundary safety net as the primary resume path —
          // see normalizeResumedQueueBudgets JSDoc for rationale.
          const restoredQueue = (session.state.taskQueue ?? []) as CodeTask[];
          state = {
            ...initial,
            taskQueue: TaskQueue.from<CodeTask>(normalizeResumedQueueBudgets(restoredQueue)),
            currentTask: session.state.currentTask,
            completedTasks: session.state.completedTasks || [],
            completedTasksDetails: session.state.completedTasksDetails || [],
            retries: 0,
            maxRetries: session.state.maxRetries || 3,
            previousAttempts: session.state.previousAttempts || [],
            enforcementHistory: session.state.enforcementHistory || [],
            previousFileCount: session.state.previousFileCount,
            resolvedCategories: (session.state.resolvedCategories || []) as any,
            recursionCount: session.state.recursionCount || 0,
            recursionLimit: Math.max(session.state.recursionLimit || 0, finalLimit),
            ...(session.state.profile && { profile: session.state.profile }),
            ...(session.state.jobId && { jobId: session.state.jobId }),
            ...(session.state.jobTiming && { jobTiming: session.state.jobTiming }),
            ...(session.state.resolvedAction && { resolvedAction: session.state.resolvedAction }),
            ...(session.state.referenceRequests && { referenceRequests: session.state.referenceRequests }),
          } as any;
          if (session.state.userLanguage) {
            state.context.userLanguage = session.state.userLanguage;
          }
        }
      } catch (restoreError) {
        console.warn('⚠️  Failed to restore from checkpoint:', restoreError);
      }
    }
    
    if (!isRecursionLimitError(error)) {
      await cleanupChat();
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
        branch: state.branch || '',
        reportFile: state.reportFile || '',
        filesChanged: state.filesWritten || 0,
        interruption: state.interruption,
        triageResult: state.triageResult,
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
        const { saveCheckpoint } = await import('./session/checkpoint');
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
