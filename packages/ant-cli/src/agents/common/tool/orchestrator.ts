/**
 * ToolOrchestrator — batch tool execution with caching, truncation, and UI
 *
 * Responsibilities:
 * - Sequential execution of tool calls from a single LLM response
 * - Cache check/update for read-only tools
 * - ToolResultManager truncation
 * - ChatStatus UI notifications
 * - workflowUpdate enter/exit instrumentation
 *
 * Does NOT own state or conversation history — returns results for the
 * calling node to merge into graph state.
 */

import type { ToolRegistry } from './registry';
import type {
  ToolExecutionContext,
  ToolCall,
  ToolExecutionEvent,
  BatchExecutionResult,
  ToolResult,
} from './types';
import type { ToolResultManager, FigmaContext } from '../../../core/utils/toolResultManager';
import { buildToolResultMessage } from './messageBuilder';
import { ToolName, TOOL_DISPLAY_NAMES } from './toolCatalog';

export interface OrchestratorConfig {
  registry: ToolRegistry;
  resultManager: ToolResultManager;
  cacheEnabled?: boolean;
  cacheableTools?: ReadonlySet<ToolName | string>;
  toolDisplayNames?: Record<string, string>;
}

export interface WorkflowUpdate {
  enterNode(jobId: string, nodeName: string, workerId: number, taskInfo?: any, extra?: any, recursionCount?: number, recursionLimit?: number): Promise<void>;
  exitNode(jobId: string, nodeName: string, workerId: number): Promise<void>;
}

export interface OrchestratorBatchOptions {
  calls: ToolCall[];
  cache?: Record<string, string>;
  workflowUpdate?: WorkflowUpdate;
  httpJobId?: string;
  workerId?: number;
  taskInfo?: any;
  recursionCount?: number;
  recursionLimit?: number;
  figmaContext?: FigmaContext;
  uiCardAnimationDelay?: number;
}

// Display names come from TOOL_DISPLAY_NAMES in toolCatalog.ts (single source of truth)

export class ToolOrchestrator {
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async executeBatch(
    ctx: ToolExecutionContext,
    opts: OrchestratorBatchOptions,
  ): Promise<BatchExecutionResult> {
    const {
      calls,
      cache,
      workflowUpdate,
      httpJobId,
      workerId = 0,
      taskInfo,
      recursionCount,
      recursionLimit,
      figmaContext,
      uiCardAnimationDelay = 150,
    } = opts;

    const displayNames = this.config.toolDisplayNames || (TOOL_DISPLAY_NAMES as Record<string, string>);

    // Workflow: enter once per batch
    if (workflowUpdate && httpJobId) {
      await workflowUpdate.enterNode(httpJobId, 'tool', workerId, taskInfo, undefined, recursionCount, recursionLimit);
    }

    const events: ToolExecutionEvent[] = [];
    const updatedCache: Record<string, string> = cache ? { ...cache } : {};

    console.log(`🔧 [Tool] Executing ${calls.length} tool call(s)`);

    for (const tc of calls) {
      const { id, name, args } = tc;
      console.log(`🔧 [Tool] ${name}`);

      // Cache check
      if (this.config.cacheEnabled && this.config.cacheableTools?.has(name) && cache) {
        const cacheKey = `${name}:${JSON.stringify(args)}`;
        const cached = cache[cacheKey];
        if (cached !== undefined) {
          console.log(`♻️  [Tool] Cache hit: ${name}(${JSON.stringify(args).substring(0, 80)})`);
          events.push({
            toolCallId: id,
            toolName: name,
            args,
            result: { content: `[Cached result — same as previous call]\n\n${cached}` },
            cached: true,
          });
          continue;
        }
      }

      // UI status
      const toolDisplayName = displayNames[name] || `🔧 ${name}`;
      await ctx.chatStatus.showStatus('placeholder', { content: toolDisplayName });

      // UI animation delay for delete_file
      if (name === ToolName.DELETE_FILE && uiCardAnimationDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, uiCardAnimationDelay));
      }

      // Execute handler
      const handler = this.config.registry.get(name);
      if (!handler) {
        console.error(`❌ [Tool] Unknown tool: ${name}`);
        events.push({
          toolCallId: id,
          toolName: name,
          args,
          result: { content: `Error: Unknown tool "${name}"`, error: `Unknown tool: ${name}` },
          cached: false,
        });
        continue;
      }

      let result: ToolResult;
      try {
        result = await handler(ctx, args);
      } catch (e) {
        // Re-throw rate limit errors
        const { isFigmaRateLimitError } = await import('../../../periphery/adapters/figma/errors');
        if (isFigmaRateLimitError(e as Error)) throw e;

        const errorMsg = (e as Error).message;
        console.error(`❌ [Tool] ${name} execution failed:`, errorMsg);
        result = { content: `Error: ${errorMsg}`, error: errorMsg };
      }

      // Truncation
      const truncatedResult = this.truncateResult(name, result, args, figmaContext);

      // Update cache
      if (this.config.cacheEnabled && this.config.cacheableTools?.has(name) && !result.error) {
        const cacheKey = `${name}:${JSON.stringify(args)}`;
        if (typeof truncatedResult.content === 'string') {
          updatedCache[cacheKey] = truncatedResult.content;
        }
      }

      console.log(`✅ [Tool] ${name} executed successfully`);

      events.push({
        toolCallId: id,
        toolName: name,
        args,
        result: truncatedResult,
        cached: false,
      });
    }

    // Flush chat once per batch
    await ctx.chatStatus.flush();

    // Workflow: exit once per batch
    if (workflowUpdate && httpJobId) {
      await workflowUpdate.exitNode(httpJobId, 'tool', workerId);
    }

    // Build message blocks
    const { toolUseBlocks, toolResultBlocks } = buildToolResultMessage(events);

    return {
      events,
      toolResultBlocks,
      updatedCache: this.config.cacheEnabled ? updatedCache : undefined,
    };
  }

  private truncateResult(
    name: string,
    result: ToolResult,
    args: Record<string, any>,
    figmaContext?: FigmaContext,
  ): ToolResult {
    // Skip truncation for multimodal (array) content
    if (Array.isArray(result.content)) {
      // For composite Figma results, truncate only the text part
      if (result.content.length === 2 && result.content[0]?.type === 'image' && result.content[1]?.type === 'text') {
        const textContent = result.content[1].text;
        const truncation = this.config.resultManager.truncateResult(name, textContent, result.error);
        if (truncation.wasTruncated) {
          console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
          return {
            ...result,
            content: [
              result.content[0],
              { type: 'text', text: typeof truncation.content === 'string' ? truncation.content : JSON.stringify(truncation.content) },
            ],
          };
        }
      }
      return result;
    }

    const filePath = name === ToolName.READ_FILE ? args.path : undefined;
    const truncation = this.config.resultManager.truncateResult(
      name,
      result.content,
      result.error,
      filePath,
      figmaContext,
    );

    if (truncation.wasTruncated) {
      console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    }

    return { ...result, content: truncation.content };
  }
}
