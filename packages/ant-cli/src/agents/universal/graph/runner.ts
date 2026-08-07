/**
 * Universal Graph Runner
 *
 * Entry point for the universal job. Lifecycle:
 *   1. Restore the thread session (conversation = the job's only memory).
 *   2. Append the new user turn to session:main.
 *   3. Connect MCP servers declared by the active definition; build registry.
 *   4. invokeGraph with the recursion backstop.
 *   5. Session persistence happens in respond; on failure the runner makes a
 *      best-effort save so the turn's conversation is not lost.
 */

import { buildUniversalGraph } from './graph';
import { createInitialUniversalState, type UniversalGraphState } from './state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../common/graph/conversations';
import { loadRecursionLimit, isRecursionLimitError, invokeGraph } from '../../common/graph/runnerHelpers';
import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../core/customAgents/activeCustomJob';
import { McpConnectionManager } from '../../../core/customAgents/McpConnectionManager';
import { buildUniversalRegistry, setUniversalMcp } from './runtime';

export interface UniversalRunnerParams {
  /** The user's message for this run (overrideDirective / input). */
  input: string;
  language: 'ko' | 'en';
  threadPath: string;
  projectId: string;
  threadId: string;
  isResume?: boolean;
  deps: {
    llm: any;
    session?: any;
    promptBuilder?: import('../../../core/prompt/builder/PromptBuilder').PromptBuilder;
    fileSystem?: import('../../../core/ports/filesystem').FileSystemPort;
    kanbanUpdate?: any;
    workflowUpdate?: any;
    fileTreeUpdate?: any;
  };
  _httpJobId?: string;
}

export interface UniversalRunnerResult {
  response: string;
  toolCallCount: number;
  tokenUsage?: import('@ant/shared').TaskTokenUsage;
}

export async function runUniversalGraph(params: UniversalRunnerParams): Promise<UniversalRunnerResult> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌐 UNIVERSAL SYSTEM (custom agent/job runtime)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const resolved = requireActiveCustomJob();
  console.log(`🧩 Definition: ${resolved.agentId}/${resolved.jobId} (${resolved.scope})`);

  // Ensure promptBuilder is available
  let promptBuilder = params.deps.promptBuilder;
  if (!promptBuilder) {
    const { FilePromptAdapter } = await import('../../../periphery/adapters/prompt/FilePromptAdapter');
    const { PromptBuilder } = await import('../../../core/prompt/builder/PromptBuilder');
    promptBuilder = new PromptBuilder(new FilePromptAdapter());
  }

  // ── Session restore: the thread conversation persists across runs.
  let restoredConversations: Record<string, ConversationMessage[]> | undefined;
  let restoredTokenUsage: any;
  let restoredTokenUsageByModel: any;
  if (params.deps.session) {
    try {
      const session = await params.deps.session.load(params.projectId, params.threadId, 'universal');
      const sessionState = session?.state;
      if (sessionState?.conversations?.[CONV_KEYS.SESSION_MAIN]?.length) {
        restoredConversations = { [CONV_KEYS.SESSION_MAIN]: sessionState.conversations[CONV_KEYS.SESSION_MAIN] };
        restoredTokenUsage = sessionState.tokenUsage;
        restoredTokenUsageByModel = sessionState.tokenUsageByModel;
        console.log(`♻️ [Universal] Restored ${restoredConversations[CONV_KEYS.SESSION_MAIN].length} conversation turns`);
      }
    } catch (e) {
      console.warn('⚠️ [Universal] Session restore failed (fresh thread):', e instanceof Error ? e.message : String(e));
    }
  }

  // ── Append the new user turn (runner owns turn admission, nodes only read).
  const conversations = restoredConversations ?? {};
  const main = [...(conversations[CONV_KEYS.SESSION_MAIN] ?? [])];
  if (params.input && params.input.trim().length > 0) {
    main.push({ role: 'user', content: params.input });
  } else if (main.length === 0) {
    throw new Error('[Universal] Empty input on a fresh thread — nothing to do');
  }
  conversations[CONV_KEYS.SESSION_MAIN] = main;

  // ── MCP connect (fail-loud: the definition declared these servers).
  const mcp = Object.keys(resolved.mcpServers).length > 0 ? new McpConnectionManager(resolved.mcpServers) : null;
  if (mcp) {
    await mcp.connect();
  }
  setUniversalMcp(mcp);
  buildUniversalRegistry(mcp);

  const initialState = createInitialUniversalState({
    userMessage: params.input,
    language: params.language,
    threadPath: params.threadPath,
    projectId: params.projectId,
    threadId: params.threadId,
    deps: { ...params.deps, promptBuilder },
    _httpJobId: params._httpJobId,
    isResume: params.isResume,
    conversations,
  });
  if (restoredTokenUsage) (initialState as any).tokenUsage = restoredTokenUsage;
  if (restoredTokenUsageByModel) (initialState as any).tokenUsageByModel = restoredTokenUsageByModel;

  const recursionLimit = loadRecursionLimit('universal', 100);
  const chatAPI = getChatAPIClient();
  let finalState: UniversalGraphState;

  try {
    finalState = await invokeGraph(buildUniversalGraph(), initialState, recursionLimit) as UniversalGraphState;
  } catch (error: any) {
    console.error(`❌ [Universal] Graph execution failed: ${error.message}`);
    try {
      if (isRecursionLimitError(error)) {
        const limitMessage = params.language === 'ko'
          ? '\n\n⚠️ 요청을 처리하던 중 라운드 한도에 도달했습니다. 요청을 더 작게 나누거나 더 구체적으로 알려주세요.'
          : '\n\n⚠️ Reached the processing round limit. Please split the request or make it more specific.';
        await chatAPI.sendLLMEvent({ type: 'text', text: limitMessage });
      }
      await chatAPI.finalizeMessage(true);
    } catch (cleanupError) {
      console.warn('⚠️ [Universal] Cleanup failed:', cleanupError);
    }

    // Best-effort session save so the user turn + partial rounds survive.
    if (params.deps.session) {
      try {
        await params.deps.session.updateArtifacts(params.projectId, params.threadId, 'universal', {
          state: {
            conversations: { [CONV_KEYS.SESSION_MAIN]: main },
            customJobRef: `${resolved.agentId}/${resolved.jobId}`,
            threadId: params.threadId,
          },
        });
      } catch { /* best-effort */ }
    }

    throw error;
  } finally {
    if (mcp) {
      await mcp.close();
      setUniversalMcp(null);
    }
  }

  console.log('\n✅ Universal job completed');
  console.log(`   Tool calls: ${finalState.toolCalls.length}`);

  return {
    response: finalState.response || '',
    toolCallCount: finalState.toolCalls.length,
    tokenUsage: finalState.tokenUsage,
  };
}
