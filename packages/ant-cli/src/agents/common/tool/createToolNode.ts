/**
 * createToolNode — generic tool node factory
 *
 * Creates a LangGraph node function that:
 * 1. Reads pending tool calls from state
 * 2. Builds a ToolExecutionContext from state
 * 3. Runs ToolOrchestrator.executeBatch()
 * 4. Applies afterExecution/afterBatch hooks (for state side-effects)
 * 5. Builds the conversation history update (user-only pattern)
 * 6. Returns the partial state update
 *
 * "user-only" means the assistant message (containing tool_use blocks) is
 * constructed by the execution node BEFORE routing to tool. This factory
 * only appends the user message (tool_result blocks).
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
  /** Read pending tool calls from state (state.pendingToolCalls). */
  getPendingCalls(state: TState): ToolCall[];

  /**
   * Build ToolExecutionContext from state.
   * Each job maps its state shape to the unified context.
   */
  buildContext(state: TState): ToolExecutionContext;

  /** Pre-configured ToolRegistry (from presets) */
  registry: ToolRegistry;

  /** ToolResultManager instance (for truncation) */
  resultManager: ToolResultManager;

  /**
   * Read the conversation history to append to.
   * Default: state.conversationHistory
   */
  getHistory?(state: TState): any[];

  /** Cache state accessor (for jobs that enable tool result caching) */
  getCache?(state: TState): Record<string, string> | undefined;

  /** Set of cacheable tool names (use CACHEABLE_TOOLS from toolCatalog) */
  cacheableTools?: ReadonlySet<string>;

  /** Tool display names override */
  toolDisplayNames?: Record<string, string>;

  /** Hooks for job-specific side-effect processing */
  hooks?: {
    afterExecution?(state: TState, event: ToolExecutionEvent): void;
    afterBatch?(state: TState, events: ToolExecutionEvent[]): Partial<TState>;
    buildExtraUserContent?(state: TState): any[];
  };

  /**
   * Build the final partial state return from execution results.
   * The factory provides: updatedHistory, executionEvents, updatedCache.
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
        updatedHistory: config.getHistory?.(state) || [],
        executionEvents: [],
      });
    }

    const ctx = config.buildContext(state);

    const batchResult = await orchestrator.executeBatch(ctx, {
      calls,
      cache: config.getCache?.(state),
      workflowUpdate: config.getWorkflowUpdate?.(state),
      httpJobId: config.getHttpJobId?.(state),
      workerId: config.getWorkerId?.(state) ?? 0,
      taskInfo: config.getTaskInfo?.(state),
      recursionCount: config.getRecursionCount?.(state),
      recursionLimit: config.getRecursionLimit?.(state),
      figmaContext: config.getFigmaContext?.(state),
    });

    // Apply per-event hooks
    if (config.hooks?.afterExecution) {
      for (const event of batchResult.events) {
        config.hooks.afterExecution(state, event);
      }
    }

    // Apply batch hook
    let hookUpdates: Partial<TState> | undefined;
    if (config.hooks?.afterBatch) {
      hookUpdates = config.hooks.afterBatch(state, batchResult.events);
    }

    // Build user message: tool_result blocks + optional extra content
    const extraContent = config.hooks?.buildExtraUserContent?.(state) ?? [];
    const baseHistory = config.getHistory?.(state) || [];

    const userContent = [
      ...batchResult.toolResultBlocks,
      ...extraContent,
    ];

    const updatedHistory = [
      ...baseHistory,
      {
        role: 'user' as const,
        content: userContent,
      },
    ];

    return config.buildReturn(state, {
      updatedHistory,
      executionEvents: batchResult.events,
      updatedCache: batchResult.updatedCache,
      hookUpdates,
    });
  };
}
