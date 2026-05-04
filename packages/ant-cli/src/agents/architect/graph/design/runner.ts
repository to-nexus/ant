import { buildDesignGraph } from "./graph";
import { DesignGraphState } from "./state";
import { DesignTask } from "../../types/task";
import path from 'node:path';
import * as fs from 'fs/promises';
import { getSessionRuntimeDir } from '../../../../core/utils/sessionPaths';
import {
  loadRecursionLimit, isRecursionLimitError, cleanupChat,
  isEnvResume, logResumeMarker, invokeGraph, saveEarlyDirective,
} from "../../../common/graph/runnerHelpers";
import { JobTimingManager } from "../../../common/graph/timing/JobTimingManager";
import { saveInterruptionCheckpoint } from "./session/checkpoint";

/**
 * Design Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 * 
 * ✅ Resume Architecture (aligned with Code Runner):
 * - Loads session state BEFORE graph invoke
 * - Sets isResume flag for graph router (4-way routing after resolve)
 * - Restores: taskQueue, completedTasks, planText, conversations, etc.
 */
export async function runDesignGraph(initial: DesignGraphState) {
  const app = buildDesignGraph();
  const finalLimit = loadRecursionLimit();
  console.log(`🔍 [DesignRunner] Recursion limit: ${finalLimit}`);

  // F3.5 — surface stale design tasks emitted by the most recent
  // `rev-plan` impact alert. Read-only; the chat-status card is the
  // SSOT, this helper just logs so operators see the count in console
  // before the graph invocation begins.
  if (initial.context?.featurePath) {
    try {
      const { loadStaleTasks } = await import('../../../../core/refine/loadStaleTasks');
      const summary = await loadStaleTasks(initial.context.featurePath);
      if (summary.affectedTaskIds.length > 0) {
        console.log(
          `📌 [DesignRunner] ${summary.affectedTaskIds.length} task(s) marked stale by most recent rev-plan: ` +
          summary.affectedTaskIds.join(', '),
        );
      }
      if (summary.unscannableTaskIds.length > 0) {
        console.log(
          `⚠️  [DesignRunner] ${summary.unscannableTaskIds.length} task(s) built without PRD/GDD as ref — ` +
          'cross-document sync cannot speak for them.',
        );
      }
    } catch (error: any) {
      console.warn(`⚠️  [DesignRunner] loadStaleTasks failed: ${error?.message ?? error}`);
    }
  }

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
      // ✅ Also detect orphaned interrupted tasks from periodic checkpoints.
      // saveCheckpoint() marks running tasks as interrupted in the queue as a safety measure,
      // but doesn't set state.interruption. If the process dies before completion, the session
      // has tasks with interrupted: true but no top-level interruption field.
      const hasOrphanedInterruptedTasks = !hasInterruption && hasTaskQueue
        && session?.state?.taskQueue?.some((t: any) => t.interrupted);

      if ((hasInterruption || hasOrphanedInterruptedTasks) && hasTaskQueue && session.state) {
        console.log(`🔄 [DesignRunner] Resuming: ${session.state.taskQueue?.length || 0} tasks in queue, ${session.state.completedTasks?.length || 0} completed`);
        
        // ✅ Set isResume flag for graph router
        initial.isResume = true;
        
        // Reconstruct TaskQueue from saved array
        const { TaskQueue } = await import('../../types/task');
        initial.taskQueue = TaskQueue.from<DesignTask>(session.state.taskQueue);
        initial.currentTask = undefined;  // Already moved to queue in save
        initial.completedTasks = session.state.completedTasks || [];
        initial.completedTasksDetails = session.state.completedTasksDetails || [];
        initial.tokenUsage = session.state.tokenUsage;
        initial._estimatingTokenUsage = session.state.estimatingTokenUsage;

        if (session.state.resolvedAction) {
          initial.resolvedAction = session.state.resolvedAction;
        }
        
        if (session.state.figmaConfig) {
          initial.figmaConfig = session.state.figmaConfig;
        }
        // Load figmaExplorationResult from sidecar file (preferred) or session fallback
        if (initial.context?.featurePath) {
          const sidecarPath = path.join(
            getSessionRuntimeDir(initial.context.featurePath, 'architect', 'design'),
            'figma-exploration.json',
          );
          try {
            const raw = await fs.readFile(sidecarPath, 'utf-8');
            initial.figmaExplorationResult = JSON.parse(raw);
          } catch {
            if (session.state.figmaExplorationResult) {
              initial.figmaExplorationResult = session.state.figmaExplorationResult;
            }
          }
        } else if (session.state.figmaExplorationResult) {
          initial.figmaExplorationResult = session.state.figmaExplorationResult;
        }
        
        // ✅ Restore planText for task-level resume (skip plan regeneration if applicable)
        if (session.state.planText) {
          initial.planText = session.state.planText;
        }
        
        // ✅ Restore conversations for mid-task resume (docGen continues from interruption)
        if (session.state.conversations) {
          initial.conversations = session.state.conversations;
        }
        
        if (session.state.files) {
          initial.files = session.state.files;
        }
        if (session.state.filesToDelete) {
          initial.filesToDelete = session.state.filesToDelete;
        }
        
        // ✅ Restore directive/overrideDirective from session
        if (session.state.overrideDirective) {
          initial.directive = session.state.overrideDirective;
        } else if (session.state.directives && session.state.directives.length > 0) {
          initial.directive = session.state.directives[0];
        }
        initial.overrideDirective = session.state.overrideDirective;
        initial.chatSource = session.state.chatSource;
        
        if (session.state.jobId) {
          initial.jobId = session.state.jobId;
        }
        if (session.state.jobTiming) {
          // Settle any persisted `pausedAt` into `totalPausedDuration` so
          // resume cycles do not double-count the idle window as runtime.
          const { jobTiming: resumed } = JobTimingManager.resumeJob(
            initial.jobId ?? session.state.jobId ?? '',
            session.state.jobTiming,
          );
          initial.jobTiming = resumed ?? session.state.jobTiming;
        }
        
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
        
      } else if (session?.state && session.state.awaitingDetectClarify) {
        console.log(`🔄 [DesignRunner] Restoring awaitingDetectClarify state from session`);
        initial.isResume = true;
        initial.awaitingDetectClarify = true;
        
        if (session.state.directive) {
          initial.directive = session.state.directive;
        }
        initial.overrideDirective = session.state.overrideDirective;
        initial.chatSource = session.state.chatSource;
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
      } else if (session?.state && session.state.awaitingClarify) {
        console.log(`🔄 [DesignRunner] Restoring awaitingClarify state from session`);
        initial.isResume = true;
        initial.awaitingClarify = true;
        
        if (session.state.conversations) {
          initial.conversations = session.state.conversations;
        }
        if (session.state.resolvedAction) {
          initial.resolvedAction = session.state.resolvedAction;
        }
        if (session.state.directive) {
          initial.directive = session.state.directive;
        }
        initial.overrideDirective = session.state.overrideDirective;
        initial.chatSource = session.state.chatSource;
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
      } else if (session?.state && process.env.ANT_IS_RESUME === 'true') {
        const savedDirective = session.state.directive || session.state.overrideDirective;
        if (savedDirective && !initial.directive) {
          console.log(`🔄 [DesignRunner] Restoring directive from early-interrupted session`);
          initial.directive = savedDirective;
        }
        if (session.state.resolvedAction && !initial.resolvedAction) {
          console.log(`🔄 [DesignRunner] Restoring resolvedAction from session`);
          initial.resolvedAction = session.state.resolvedAction;
        }
        if (session.state.userLanguage) {
          initial.context.userLanguage = session.state.userLanguage;
        }
      }
    } catch (err) {
      console.warn('⚠️  [DesignRunner] Failed to check for resumable session:', err);
    }
  }
  
  if (!initial.isResume && isEnvResume()) {
    initial.isResume = true;
  }

  if (initial.isResume && initial.context?.featurePath && initial.jobId) {
    await logResumeMarker(initial.context.featurePath, initial.jobId);
  }
  
  // ✅ Initialize recursion tracking in state (for UI gauge display)
  initial.recursionCount = initial.recursionCount || 0;
  initial.recursionLimit = initial.recursionLimit || finalLimit;
  
  // ✅ Set jobTiming on broadcaster for resume (so SSE broadcasts include timing from first event)
  if (initial.jobTiming && initial.deps?.kanbanUpdate?.setJobTiming) {
    initial.deps.kanbanUpdate.setJobTiming(initial.jobTiming);
  }
  
  await saveEarlyDirective(initial, 'design');
  
  try {
    const state = await invokeGraph(app, initial, finalLimit) as DesignGraphState;
    
    // ✅ Return minimal results (all files were saved in writeFiles node)
    // No need to return paths - they are deterministic from context
    return state;
  } catch (error: any) {
    // ✅ Handle recursion limit (same pattern as code runner)
    if (isRecursionLimitError(error)) {
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
            const { TaskQueue } = await import('../../types/task');
            state = {
              ...initial,
              taskQueue: TaskQueue.from<DesignTask>(session.state.taskQueue),
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
        
        const { TaskQueue } = await import('../../types/task');
        const remaining = state.taskQueue.getAll().filter((t: any) => t.id !== state.currentTask!.id);
        state.taskQueue = TaskQueue.from<DesignTask>([pausedTask, ...remaining]);
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
      
      await saveInterruptionCheckpoint(state, {
        taskQueue: state.taskQueue?.getAll() ?? [],
        interruption,
      });
      
      // Set interruption in state
      state.interruption = interruption;
      
      // Try to run learn node for cleanup
      try {
        const { learn } = await import('./nodes/learn');
        state = await learn(state);
        if (!state.interruption) {
          state.interruption = interruption;
        }
      } catch (learnError) {
        // Learn node failed (non-critical)
      }
      
      console.log(`⏸️ [DesignRunner] Paused: ${state.completedTasks?.length || 0} completed, ${state.taskQueue?.size() || 0} remaining`);
      return state;
    }
    
    console.error(`❌ [DesignRunner] Graph execution failed:`, error);
    await cleanupChat();
    throw error;
  }
}
