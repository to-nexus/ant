/**
 * Plan Graph Runner
 * 
 * Entry point for running Plan LangGraph.
 */

import { buildPlanGraph } from './graph';
import { PlanGraphState, createInitialPlanState } from './state';
import { WorkspaceState } from '../../../common/nodes/triage/types';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { setPlannerWorkspaceFeaturePath } from '../tools';

export interface PlanRunnerParams {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  mode?: 'generate' | 'refine';
  isResume?: boolean;
  chatSource?: boolean;
  deps?: PlanGraphState['deps'];
  _httpJobId?: string;
}

export interface PlanRunnerResult {
  generatedDocument?: string;
  mode: string;
  tokenUsage?: any;
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
  
  const graph = buildPlanGraph();
  
  const initialState = createInitialPlanState({
    directive: params.directive,
    language: params.language,
    workspaceState: params.workspaceState,
    featurePath: params.featurePath,
    mode: params.mode,
    isResume: params.isResume,
    chatSource: params.chatSource,
    deps: params.deps,
    _httpJobId: params._httpJobId,
  });
  
  const recursionLimit = parseInt(process.env.PLANNER_RECURSION_LIMIT || '50', 10);
  
  const chatAPI = getChatAPIClient();
  let finalState: PlanGraphState;
  
  try {
    await chatAPI.startMessage();
    
    finalState = await (graph as any).invoke(initialState as any, {
      recursionLimit,
    }) as PlanGraphState;
  } catch (error: any) {
    console.error(`❌ [Planner] Graph execution failed: ${error.message}`);
    
    if (chatAPI.hasActiveMessage()) {
      try {
        await chatAPI.finalizeMessage(true);
      } catch (cleanupError) {
        console.warn('⚠️ [Planner] Failed to cleanup message:', cleanupError);
      }
    }
    
    throw error;
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
