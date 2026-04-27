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
import { CONV_KEYS } from '../../../common/graph/conversations';
import type { Conversations } from '../../../common/graph/conversations';
import { WorkspaceState } from '../../../common/graph/nodes/triage/types';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { loadRecursionLimit, isRecursionLimitError, cleanupChat, invokeGraph, isEnvResume } from '../../../common/graph/runnerHelpers';
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
  
  const recursionLimit = loadRecursionLimit(200);
  
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
        
        // ✅ Restore conversations from session (enables LLM to continue from exact interruption point)
        if (session.state.conversations) {
          const nodeGen = session.state.conversations[CONV_KEYS.NODE_GENERATE];
          if (nodeGen?.length) {
            console.log(`🔄 [PlanRunner] Restoring conversations (node:generate=${nodeGen.length} entries)`);
            initialState.conversations = { ...initialState.conversations, ...session.state.conversations };
          }
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
        
      } else if (session?.state && session.state.awaitingClarify) {
        // ✅ Clarify continuation: previous run emitted a `<clarify>` card and
        // wrote `awaitingClarify=true` + RAC + conversations to session.
        // Restore everything so triage/detect can be skipped via
        // routeAfterPlannerResolve and generate's entry hook can append the
        // user's answer (state.overrideDirective) to NODE_GENERATE.
        // Mirrors design/runner.ts:138-156 (canonical pattern).
        console.log(`🔄 [PlanRunner] Restoring awaitingClarify state from session`);
        initialState.isResume = true;
        initialState.awaitingClarify = true;

        if (session.state.conversations) {
          initialState.conversations = { ...initialState.conversations, ...session.state.conversations };
        }
        if (session.state.resolvedAction) {
          initialState.resolvedAction = session.state.resolvedAction;
          console.log(`🔄 [PlanRunner] Restoring resolvedAction (mode=${session.state.resolvedAction.mode})`);
        }
        if (session.state.directive && !initialState.directive) {
          initialState.directive = session.state.directive;
        }
        if (session.state.chatSource !== undefined) {
          initialState.chatSource = session.state.chatSource;
        }
        if (session.state.tokenUsage) {
          initialState.tokenUsage = session.state.tokenUsage;
        }
        // overrideDirective stays as params (= the new clarify answer text)
      } else if (session?.state && isEnvResume()) {
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
  if (!initialState.isResume && isEnvResume()) {
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
            // ✅ Preserve persisted RAC when the current run hasn't computed
            // one yet. clarify-continuation jobs arrive without
            // `actionMetadata` (FE doesn't re-send it), so without this guard
            // we'd overwrite the run-1 `resolvedAction` with `undefined`
            // and force detect to re-infer intent from the bare answer text.
            resolvedAction: initialState.resolvedAction ?? session.state?.resolvedAction,
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
    conversations: { ...initialState.conversations },
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
  // On SIGTERM, saves directive/overrideDirective/conversations from stateSnapshot to session.
  // NOTE: Always saves state (not gated on conversations length) because directive and
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
          // Only override conversations when non-empty (preserve existing from prior run)
          const nodeGen = stateSnapshot.conversations?.[CONV_KEYS.NODE_GENERATE];
          if (nodeGen?.length) {
            updates.conversations = stateSnapshot.conversations;
          }
          await params.deps.session.updateArtifacts(projectId, featureName, 'plan', {
            state: updates
          });
          console.log(`💾 [PlanRunner] Saved state on interruption (${nodeGen?.length || 0} history entries)`);
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
    
    finalState = await invokeGraph(graph, initialState, recursionLimit);
  } catch (error: any) {
    if (isRecursionLimitError(error)) {
      console.log(`⚠️ [Planner] Recursion limit reached (${recursionLimit}). Finalizing with current progress.`);
      
      // Read target file (edited by tool calls so far) — path derived from target
      const target = initialState.resolvedAction?.target?.[0];
      const targetFile = target || undefined;
      let targetSize = 0;
      if (targetFile) {
        try {
          const content = await fsPromises.readFile(path.join(params.featurePath, targetFile), 'utf-8');
          targetSize = content.length;
          console.log(`📝 [Planner] Target file found: ${targetFile} (${targetSize} chars)`);
        } catch {
          console.log(`📝 [Planner] No target file found`);
        }
      }
      
      await cleanupChat(false);
      
      // ✅ FIX: Mark jobTiming as paused so ElapsedTimeBadge stops ticking
      if (JobTimingManagerRef && jobTimingRef && kanbanUpdate?.setJobTiming) {
        jobTimingRef = JobTimingManagerRef.pauseJob(jobTimingRef)!;
        kanbanUpdate.setJobTiming(jobTimingRef);
        if (stateSnapshot) stateSnapshot.jobTiming = jobTimingRef;
      }
      
      console.log('\n⏸️ Planner Agent paused (recursion limit)');
      console.log(`   Target: ${targetFile || 'none'} (${targetSize} chars)`);
      
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
              // ✅ Save latest conversations from stateSnapshot for resume
              conversations: stateSnapshot?.conversations?.[CONV_KEYS.NODE_GENERATE]?.length
                ? stateSnapshot.conversations
                : session.state?.conversations,
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
    
    await cleanupChat(true);
    
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
      finalState.recursionLimit ?? recursionLimit,
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
