/**
 * Ask Graph Runner
 * 
 * Entry point for running Ask LangGraph from triage node.
 * 
 * Security guardrails are handled at the prompt level (ask/rules.md)
 * where the LLM can make context-aware decisions. No hardcoded regex
 * filters — they cause false positives on legitimate code instructions
 * (env vars, auth implementation as project spec, etc.).
 */

import { buildAskGraph } from './graph.js';
import { AskGraphState, createInitialAskState } from './state.js';
import { WorkspaceState } from '../../../common/nodes/triage/types.js';
import { setWorkspaceFeaturePath } from './tools.js';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';
import type { ResolvedActionContext } from '@ant/shared';

const DEBUG = process.env.ASK_DEBUG === 'true';

export interface AskRunnerParams {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  deps?: { llm?: any };
  _httpJobId?: string;
  resolvedAction?: ResolvedActionContext;
}

export interface AskRunnerResult {
  response: string;
  toolCallCount: number;
  tokenUsage?: import('@ant/shared').TaskTokenUsage;
}

/**
 * Run Ask LangGraph
 */
export async function runAskGraph(params: AskRunnerParams): Promise<AskRunnerResult> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💬 ASK SYSTEM (Agentic)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log(`📝 Question: ${params.question.substring(0, 50)}${params.question.length > 50 ? '...' : ''}`);
  console.log(`🌐 Language: ${params.language}\n`);
  
  // Build graph
  const graph = buildAskGraph();
  
  // Set workspace context for workspace tools
  setWorkspaceFeaturePath(params.workspaceState.featurePath);
  
  // Create initial state
  const initialState = createInitialAskState({
    question: params.question,
    language: params.language,
    workspaceState: params.workspaceState,
    currentJob: params.currentJob,
    currentAgent: params.currentAgent,
    deps: params.deps,
    _httpJobId: params._httpJobId,
  });
  
  // Set featurePath for eval save
  initialState.featurePath = params.workspaceState.featurePath;
  
  // Pass RAC from triage
  if (params.resolvedAction) {
    initialState.resolvedAction = params.resolvedAction;
  }
  
  // Run graph with recursion limit (default: 100 for Ask job, can be overridden via ASK_RECURSION_LIMIT)
  const recursionLimit = parseInt(process.env.ASK_RECURSION_LIMIT || '100', 10);
  
  if (DEBUG) {
    console.log(`🔄 Recursion limit: ${recursionLimit}`);
  }
  
  // ✅ CRITICAL: Use try-finally to ensure message finalization on error
  // This prevents stale currentMessage in Redis when graph fails
  const chatAPI = getChatAPIClient();
  let finalState: AskGraphState;
  let graphError: Error | null = null;
  
  try {
    finalState = await (graph as any).invoke(initialState as any, {
      recursionLimit,
    }) as AskGraphState;
  } catch (error) {
    graphError = error as Error;
    console.error(`❌ [Ask] Graph execution failed: ${graphError.message}`);
    
    // ✅ CRITICAL: Finalize any active message to prevent stale state in Redis
    // This ensures the next job won't be affected by this job's failure
    if (chatAPI.hasActiveMessage()) {
      console.log('🧹 [Ask] Cleaning up active message after error...');
      try {
        // ✅ Send user-friendly message before finalizing (especially for recursion limit)
        if (graphError.message.includes('Recursion limit')) {
          const limitMessage = params.language === 'ko'
            ? '\n\n⚠️ 질문에 답하기 위해 더 많은 정보를 확인하던 중 처리 한도에 도달했습니다. 더 구체적인 질문을 해주시거나, 필요한 정보를 직접 알려주세요.'
            : '\n\n⚠️ Reached processing limit while gathering information to answer your question. Please try asking a more specific question or provide the needed information directly.';
          await chatAPI.sendLLMEvent({ type: 'text', text: limitMessage });
        }
        await chatAPI.finalizeMessage(true); // cancelled = true
      } catch (cleanupError) {
        console.warn('⚠️ [Ask] Failed to cleanup message:', cleanupError);
      }
    }
    
    throw graphError;
  }
  
  // Log summary
  console.log('\n✅ Ask System completed');
  console.log(`   Tool calls: ${finalState.toolCalls.length}`);
  
  if (DEBUG && finalState.toolCalls.length > 0) {
    console.log('   Tool call details:');
    finalState.toolCalls.forEach((tc, idx) => {
      console.log(`     ${idx + 1}. ${tc.name}(${JSON.stringify(tc.args)})`);
      if (tc.error) {
        console.log(`        Error: ${tc.error}`);
      }
    });
  }
  
  return {
    response: finalState.response || '',
    toolCallCount: finalState.toolCalls.length,
    tokenUsage: finalState.tokenUsage,
  };
}
