/**
 * Decompose LLM Caller
 * 
 * Handles LLM streaming for task decomposition with XML tag parsing.
 * Supports two modes:
 *   - Inline (no tools): single-turn stream with XML parsing (fast)
 *   - Tool-use (RAG): multi-turn stream with read_design_doc tool (large projects)
 */

import { LLMClient, ToolDefinition } from "../../../../../../core/ports";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../common/graph/llmConfig";
import type { TokenTrackingState } from "../../../../../common/graph/llmHelpers";
import type { ParsedAction } from "../../../../../../core/streaming/types";

interface CallDecomposeOptions {
  tools?: ToolDefinition[];
  toolHandler?: (name: string, args: Record<string, any>) => string | Promise<string>;
  /**
   * Optional graph state. When supplied, any `usage_partial` events surfaced
   * by the LLM adapter will overwrite `state.currentPhaseTokenUsage` so the
   * chat-input token gauge tracks decompose usage live instead of only after
   * the stream completes. Requires the caller to have seeded the snapshot via
   * `beginNodePhase()`.
   */
  state?: TokenTrackingState;

  /**
   * Optional per-task callback invoked once for every `<task>...</task>`
   * element the streaming parser observes mid-stream. The argument is the
   * raw JSON body inside the wrapper. The decompose node uses this to
   * push partial Kanban broadcasts so the todo column fills one task at
   * a time instead of all-at-once at stream end.
   *
   * Both code-job paths forward the callback:
   *   - Inline mode (no tools)         → `StreamOrchestrator.onAction`
   *   - Tool-use mode (RAG, with tools) → `decomposeWithToolLoop.onTaskParsed`
   *
   * Errors thrown by the callback propagate — the decompose retry loop
   * resets accumulated state per attempt.
   */
  onTaskParsed?: (rawJson: string) => void | Promise<void>;
}

/**
 * Call LLM for task decomposition (with streaming for Chat UI)
 * Uses job/node-specific model from workspaceConfig
 *
 * When tools are provided, uses multi-turn tool-use loop via decomposeWithToolLoop.
 * Otherwise, uses single-turn streaming with XML parsing.
 */
export async function callLLMForDecompose(
  llm: LLMClient,
  prompt: string | { system: string; user: string },
  workspaceConfig?: any,
  options?: CallDecomposeOptions,
): Promise<{ response: string; tokenUsage?: any }> {
  console.log('🤖 [Decompose] Calling LLM for task breakdown...');
  
  let llmToUse = llm;
  if (workspaceConfig) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', nodeType: 'decompose' },
      workspaceConfig
    );
  }
  
  const messages = typeof prompt === 'string'
    ? [{ role: 'user' as const, content: prompt }]
    : [
        { role: 'system' as const, content: prompt.system },
        { role: 'user' as const, content: prompt.user },
      ];

  // Tool-use mode: multi-turn loop via shared utility
  if (options?.tools && options.tools.length > 0 && options.toolHandler) {
    console.log(`🔧 [Decompose] Tool-use mode with ${options.tools.length} tool(s)`);
    const { decomposeWithToolLoop } = await import('../../../design/nodes/docGen/sourceSelector');
    const { response, usage } = await decomposeWithToolLoop(
      llmToUse,
      messages,
      options.tools,
      options.toolHandler,
      {
        temperature: LLM_TEMPERATURE.DECOMPOSE,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        enableThinking: true,
        thinkingBudget: LLM_THINKING_BUDGET.DECOMPOSE,
        state: options.state,
        // Forward the per-task hook so partial Kanban broadcasts fire
        // even when decompose runs in tool-use (RAG) mode. Without this
        // forwarding, the todo column would only populate after the
        // entire decompose stream completes — which is precisely the
        // behaviour the streaming feature is designed to replace.
        onTaskParsed: options.onTaskParsed,
      },
    );
    return { response, tokenUsage: usage };
  }

  // Inline mode: single-turn stream with XML parsing
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  // Forward per-task events to the caller-supplied hook. Wrapped here
  // (not in StreamOrchestrator) so the orchestrator stays payload-agnostic
  // and only this node knows about the `task_added` action.
  const onTaskParsedHook = options?.onTaskParsed;
  const onAction = onTaskParsedHook
    ? async (action: ParsedAction) => {
        if (action.type === 'task_added' && action.data.rawJson) {
          await onTaskParsedHook(action.data.rawJson);
        }
      }
    : undefined;

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined),
    existingFiles: new Set(),
    onAction,
  });
  
  let response = '';
  let capturedUsage: any = undefined;
  
  const { extractTokenUsageFromStreamEvent, maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } = await import('../../../../../common/graph/llmHelpers');

  // T1 pre-call estimate per tool-loop iteration.
  if (options?.state) {
    applyEstimatedInputTokensFromMessages(options.state, messages);
  }

  for await (const event of llmToUse.stream(messages, {
    temperature: LLM_TEMPERATURE.DECOMPOSE,
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: true,
    thinkingBudget: LLM_THINKING_BUDGET.DECOMPOSE,
  })) {
    if (event.type === 'retry') {
      console.log('🔄 [Decompose] Stream retry detected, resetting accumulated state');
      response = '';
      capturedUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined),
        existingFiles: new Set(),
        onAction,
      });
      continue;
    }

    if (options?.state) {
      maybeUpdatePhaseTokenUsage(options.state, event);
    }

    await orchestrator.processEvent(event);
    
    if (event.text) {
      response += event.text;
    }
    
    const usage = extractTokenUsageFromStreamEvent(event);
    if (usage) {
      capturedUsage = usage;
    }
  }
  
  await orchestrator.finalize();
  
  return { response, tokenUsage: capturedUsage };
}
