/**
 * createToolNode — generic tool node factory
 *
 * Creates a LangGraph node function that:
 * 1. Reads pending tool calls from state
 * 2. Builds a ToolExecutionContext from state
 * 3. Runs ToolOrchestrator.executeBatch()
 * 4. Applies afterExecution/afterBatch hooks (for state side-effects)
 * 5. Appends user(tool_result) to conversation history
 * 6. Calls onComplete hook for async I/O (session saves, etc.)
 * 7. Returns the partial state update via buildReturn
 *
 * NOTE: recursionCount increment is the caller's responsibility
 * (via buildReturn), not this factory's.
 *
 * Assistant message is the LLM node's responsibility (via buildAssistantMessage).
 * This factory only appends user(tool_result) — the tool execution results.
 * The user message contains tool_result blocks (+ optional extra content
 * via buildExtraUserContent hook).
 */

import type { ToolRegistry } from './registry';
import type {
  ToolExecutionContext,
  ToolCall,
  ToolExecutionEvent,
} from './types';
import type { ToolResultManager, FigmaContext } from '../../../core/utils/toolResultManager';
import { ToolOrchestrator } from './orchestrator';
import type { WorkflowUpdate } from './orchestrator';

export interface ToolNodeConfig<TState> {
  /** Read pending tool calls from state. */
  getPendingCalls(state: TState): ToolCall[];

  /** Build ToolExecutionContext from state. */
  buildContext(state: TState): ToolExecutionContext;

  /**
   * Optional per-call gate. When provided, each pending call is checked before
   * dispatch; a denied call yields an error tool_result instead of executing.
   * RAC-agnostic at this layer — the code tool node binds an RAC-scope policy.
   */
  gateCall?(state: TState, call: ToolCall): { allowed: true } | { allowed: false; error: string };

  /** Pre-configured ToolRegistry (from presets + runtime registrations) */
  registry: ToolRegistry;

  /**
   * ToolResultManager instance (for truncation).
   * Optional for lightweight graphs (Ask/Plan) that don't need truncation.
   * When omitted, orchestrator returns raw content without truncation.
   */
  resultManager?: ToolResultManager;

  /** Read the conversation history to append to. */
  getHistory(state: TState): any[];

  /** Cache state accessor (for jobs that enable tool result caching) */
  getCache?(state: TState): Record<string, string> | undefined;

  /** Set of cacheable tool names (use CACHEABLE_TOOLS from toolCatalog) */
  cacheableTools?: ReadonlySet<string>;

  /** Tool display names override */
  toolDisplayNames?: Record<string, string>;

  hooks?: {
    /** Called after each individual tool execution. For state mutations based on sideEffects. */
    afterExecution?(state: TState, event: ToolExecutionEvent): void;

    /** Called after all tools in the batch. Returns partial state updates. */
    afterBatch?(state: TState, events: ToolExecutionEvent[]): Partial<TState>;

    /**
     * Called after all processing is complete. For async I/O like session saves.
     * Runs after buildReturn — state is the original (pre-return) state.
     * `context.updatedHistory` contains the post-update conversation history.
     */
    onComplete?(state: TState, events: ToolExecutionEvent[], context: { updatedHistory: any[] }): Promise<void>;

    /**
     * Build extra content to append to the user message after tool_result blocks.
     * Useful for task reminders, etc.
     */
    buildExtraUserContent?(state: TState): any[];
  };

  /**
   * Build the final partial state return from execution results.
   * The factory provides: updatedHistory, executionEvents, updatedCache, hookUpdates.
   */
  buildReturn(state: TState, result: {
    updatedHistory: any[];
    executionEvents: ToolExecutionEvent[];
    updatedCache?: Record<string, string>;
    hookUpdates?: Partial<TState>;
  }): Partial<TState>;

  /** Workflow instrumentation accessors */
  getWorkflowUpdate?(state: TState): WorkflowUpdate | undefined;
  getHttpJobId?(state: TState): string | undefined;
  getWorkerId?(state: TState): number;
  getTaskInfo?(state: TState): any;
  getRecursionCount?(state: TState): number | undefined;
  getRecursionLimit?(state: TState): number | undefined;
  getFigmaContext?(state: TState): FigmaContext | undefined;
}

/**
 * Create a LangGraph-compatible tool node function.
 */
export function createToolNode<TState>(
  config: ToolNodeConfig<TState>,
): (state: TState) => Promise<Partial<TState>> {
  const orchestrator = new ToolOrchestrator({
    registry: config.registry,
    resultManager: config.resultManager,
    cacheEnabled: !!config.cacheableTools,
    cacheableTools: config.cacheableTools,
    toolDisplayNames: config.toolDisplayNames,
  });

  return async (state: TState): Promise<Partial<TState>> => {
    const calls = config.getPendingCalls(state);

    if (!calls || calls.length === 0) {
      console.warn('[Tool] No pending tool calls');
      return config.buildReturn(state, {
        updatedHistory: config.getHistory(state),
        executionEvents: [],
      });
    }

    const ctx = config.buildContext(state);

    const batchResult = await orchestrator.executeBatch(ctx, {
      calls,
      gateCall: config.gateCall ? (call) => config.gateCall!(state, call) : undefined,
      cache: config.getCache?.(state),
      workflowUpdate: config.getWorkflowUpdate?.(state),
      httpJobId: config.getHttpJobId?.(state),
      workerId: config.getWorkerId?.(state) ?? 0,
      taskInfo: config.getTaskInfo?.(state),
      recursionCount: config.getRecursionCount?.(state),
      recursionLimit: config.getRecursionLimit?.(state),
      figmaContext: config.getFigmaContext?.(state),
    });

    // Per-event hooks (state mutations from sideEffects)
    if (config.hooks?.afterExecution) {
      for (const event of batchResult.events) {
        config.hooks.afterExecution(state, event);
      }
    }

    // Batch hook (aggregate state updates)
    let hookUpdates: Partial<TState> | undefined;
    if (config.hooks?.afterBatch) {
      hookUpdates = config.hooks.afterBatch(state, batchResult.events);
    }

    // Build user message content: tool_result blocks + optional extras
    const extraContent = config.hooks?.buildExtraUserContent?.(state) ?? [];
    const userContent = [
      ...batchResult.toolResultBlocks,
      ...extraContent,
    ];

    // Append user(tool_result) to history
    const baseHistory = config.getHistory(state);
    const updatedHistory = [
      ...baseHistory,
      { role: 'user' as const, content: userContent },
    ];

    const result = config.buildReturn(state, {
      updatedHistory,
      executionEvents: batchResult.events,
      updatedCache: batchResult.updatedCache,
      hookUpdates,
    });

    // Async I/O hook (session saves, etc.) — runs after buildReturn
    if (config.hooks?.onComplete) {
      try {
        await config.hooks.onComplete(state, batchResult.events, { updatedHistory });
      } catch (err) {
        console.warn('[Tool] onComplete hook failed:', (err as Error).message);
      }
    }

    return result;
  };
}
