/**
 * Ask Graph Runner
 * 
 * Entry point for running Ask LangGraph from triage node.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { buildAskGraph } from './graph.js';
import { AskGraphState, createInitialAskState } from './state.js';
import { WorkspaceState } from '../../../common/nodes/triage/types.js';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient.js';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Forbidden question patterns (security filter)
 */
const FORBIDDEN_QUESTION_PATTERNS = [
  /api\s*key/i,
  /secret/i,
  /password/i,
  /credential/i,
  /token.*생성/i,
  /인증.*구현/i,
  /auth.*implement/i,
  /환경\s*변수/i,
  /\.env/i,
];

export interface AskRunnerParams {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  deps?: { llm?: any };
  _httpJobId?: string;
}

export interface AskRunnerResult {
  response: string;
  toolCallCount: number;
  blocked?: boolean;
}

/**
 * Check if question is about sensitive topics
 */
function isQuestionForbidden(question: string): boolean {
  return FORBIDDEN_QUESTION_PATTERNS.some(pattern => pattern.test(question));
}

/**
 * Save debug info to sessions/debug/asks/ directory
 * Similar to Code Job's sessions/debug/plans/
 */
async function saveDebugInfo(
  featurePath: string | undefined,
  jobId: string | undefined,
  question: string,
  finalState: AskGraphState
): Promise<void> {
  // Always log debug status
  console.log(`📝 [Ask Debug] DEBUG=${DEBUG}, featurePath=${featurePath ? 'present' : 'MISSING'}`);
  
  if (!DEBUG) {
    console.log(`📝 [Ask Debug] Skipped: ASK_DEBUG is not enabled`);
    return;
  }
  
  if (!featurePath) {
    console.log(`📝 [Ask Debug] Skipped: featurePath is undefined`);
    return;
  }
  
  try {
    // Create sessions/debug/asks/ directory
    const debugDir = path.join(featurePath, 'sessions', 'debug', 'asks');
    await fs.mkdir(debugDir, { recursive: true });
    
    // Use jobId or timestamp for filename
    const filename = jobId || `ask-${Date.now()}`;
    const filepath = path.join(debugDir, `${filename}.json`);
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      question,
      language: finalState.language,
      toolCalls: finalState.toolCalls.map(tc => ({
        name: tc.name,
        args: tc.args,
        result: tc.result ? tc.result.substring(0, 500) + (tc.result.length > 500 ? '...' : '') : undefined,
        error: tc.error,
        timestamp: tc.timestamp,
      })),
      conversationHistory: finalState.conversationHistory.map(msg => ({
        role: msg.role,
        contentPreview: typeof msg.content === 'string' 
          ? msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : '')
          : JSON.stringify(msg.content).substring(0, 200),
      })),
      response: finalState.response ? finalState.response.substring(0, 1000) + (finalState.response.length > 1000 ? '...' : '') : undefined,
      tokenUsage: finalState.tokenUsage,
    };
    
    await fs.writeFile(filepath, JSON.stringify(debugInfo, null, 2), 'utf-8');
    console.log(`📝 [Ask Debug] Saved to ${filepath}`);
  } catch (error) {
    console.warn('[Ask Debug] Failed to save debug info:', error);
  }
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
  
  // Security: Check forbidden questions
  if (isQuestionForbidden(params.question)) {
    console.log('🚫 Question blocked (security filter)');
    
    const blockedResponse = params.language === 'ko'
      ? '죄송합니다. 보안 관련 질문에는 답변할 수 없습니다. 일반적인 Ant 사용법에 대해 질문해 주세요.'
      : 'Sorry, I cannot answer security-related questions. Please ask about general Ant usage.';
    
    // Use singleton ChatAPIClient (same as Code Job)
    const chatAPI = getChatAPIClient();
    await chatAPI.startMessage();
    await chatAPI.sendLLMEvent({ type: 'text', text: blockedResponse });
    await chatAPI.finalizeMessage();
    
    return {
      response: blockedResponse,
      toolCallCount: 0,
      blocked: true,
    };
  }
  
  // Build graph
  const graph = buildAskGraph();
  
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
  
  // Save debug info to file (similar to Code Job's plan debug)
  await saveDebugInfo(
    params.workspaceState.featurePath,
    params._httpJobId,
    params.question,
    finalState
  );
  
  return {
    response: finalState.response || '',
    toolCallCount: finalState.toolCalls.length,
  };
}
