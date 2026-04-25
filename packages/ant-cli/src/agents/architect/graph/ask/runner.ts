/**
 * Ask Graph Runner
 * 
 * Entry point for running Ask LangGraph from triage node.
 * 
 * Security guardrails are handled at the prompt level (jobs/ask/nodes/agent/variants/default/rules.md)
 * where the LLM can make context-aware decisions. No hardcoded regex
 * filters — they cause false positives on legitimate code instructions
 * (env vars, auth implementation as project spec, etc.).
 */

import { buildAskGraph } from './graph';
import { AskGraphState, createInitialAskState } from './state';
import { WorkspaceState } from '../../../common/graph/nodes/triage/types';
import { setWorkspaceFeaturePath } from './tools';
import { loadRecursionLimit, isRecursionLimitError, cleanupChat, invokeGraph } from '../../../common/graph/runnerHelpers';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import type { ResolvedActionContext } from '@ant/shared';

const DEBUG = process.env.ASK_DEBUG === 'true';

export interface AskRunnerParams {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  deps?: {
    llm?: any;
    promptBuilder?: import('../../../../core/prompt/builder/PromptBuilder').PromptBuilder;
  };
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
  
  // Ensure promptBuilder is available (triage passes only { llm })
  let promptBuilder = params.deps?.promptBuilder;
  if (!promptBuilder) {
    const { FilePromptAdapter } = await import('../../../../periphery/adapters/prompt/FilePromptAdapter');
    const { PromptBuilder } = await import('../../../../core/prompt/builder/PromptBuilder');
    promptBuilder = new PromptBuilder(new FilePromptAdapter());
  }

  // Create initial state
  const initialState = createInitialAskState({
    question: params.question,
    language: params.language,
    workspaceState: params.workspaceState,
    currentJob: params.currentJob,
    currentAgent: params.currentAgent,
    deps: { ...params.deps, promptBuilder },
    _httpJobId: params._httpJobId,
    featurePath: params.workspaceState.featurePath,
  });
  
  // Pass RAC from triage
  if (params.resolvedAction) {
    initialState.resolvedAction = params.resolvedAction;
  }
  
  const recursionLimit = loadRecursionLimit('ask', 100);
  
  if (DEBUG) {
    console.log(`🔄 Recursion limit: ${recursionLimit}`);
  }
  
  const chatAPI = getChatAPIClient();
  let finalState: AskGraphState;

  try {
    finalState = await invokeGraph(graph, initialState, recursionLimit) as AskGraphState;
  } catch (error: any) {
    console.error(`❌ [Ask] Graph execution failed: ${error.message}`);

    // chat-SSOT §5: drop the legacy `hasActiveMessage` gate — the API
    // always returns false post-rewrite, which would have suppressed
    // the recursion-limit notice and the buffer drain on every error.
    console.log('🧹 [Ask] Cleaning up after error...');
    try {
      if (isRecursionLimitError(error)) {
        const limitMessage = params.language === 'ko'
          ? '\n\n⚠️ 질문에 답하기 위해 더 많은 정보를 확인하던 중 처리 한도에 도달했습니다. 더 구체적인 질문을 해주시거나, 필요한 정보를 직접 알려주세요.'
          : '\n\n⚠️ Reached processing limit while gathering information to answer your question. Please try asking a more specific question or provide the needed information directly.';
        await chatAPI.sendLLMEvent({ type: 'text', text: limitMessage });
      }
      await chatAPI.finalizeMessage(true);
    } catch (cleanupError) {
      console.warn('⚠️ [Ask] Failed to cleanup:', cleanupError);
    }

    throw error;
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
