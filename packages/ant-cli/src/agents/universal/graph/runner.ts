/**
 * Universal Graph Runner
 *
 * Entry point for the universal job. Lifecycle:
 *   1. Restore the (agent, job) session (conversation = the job's only memory).
 *   2. Append the new user turn to session:main.
 *   3. Connect MCP servers declared by the active definition; build registry.
 *   4. invokeGraph with the recursion backstop.
 *   5. Session persistence happens in respond; on failure the runner makes a
 *      best-effort save so the turn's conversation is not lost.
 */

import { UNIVERSAL_FEATURE } from '@ant/shared';
import { buildUniversalGraph } from './graph';
import { createInitialUniversalState, parseSealedTurnContext, type InheritedTurnContext, type UniversalGraphState } from './state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../common/graph/conversations';
import { sealUniversalConversation } from './session/sealConversation';
import { loadRecursionLimit, isRecursionLimitError, invokeGraph } from '../../common/graph/runnerHelpers';
import { getChatAPIClient } from '../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../core/customAgents/activeCustomJob';
import { findDanglingClarifyToolUse, buildClarifyToolResultTurn } from '../../common/clarify/toolResume';
import { parseSealedHookLedger, type StopHookCheck, type StopHookLedger } from '../../../core/customAgents/stopHooks';
import { McpConnectionManager } from '../../../core/customAgents/McpConnectionManager';
import { McpConfigError, isMcpConfigError } from '../../../core/customAgents/McpConfigError';
import { buildUniversalRegistry, setUniversalMcp } from './runtime';

export interface UniversalRunnerParams {
  /** The user's message for this run (overrideDirective / input). */
  input: string;
  language: 'ko' | 'en';
  containerPath: string;
  projectId: string;
  isResume?: boolean;
  /** Explicit `@intent:` mentions (validated at accept) — this run only. */
  explicitIntents?: string[];
  /** Explicit `@ctx:` artifact paths (checked at accept) — this run only. */
  explicitContext?: string[];
  /** `@plan` per-turn plan-mode request — this run only. */
  planRequested?: boolean;
  deps: {
    llm: any;
    session?: any;
    promptBuilder?: import('../../../core/prompt/builder/PromptBuilder').PromptBuilder;
    fileSystem?: import('../../../core/ports/filesystem').FileSystemPort;
    command?: import('../../../core/ports/command').CommandPort;
    kanbanUpdate?: any;
    workflowUpdate?: any;
    fileTreeUpdate?: any;
    /** Required when the definition declares `mcp.servers` — store-only key resolution. */
    mcpCredentialResolver?: import('../../../core/customAgents/McpCredentialResolver').McpCredentialResolver;
  };
  _httpJobId?: string;
}

export interface UniversalRunnerResult {
  response: string;
  toolCallCount: number;
  tokenUsage?: import('@ant/shared').TaskTokenUsage;
  /**
   * Stop hooks still unmet after the bounce budget — the turn sealed a
   * resumable pause; job-runner publishes it as a `universal_stop_hook_unmet`
   * interruption instead of a clean success (plan_no_output precedent:
   * result-carried, never a throw).
   */
  hooksUnmet?: StopHookCheck[];
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

  // ── Session restore: the (agent, job) conversation persists across runs.
  let restoredConversations: Record<string, ConversationMessage[]> | undefined;
  let restoredTokenUsage: any;
  let restoredTokenUsageByModel: any;
  let restoredChecklist: import('@ant/shared').UniversalChecklist | undefined;
  let restoredClarifyRounds: number | undefined;
  let restoredClarifyContext: InheritedTurnContext | undefined;
  let restoredHookLedger: StopHookLedger | undefined;
  let restoredHookContext: InheritedTurnContext | undefined;
  let sealedAwaitingStopHooks = false;
  if (params.deps.session) {
    try {
      const session = await params.deps.session.load(params.projectId, UNIVERSAL_FEATURE, resolved.jobId);
      const sessionState = session?.state;
      if (sessionState?.conversations?.[CONV_KEYS.SESSION_MAIN]?.length) {
        restoredConversations = { [CONV_KEYS.SESSION_MAIN]: sessionState.conversations[CONV_KEYS.SESSION_MAIN] };
        restoredTokenUsage = sessionState.tokenUsage;
        restoredTokenUsageByModel = sessionState.tokenUsageByModel;
        if (Array.isArray(sessionState.checklist?.items) && sessionState.checklist.items.length > 0) {
          restoredChecklist = sessionState.checklist;
        }
        if (typeof sessionState.clarifyRoundsUsed === 'number' && sessionState.clarifyRoundsUsed > 0) {
          restoredClarifyRounds = sessionState.clarifyRoundsUsed;
        }
        restoredClarifyContext = parseSealedTurnContext(sessionState.clarifyTurnContext);
        // Stop-hook continuity — the ledger (hooks already met on a prior
        // turn of the paused sequence) rides both pause seals; the turn
        // context rides only the stop-hook pause (clarify has its own slot).
        restoredHookLedger = parseSealedHookLedger(sessionState.hookLedger);
        sealedAwaitingStopHooks = sessionState.awaitingStopHooks === true;
        if (sealedAwaitingStopHooks) {
          restoredHookContext = parseSealedTurnContext(sessionState.hookTurnContext);
        }
        console.log(`♻️ [Universal] Restored ${restoredConversations[CONV_KEYS.SESSION_MAIN].length} conversation turns`);
      }
    } catch (e) {
      console.warn('⚠️ [Universal] Session restore failed (fresh session):', e instanceof Error ? e.message : String(e));
    }
  }

  // ── Append the new user turn (runner owns turn admission, nodes only read).
  // A sealed dangling clarify `tool_use` (end-and-resume pause) is closed by
  // injecting the input as that call's tool_result — WHATEVER the content:
  // card answer, partial answer, or unrelated message. Detection is
  // structural; the seal marker is advisory only. Injection precedes
  // compaction (the pair rides the hot tail in the agent node).
  const conversations = restoredConversations ?? {};
  const main = [...(conversations[CONV_KEYS.SESSION_MAIN] ?? [])];
  // Clarify continuity applies ONLY when this run structurally closes the
  // dangling call — the sealed context is advisory, like the seal markers.
  const dangling = findDanglingClarifyToolUse(main);
  let inheritedTurnContext: InheritedTurnContext | undefined;
  if (params.input && params.input.trim().length > 0) {
    if (dangling) {
      console.log(`🙋 [Universal] Clarify answered — closing tool_use ${dangling.toolUseId}`);
      main.push(buildClarifyToolResultTurn(dangling.toolUseId, params.input) as ConversationMessage);
      inheritedTurnContext = restoredClarifyContext;
    } else {
      // Turn-opening stamp: a stable identity for read_state scope='history'.
      // Adapter wire mapping rebuilds {role, content} only, so the stamp never
      // reaches the LLM (prompt-cache safe); legacy unstamped turns fall back
      // to synthesized indices in the history projection.
      main.push({
        role: 'user',
        content: params.input,
        timestamp: new Date().toISOString(),
        metadata: params._httpJobId ? { jobId: params._httpJobId } : undefined,
      });
    }
  } else if (main.length === 0) {
    throw new Error('[Universal] Empty input on a fresh session — nothing to do');
  } else if (dangling) {
    // Empty-input run on a restored session: still close a dangling clarify
    // tool_use — transcript validity is the invariant, whatever the content.
    // The defaults-run inherits too: plan confinement and pinned intents
    // must not silently drop on a no-reply closure.
    console.warn(`⚠️ [Universal] Empty input on a clarify-awaiting session — closing tool_use ${dangling.toolUseId} with a no-reply note`);
    main.push(buildClarifyToolResultTurn(dangling.toolUseId, '(no reply — proceed with sensible defaults and state the assumption)') as ConversationMessage);
    inheritedTurnContext = restoredClarifyContext;
  }
  // Stop-hook pause continuity — no dangling tool_use to key on (the pause
  // is a plain sealed turn), so the seal marker itself gates: the next run
  // re-arms the same intents and the gate re-loads (fresh bounce budget).
  // Explicit `@intent:` mentions still outrank this in buildTurnContext.
  if (!inheritedTurnContext && restoredHookContext) {
    inheritedTurnContext = restoredHookContext;
  }
  // The ledger is adopted only alongside a pause continuation (a clarify
  // closure or a stop-hook pause seal) — never from a normal seal, which
  // omits it (self-clear: a fresh request is a fresh contract).
  const adoptedHookLedger = dangling || sealedAwaitingStopHooks ? restoredHookLedger : undefined;
  conversations[CONV_KEYS.SESSION_MAIN] = main;

  // ── MCP connect (fail-loud: the definition declared these servers).
  // Every connect failure — unregistered credential key, unreachable server,
  // timeout, handshake error — crosses this single boundary as McpConfigError
  // so job-runner classifies it as config_invalid, never process_crash.
  let mcp: McpConnectionManager | null = null;
  if (Object.keys(resolved.mcpServers).length > 0 || Object.keys(resolved.apiServers).length > 0) {
    const resolver = params.deps.mcpCredentialResolver;
    if (!resolver) {
      throw new McpConfigError(
        `Definition ${resolved.agentId}/${resolved.jobId} declares mcp.servers/apis but no credential resolver was wired`,
      );
    }
    mcp = new McpConnectionManager(resolved.mcpServers, resolver, resolved.apiServers);
    try {
      await mcp.connect();
    } catch (e) {
      await mcp.close().catch(() => {});
      if (isMcpConfigError(e)) throw e;
      throw new McpConfigError(
        `MCP server connect failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }
  setUniversalMcp(mcp);
  buildUniversalRegistry(mcp);

  const recursionLimit = loadRecursionLimit('universal', 100);

  // ── Kanban plane seeding (visual runner precedent): job timing + an empty
  // task-queue snapshot so the FE board/recursion gauge binds to this job.
  const kanbanUpdate = params.deps.kanbanUpdate;
  if (params._httpJobId && kanbanUpdate?.setJobTiming) {
    const { JobTimingManager } = await import('../../common/graph/timing/JobTimingManager');
    const { jobTiming } = JobTimingManager.initializeNewJob(params._httpJobId);
    kanbanUpdate.setJobTiming(jobTiming);
    kanbanUpdate.updateTaskQueue?.(params._httpJobId, null, [], [], 0, recursionLimit);
    // Rehydrate the Checklist board from the sealed session (continuation turns).
    if (restoredChecklist) {
      kanbanUpdate.updateUniversalChecklist?.(restoredChecklist);
    }
  }

  const initialState = createInitialUniversalState({
    userMessage: params.input,
    language: params.language,
    containerPath: params.containerPath,
    projectId: params.projectId,
    deps: { ...params.deps, promptBuilder },
    _httpJobId: params._httpJobId,
    isResume: params.isResume,
    conversations,
    recursionLimit,
    restoredChecklist,
    clarifyRoundsUsed: restoredClarifyRounds,
    explicitIntents: params.explicitIntents,
    explicitContext: params.explicitContext,
    planRequested: params.planRequested,
    inheritedTurnContext,
    restoredHookLedger: adoptedHookLedger,
  });
  if (restoredTokenUsage) (initialState as any).tokenUsage = restoredTokenUsage;
  if (restoredTokenUsageByModel) (initialState as any).tokenUsageByModel = restoredTokenUsageByModel;

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
        // NOTE: this save can never contain a dangling clarify tool_use —
        // `main` is the pre-graph history; only respond's seal persists one.
        await params.deps.session.updateArtifacts(params.projectId, UNIVERSAL_FEATURE, resolved.jobId, {
          state: {
            conversations: { [CONV_KEYS.SESSION_MAIN]: sealUniversalConversation(main) },
            customJobRef: `${resolved.agentId}/${resolved.jobId}`,
            ...(restoredClarifyRounds !== undefined && { clarifyRoundsUsed: restoredClarifyRounds }),
          },
        });
      } catch (e) {
        if ((e as any)?.code === 'SESSION_WRITE_TOO_LARGE') {
          console.error('🚨 [Universal] Error-path session save REFUSED — over the write budget:', (e as Error).message);
        }
        /* best-effort otherwise */
      }
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

  // ── Final token/credit broadcast. Per-model breakdown must land BEFORE
  // the aggregate updateTaskQueue snapshot — updateTokenUsageByModel is the
  // meterCredits entry and finalizeTerminalJob settles from the Redis kanban
  // snapshot's tokenUsageByModel (empty map = no-usage settle branch).
  if (params._httpJobId && kanbanUpdate) {
    if ((finalState as any).tokenUsageByModel && kanbanUpdate.updateTokenUsageByModel) {
      kanbanUpdate.updateTokenUsageByModel((finalState as any).tokenUsageByModel);
    }
    if (finalState.tokenUsage && kanbanUpdate.updateTokenUsage) {
      kanbanUpdate.updateTokenUsage(finalState.tokenUsage as any);
    }
    if (finalState.phaseTokenUsages && kanbanUpdate.updatePhaseTokenUsages) {
      kanbanUpdate.updatePhaseTokenUsages(finalState.phaseTokenUsages as any);
    }
    kanbanUpdate.updateTaskQueue?.(
      params._httpJobId, null, [], [],
      finalState.recursionCount ?? 0, recursionLimit, finalState.tokenUsage,
    );
  }

  return {
    response: finalState.response || '',
    toolCallCount: finalState.toolCalls.length,
    tokenUsage: finalState.tokenUsage,
    ...(finalState._hooksUnmet?.length ? { hooksUnmet: finalState._hooksUnmet } : {}),
  };
}
