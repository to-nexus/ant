/**
 * Plan Graph Runner
 * 
 * Entry point for running Plan LangGraph.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { buildPlanGraph } from './graph';
import { PlanGraphState, createInitialPlanState } from './state';
import { WorkspaceState } from '../../../common/nodes/triage/types';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { setPlannerWorkspaceFeaturePath, setPlannerFileTreeUpdate } from '../tools';

export interface PlanRunnerParams {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  mode?: 'generate' | 'refine';
  isResume?: boolean;
  chatSource?: boolean;
  skipTriage?: boolean;
  deps?: PlanGraphState['deps'];
  _httpJobId?: string;
}

export interface PlanRunnerResult {
  generatedDocument?: string;
  mode: string;
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
    mode: params.mode,
    isResume: params.isResume,
    chatSource: params.chatSource,
    skipTriage: params.skipTriage,
    deps: params.deps,
    _httpJobId: params._httpJobId,
  });
  
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '200', 10);
  
  // ✅ Initialize JobTiming on KanbanBroadcaster (same as architect)
  // This enables the elapsed time badge on the task board header
  // Hoisted to outer scope so timing can be finalized on all exit paths (completion, interruption, error)
  let jobTimingRef: import('../../../common/graph/timing/JobTimingManager').JobTiming | undefined;
  let JobTimingManagerRef: typeof import('../../../common/graph/timing/JobTimingManager').JobTimingManager | undefined;
  const setJobTiming = params.deps?.kanbanUpdate?.setJobTiming;
  
  if (params._httpJobId && setJobTiming) {
    const { JobTimingManager } = await import('../../../common/graph/timing/JobTimingManager');
    JobTimingManagerRef = JobTimingManager;
    const { jobTiming } = JobTimingManager.initializeNewJob(params._httpJobId);
    jobTimingRef = jobTiming;
    setJobTiming(jobTiming);
    
    // Send initial kanban update with recursion info (triggers badge display)
    if (params.deps.kanbanUpdate.updateTaskQueue) {
      params.deps.kanbanUpdate.updateTaskQueue(
        params._httpJobId,
        null,           // no currentTask (planner has no task queue)
        [],             // empty queue
        [],             // no completed tasks
        0,              // recursionCount starts at 0
        recursionLimit, // recursionLimit for badge
      );
    }
  }
  
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
      
      // Read the current staging file which has been edited by all tool calls so far
      let generatedDocument: string | undefined;
      const stagingPath = path.join(params.featurePath, 'outputs/plan/prd-refine.md');
      try {
        generatedDocument = await fsPromises.readFile(stagingPath, 'utf-8');
        console.log(`📝 [Planner] Read edited PRD from staging (${generatedDocument.length} chars)`);
      } catch {
        console.log(`📝 [Planner] No staging file found`);
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
      if (JobTimingManagerRef && jobTimingRef && setJobTiming) {
        jobTimingRef = JobTimingManagerRef.pauseJob(jobTimingRef)!;
        setJobTiming(jobTimingRef);
      }
      
      console.log('\n⏸️ Planner Agent paused (recursion limit)');
      console.log(`   Document length: ${generatedDocument?.length || 0} chars`);
      
      // Return with interruption — JobWorker sets status='paused',
      // then JobCleanupManager creates the Resume/Dismiss choice card automatically.
      // This matches the code job pattern (architectAgent → interruption → paused).
      return {
        generatedDocument,
        mode: initialState.mode,
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
    if (JobTimingManagerRef && jobTimingRef && setJobTiming) {
      jobTimingRef = JobTimingManagerRef.completeJob(jobTimingRef)!;
      setJobTiming(jobTimingRef);
    }
    
    if (chatAPI.hasActiveMessage()) {
      try {
        await chatAPI.finalizeMessage(true);
      } catch (cleanupError) {
        console.warn('⚠️ [Planner] Failed to cleanup message:', cleanupError);
      }
    }
    
    throw error;
  }
  
  // ✅ FIX: Mark jobTiming as completed so ElapsedTimeBadge stops ticking
  if (JobTimingManagerRef && jobTimingRef && setJobTiming) {
    jobTimingRef = JobTimingManagerRef.completeJob(jobTimingRef)!;
    setJobTiming(jobTimingRef);
  }
  
  console.log('\n✅ Planner Agent completed');
  console.log(`   Mode: ${finalState.mode}`);
  console.log(`   Document length: ${finalState.generatedDocument?.length || 0} chars`);
  
  return {
    generatedDocument: finalState.generatedDocument,
    mode: finalState.mode,
    tokenUsage: finalState.tokenUsage,
  };
}
