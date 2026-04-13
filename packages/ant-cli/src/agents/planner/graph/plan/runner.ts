/**
 * Plan Graph Runner
 * 
 * Entry point for running Plan LangGraph.
 * 
 * ✅ Resume Architecture (aligned with Design/Code Runner):
 * - Loads session state BEFORE graph invoke
 * - Sets isResume flag if interruption found in session
 * - Restores: directive, overrideDirective, tokenUsage
 * - Saves directive EARLY (before graph invoke) for crash safety
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { buildPlanGraph } from './graph';
import { PlanGraphState, createInitialPlanState, getPlanMode } from './state';
import { WorkspaceState } from '../../../common/nodes/triage/types';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { setPlannerWorkspaceFeaturePath, setPlannerFileTreeUpdate } from '../tools';
import { registerActiveOrchestrator, unregisterActiveOrchestrator } from '../../../../composition/gracefulShutdown';

export interface PlanRunnerParams {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  isResume?: boolean;
  chatSource?: boolean;
  skipTriage?: boolean;
  actionMetadata?: import('@ant/shared').ActionMetadata;
  deps?: PlanGraphState['deps'];
  _httpJobId?: string;
}

export interface PlanRunnerResult {
  planMode: string;
  tokenUsage?: any;
  interruption?: {
    reason: string;
    message: string;
    timestamp: string;
    canResume: boolean;
    metadata?: Record<string, any>;
  };
}

/**
 * Run Plan LangGraph
 */
export async function runPlanGraph(params: PlanRunnerParams): Promise<PlanRunnerResult> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 PLANNER AGENT - Plan');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`📝 Directive: ${params.directive.substring(0, 80)}${params.directive.length > 80 ? '...' : ''}`);
  console.log(`🌐 Language: ${params.language}`);
  console.log(`📂 Feature: ${params.featurePath}\n`);
  
  // Set workspace path for planner tools (read_workspace_file, list_workspace_files)
  setPlannerWorkspaceFeaturePath(params.featurePath);
  // Set file tree update port for planner tools (edit_file → notify file tree)
  setPlannerFileTreeUpdate(params.deps?.fileTreeUpdate);
  
  const graph = buildPlanGraph();
  
  const initialState = createInitialPlanState({
    directive: params.directive,
    language: params.language,
    workspaceState: params.workspaceState,
    featurePath: params.featurePath,
    isResume: params.isResume,
    chatSource: params.chatSource,
    skipTriage: params.skipTriage,
    actionMetadata: params.actionMetadata,
    deps: params.deps,
    _httpJobId: params._httpJobId,
  });
  
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '200', 10);
  
  // ✅ Resolve project/feature identifiers for session operations
  const projectId = params.deps?.session?.projectId || process.env.ANT_PROJECT_ID || 'default';
  const featureName = params.deps?.session?.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
  
  // ✅ CRITICAL: Check for resumable session BEFORE invoke
  // If session has interruption, restore directive and state (aligned with Design/Code runner pattern)
  if (params.deps?.session) {
    try {
      const session = await params.deps.session.load(projectId, featureName, 'plan');
      const hasInterruption = Boolean(session?.state?.interruption);
      
      if (hasInterruption && session.state) {
        console.log(`🔄 [PlanRunner] Resuming from interrupted session`);
        
        // ✅ Set isResume flag
        initialState.isResume = true;
        
        // ✅ Restore directive from session
        // IMPORTANT: Only set `directive`, NOT `overrideDirective`.
        // If we set overrideDirective, the resolve node interprets it as a NEW user message
        // and appends it to conversation — duplicating the original directive.
        // overrideDirective should only come from /continue endpoint (genuinely new input).
        const savedDirective = session.state.overrideDirective || session.state.directive;
        if (savedDirective && !initialState.directive) {
          console.log(`🔄 [PlanRunner] Restoring directive from session (${savedDirective.substring(0, 60)}...)`);
          initialState.directive = savedDirective;
          // ✅ Leave initialState.overrideDirective as-is (empty from params)
          // This prevents resolve from re-appending the directive to conversation
        }
        
        // ✅ Restore chatSource from session
        if (session.state.chatSource !== undefined) {
          initialState.chatSource = session.state.chatSource;
        }
        
        // ✅ Restore tokenUsage from session
        if (session.state.tokenUsage) {
          initialState.tokenUsage = session.state.tokenUsage;
        }
        
        // ✅ Restore resolvedAction from session (determines plan mode: generate/refactor/explain)
        if (session.state.resolvedAction) {
          initialState.resolvedAction = session.state.resolvedAction;
          console.log(`🔄 [PlanRunner] Restoring resolvedAction (mode=${session.state.resolvedAction.mode})`);
        }
        
        // ✅ Restore conversationHistory from session (enables LLM to continue from exact interruption point)
        if (session.state.conversationHistory?.length) {
          console.log(`🔄 [PlanRunner] Restoring conversationHistory (${session.state.conversationHistory.length} entries)`);
          initialState.conversationHistory = session.state.conversationHistory;
        }
        
        // ✅ Clear stale interruption now that we've consumed it.
        // Without this, JobCleanupManager's fallback logic finds the old interruption
        // after the new job completes successfully and treats it as interrupted.
        try {
          await params.deps.session.updateArtifacts(projectId, featureName, 'plan', {
            state: { ...session.state, interruption: undefined }
          });
          console.log(`🔄 [PlanRunner] Cleared stale interruption from session`);
        } catch (clearErr) {
          console.warn('⚠️ [PlanRunner] Failed to clear stale interruption:', clearErr);
        }
        
      } else if (session?.state && process.env.ANT_IS_RESUME === 'true') {
        // ✅ Early-interrupted session fallback (cancelled before generate completed)
        // GUARD: Only when API explicitly says this is a resume (ANT_IS_RESUME)
        const savedDirective = session.state.directive || session.state.overrideDirective;
        if (savedDirective && !initialState.directive) {
          console.log(`🔄 [PlanRunner] Restoring directive from early-interrupted session`);
          initialState.directive = savedDirective;
          // ✅ Don't set overrideDirective (same reason as above)
        }
      }
    } catch (err) {
      console.warn('⚠️ [PlanRunner] Failed to check for resumable session:', err);
    }
  }
  
  // ✅ Also set isResume from env var (for cloud mode where session restoration may be partial)
  if (!initialState.isResume && process.env.ANT_IS_RESUME === 'true') {
    initialState.isResume = true;
  }
  
  // ✅ Save directive to session EARLY (before graph invoke)
  // Ensures directive survives early interruptions (triage stage, process kill).
  // Also saves when overrideDirective is new (e.g., clarify answer submission),
  // even if a directive already exists from a prior run.
  if (params.deps?.session && params.featurePath && initialState.directive) {
    try {
      const session = await params.deps.session.load(projectId, featureName, 'plan');
      const existingDirective = session.state?.directive;
      const existingOverride = session.state?.overrideDirective;
      const hasNewOverride = initialState.overrideDirective &&
        initialState.overrideDirective !== existingOverride &&
        initialState.overrideDirective !== existingDirective;

      if (!existingDirective || hasNewOverride) {
        await params.deps.session.updateArtifacts(projectId, featureName, 'plan', {
          state: {
            ...session.state,
            directive: initialState.directive || existingDirective,
            overrideDirective: initialState.overrideDirective || initialState.directive,
            chatSource: params.chatSource,
            resolvedAction: initialState.resolvedAction,
            jobId: params._httpJobId || session.state?.jobId,
            // ✅ Clear stale interruption from previous job.
            // Without this, JobCleanupManager's fallback logic reuses the old
            // interruption (e.g., user_stopped) even when the new job completes
            // successfully, causing a spurious "cancelled" chat message.
            interruption: undefined,
          }
        });
        console.log(`💾 [PlanRunner] Saved directive to session (early checkpoint${hasNewOverride ? ', new override' : ''})`);
      }
    } catch (err) {
      // Non-critical — graph will save again in generate node
    }
  }
  
  // ✅ Initialize JobTiming on KanbanBroadcaster (same as architect)
  // This enables the elapsed time badge on the task board header
  // Hoisted to outer scope so timing can be finalized on all exit paths (completion, interruption, error)
  let jobTimingRef: import('../../../common/graph/timing/JobTimingManager').JobTiming | undefined;
  let JobTimingManagerRef: typeof import('../../../common/graph/timing/JobTimingManager').JobTimingManager | undefined;
  const kanbanUpdate = params.deps?.kanbanUpdate;
  
  if (params._httpJobId && kanbanUpdate?.setJobTiming) {
    const { JobTimingManager } = await import('../../../common/graph/timing/JobTimingManager');
    JobTimingManagerRef = JobTimingManager;
    const { jobTiming } = JobTimingManager.initializeNewJob(params._httpJobId);
    jobTimingRef = jobTiming;
    kanbanUpdate.setJobTiming(jobTiming);
    
    // Send initial kanban update with recursion info (triggers badge display)
    if (kanbanUpdate.updateTaskQueue) {
      kanbanUpdate.updateTaskQueue(
        params._httpJobId,
        null,           // no currentTask (planner has no task queue)
        [],             // empty queue
        [],             // no completed tasks
        0,              // recursionCount starts at 0
        recursionLimit, // recursionLimit for badge
      );
    }
  }
  
  // ✅ Create stateSnapshot: mutable shared reference for SIGTERM handler
  // Graph nodes update this during execution so the SIGTERM handler can access latest state.
  const stateSnapshot: NonNullable<PlanGraphState['deps']>['stateSnapshot'] = {
    conversationHistory: [...initialState.conversationHistory],
    directive: initialState.directive,
    overrideDirective: initialState.overrideDirective,
    tokenUsage: initialState.tokenUsage,
    jobTiming: jobTimingRef,
  };
  
  // Inject stateSnapshot into deps for node access
  if (initialState.deps) {
    initialState.deps.stateSnapshot = stateSnapshot;
  }
  
  // ✅ Register SIGTERM handler (aligned with code job's registerActiveOrchestrator pattern)
  // On SIGTERM, saves directive/overrideDirective/conversationHistory from stateSnapshot to session.
  // NOTE: Always saves state (not gated on conversationHistory.length) because directive and
  // overrideDirective must be persisted even when the job is killed before generate runs
  // (e.g., during triage after a clarify-answer submission).
  registerActiveOrchestrator({
    handleInterruption: async (reason) => {
      console.log(`🛑 [PlanRunner] Handling interruption: ${reason}`);
      if (params.deps?.session) {
        try {
          const session = await params.deps.session.load(projectId, featureName, 'plan');
          const updates: any = {
            ...session.state,
            directive: stateSnapshot.directive || session.state?.directive,
            overrideDirective: stateSnapshot.overrideDirective || stateSnapshot.directive || session.state?.overrideDirective,
            tokenUsage: stateSnapshot.tokenUsage || session.state?.tokenUsage,
            jobTiming: stateSnapshot.jobTiming || session.state?.jobTiming,
            interruption: {
              reason,
              message: `Plan interrupted: ${reason}`,
              timestamp: new Date().toISOString(),
              canResume: true,
            },
          };
          // Only override conversationHistory when non-empty (preserve existing from prior run)
          if (stateSnapshot.conversationHistory?.length) {
            updates.conversationHistory = stateSnapshot.conversationHistory;
          }
          await params.deps.session.updateArtifacts(projectId, featureName, 'plan', {
            state: updates
          });
          console.log(`💾 [PlanRunner] Saved state on interruption (${stateSnapshot.conversationHistory?.length || 0} history entries)`);
        } catch (err) {
          console.warn('⚠️ [PlanRunner] Failed to save interruption state:', err);
        }
      }
    }
  });
  
  const chatAPI = getChatAPIClient();
  let finalState: PlanGraphState;
  
  try {
    await chatAPI.startMessage();
    
    finalState = await (graph as any).invoke(initialState as any, {
      recursionLimit,
    }) as PlanGraphState;
  } catch (error: any) {
    const isRecursionLimit = error.message?.includes('Recursion limit')
      || error.message?.includes('recursion limit')
      || error.message?.includes('recursionLimit');
    
    if (isRecursionLimit) {
      console.log(`⚠️ [Planner] Recursion limit reached (${recursionLimit}). Finalizing with current progress.`);
      
      // Read staging file (edited by tool calls so far) — path derived from target
      const target = initialState.resolvedAction?.target?.[0];
      const stagingFile = target ? `outputs/plan/${path.basename(target)}` : undefined;
      let stagingSize = 0;
      if (stagingFile) {
        try {
          const content = await fsPromises.readFile(path.join(params.featurePath, stagingFile), 'utf-8');
          stagingSize = content.length;
          console.log(`📝 [Planner] Staging file found: ${stagingFile} (${stagingSize} chars)`);
        } catch {
          console.log(`📝 [Planner] No staging file found`);
        }
      }
      
      // Finalize any active message NORMALLY (not cancelled)
      if (chatAPI.hasActiveMessage()) {
        try {
          await chatAPI.finalizeMessage(false);
        } catch (cleanupError) {
          console.warn('⚠️ [Planner] Failed to finalize message:', cleanupError);
        }
      }
      
      // ✅ FIX: Mark jobTiming as paused so ElapsedTimeBadge stops ticking
      if (JobTimingManagerRef && jobTimingRef && kanbanUpdate?.setJobTiming) {
        jobTimingRef = JobTimingManagerRef.pauseJob(jobTimingRef)!;
        kanbanUpdate.setJobTiming(jobTimingRef);
        if (stateSnapshot) stateSnapshot.jobTiming = jobTimingRef;
      }
      
      console.log('\n⏸️ Planner Agent paused (recursion limit)');
      console.log(`   Staging: ${stagingFile || 'none'} (${stagingSize} chars)`);
      
      // ✅ Save session state on recursion limit (enables resume)
      // Without this, the session only has what saveConversationToSession saved during
      // the last completed generate cycle. The interruption must be persisted.
      if (params.deps?.session) {
        try {
          const session = await params.deps.session.load(projectId, featureName, 'plan');
          await params.deps.session.updateArtifacts(projectId, featureName, 'plan', {
            state: {
              ...session.state,
              directive: initialState.directive,
              overrideDirective: initialState.overrideDirective || initialState.directive,
              chatSource: initialState.chatSource,
              resolvedAction: initialState.resolvedAction,
              tokenUsage: stateSnapshot?.tokenUsage || initialState.tokenUsage,
              jobTiming: jobTimingRef || session.state?.jobTiming,
              // ✅ Save latest conversationHistory from stateSnapshot for resume
              conversationHistory: stateSnapshot?.conversationHistory?.length
                ? stateSnapshot.conversationHistory
                : session.state?.conversationHistory,
              recursionCount: recursionLimit,  // Hit the limit
              recursionLimit,
              jobId: params._httpJobId || session.state?.jobId,
              interruption: {
                reason: 'recursion_limit',
                message: `PRD editing paused: recursion limit reached (${recursionLimit} node executions)`,
                timestamp: new Date().toISOString(),
                canResume: true,
                metadata: { recursionLimit },
              },
            }
          });
          console.log(`💾 [PlanRunner] Saved interruption state to session (recursion limit)`);
        } catch (err) {
          console.warn('⚠️ [PlanRunner] Failed to save interruption state:', err);
        }
      }
      
      // Return with interruption — JobWorker sets status='paused',
      // then JobCleanupManager creates the Resume/Dismiss choice card automatically.
      // This matches the code job pattern (architectAgent → interruption → paused).
      unregisterActiveOrchestrator();
      return {
        planMode: getPlanMode(initialState),
        tokenUsage: initialState.tokenUsage,
        interruption: {
          reason: 'recursion_limit',
          message: `PRD editing paused: recursion limit reached (${recursionLimit} node executions)`,
          timestamp: new Date().toISOString(),
          canResume: true,
          metadata: {
            recursionLimit,
          },
        },
      };
    }
    
    // Non-recursion-limit errors: cleanup and re-throw
    console.error(`❌ [Planner] Graph execution failed: ${error.message}`);
    
    // ✅ FIX: Mark jobTiming as completed on error so ElapsedTimeBadge stops ticking
    if (JobTimingManagerRef && jobTimingRef && kanbanUpdate?.setJobTiming) {
      jobTimingRef = JobTimingManagerRef.completeJob(jobTimingRef)!;
      kanbanUpdate.setJobTiming(jobTimingRef);
      if (stateSnapshot) stateSnapshot.jobTiming = jobTimingRef;
    }
    
    if (chatAPI.hasActiveMessage()) {
      try {
        await chatAPI.finalizeMessage(true);
      } catch (cleanupError) {
        console.warn('⚠️ [Planner] Failed to cleanup message:', cleanupError);
      }
    }
    
    unregisterActiveOrchestrator();
    throw error;
  }
  
  // ✅ Unregister SIGTERM handler after successful completion
  unregisterActiveOrchestrator();
  
  // ✅ FIX: Mark jobTiming as completed so ElapsedTimeBadge stops ticking
  if (JobTimingManagerRef && jobTimingRef && kanbanUpdate?.setJobTiming) {
    jobTimingRef = JobTimingManagerRef.completeJob(jobTimingRef)!;
    kanbanUpdate.setJobTiming(jobTimingRef);
    if (stateSnapshot) stateSnapshot.jobTiming = jobTimingRef;
  }
  
  // Final token broadcast so the UI badge shows the definitive total
  // Order matters: set phase cache before updateTaskQueue broadcasts
  if (finalState.phaseTokenUsages && kanbanUpdate?.updatePhaseTokenUsages) {
    kanbanUpdate.updatePhaseTokenUsages(finalState.phaseTokenUsages);
  }
  if (params._httpJobId && kanbanUpdate?.updateTaskQueue) {
    kanbanUpdate.updateTaskQueue(
      params._httpJobId,
      null,
      [],
      [],
      finalState.recursionCount ?? 0,
      finalState.recursionLimit ?? parseInt(process.env.RECURSION_LIMIT || '200', 10),
      finalState.tokenUsage,
    );
  }

  const planMode = getPlanMode(finalState);
  console.log('\n✅ Planner Agent completed');
  console.log(`   Plan mode: ${planMode}`);
  
  return {
    planMode,
    tokenUsage: finalState.tokenUsage,
  };
}
