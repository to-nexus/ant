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
import { unknownParamNotice } from './toolSchemas';

/**
 * Side effects that mean "the file tree the FE renders has changed".
 *
 * `commandExecuted` / `serverStarted` are in the set because a shell can create
 * or delete anything under the working root; there is deliberately NO
 * command-name allowlist — such a table drifts, and inferring write-ness from a
 * command's shape is exactly the heuristic this codebase avoids. Bursts collapse
 * in the notifier's single-flight, so a broad set costs at most one extra walk.
 *
 * `fileNotChanged` is deliberately absent: nothing the tree renders changed, so
 * the walk it used to trigger was waste.
 */
const TREE_MUTATING_SIDE_EFFECTS: ReadonlySet<string> = new Set([
  'fileCreated',
  'fileModified',
  'fileDeleted',
  'directoryCreated',
  'commandExecuted',
  'serverStarted',
]);

export interface OrchestratorConfig {
  registry: ToolRegistry;
  /** Optional for lightweight graphs that don't need truncation. */
  resultManager?: ToolResultManager;
  cacheEnabled?: boolean;
  cacheableTools?: ReadonlySet<ToolName | string>;
  toolDisplayNames?: Record<string, string>;
}

export interface WorkflowUpdate {
  enterNode(jobId: string, nodeName: string, workerId: number, taskInfo?: any, extra?: any, recursionCount?: number, recursionLimit?: number): Promise<void>;
  exitNode(jobId: string, nodeName: string, workerId: number): void | Promise<void>;
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
  /**
   * Optional per-call gate, evaluated before cache lookup and handler
   * dispatch. When it denies a call, the orchestrator emits an error
   * tool_result for that call (preserving tool_use/tool_result pairing) and
   * skips execution. RAC-agnostic by design — the caller supplies whatever
   * policy it wants (the code tool node binds an RAC-scope check here).
   *
   * `notice` opts a rejection into user-visible surfacing: only a denial a
   * person must act on (an approval-gated call, not model steering like a
   * plan-turn or allowlist refusal) should carry one.
   */
  gateCall?(call: ToolCall): { allowed: true } | { allowed: false; error: string; notice?: GateRejectionNotice };
}

/**
 * Persistent chat surfacing for a gate rejection the user must resolve.
 * Rendered as a `tool_action` chat card in addition to the error tool_result
 * the model receives — without it a denial is invisible outside the LLM's
 * own narration. `agentId` + `definitionPath` add a deep link into the
 * agent-definition settings screen.
 */
export interface GateRejectionNotice {
  content: string;
  icon?: string;
  agentId?: string;
  definitionPath?: string;
}

// Display names come from TOOL_DISPLAY_NAMES in toolCatalog.ts (single source of truth)

/**
 * Prefix prepended to a cache-hit tool result. Exported so duplicate-read
 * elision can normalize it away when comparing a cached re-read against the
 * preserved prior read (the bodies are identical; only this prefix differs).
 */
export const CACHED_RESULT_PREFIX = '[Cached result — same as previous call]\n\n';

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

    // Handlers may only redirect the model to tools that are actually
    // dispatchable in this batch's registry.
    ctx.availableToolNames = new Set(this.config.registry.names());

    console.log(`🔧 [Tool] Executing ${calls.length} tool call(s)`);

    for (const tc of calls) {
      const { id, name, args } = tc;
      console.log(`🔧 [Tool] ${name}`);

      // Per-call gate (RAC-agnostic). Denied calls get an error tool_result so
      // the tool_use/tool_result pairing the LLM expects stays intact.
      if (opts.gateCall) {
        const gate = opts.gateCall(tc);
        if (!gate.allowed) {
          console.warn(`🚫 [Tool] ${name} blocked: ${gate.error}`);
          if (gate.notice) {
            try {
              await ctx.chatStatus.showStatus('tool_action', {
                actionIcon: gate.notice.icon ?? '🚫',
                content: gate.notice.content,
                ...(gate.notice.agentId && { agentId: gate.notice.agentId }),
                ...(gate.notice.definitionPath && { definitionPath: gate.notice.definitionPath }),
              });
            } catch (e) {
              console.warn(`⚠️ [Tool] gate notice emit failed for ${name}:`, (e as Error)?.message);
            }
          }
          // Settle the streaming file card the arg-streamer may have opened
          // for this call — skipping the handler otherwise strands it as
          // `file_creating`/`file_editing`, which pins the FE's virtual
          // editor tab in `streaming` until the job-terminal buffer sweep.
          const deniedPath = typeof (args as { path?: unknown })?.path === 'string'
            ? (args as { path: string }).path
            : undefined;
          if (deniedPath && (name === 'create_file' || name === 'append_file' || name === 'edit_file')) {
            try {
              if (name === 'edit_file') await ctx.chatStatus.failFileEdit(deniedPath, gate.error);
              else await ctx.chatStatus.failFileCreation(deniedPath, gate.error);
            } catch (e) {
              console.warn(`⚠️ [Tool] gate-denied card settle failed for ${name}:`, (e as Error)?.message);
            }
          }
          events.push({
            toolCallId: id,
            toolName: name,
            args,
            result: { content: `Error: ${gate.error}`, error: gate.error },
            cached: false,
          });
          continue;
        }
      }

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
            result: { content: `${CACHED_RESULT_PREFIX}${cached}` },
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
      ctx.currentToolCallId = id;
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
      let truncatedResult = this.truncateResult(name, result, args, figmaContext);

      // Unschema'd params are silently invisible to handlers — surface them
      // AFTER truncation (so the notice survives) and BEFORE the cache write
      // (so a replay of the same bad args carries it too).
      const paramNotice = unknownParamNotice(name, args);
      if (paramNotice && typeof truncatedResult.content === 'string') {
        truncatedResult = { ...truncatedResult, content: truncatedResult.content + paramNotice };
      }

      // Update cache
      if (this.config.cacheEnabled && this.config.cacheableTools?.has(name) && !result.error) {
        const cacheKey = `${name}:${JSON.stringify(args)}`;
        if (typeof truncatedResult.content === 'string') {
          updatedCache[cacheKey] = truncatedResult.content;
        }
      }

      // Log success/failure based on the actual result.error field. Handlers
      // convert runtime errors (e.g. ENOENT on a missing native binary) into
      // ToolResult with `error` set and a user-facing message in `content`;
      // logging "successfully" for these cases hid critical failures such as
      // ripgrep postinstall skip (see `searchCode` ENOENT handling).
      if (truncatedResult.error) {
        console.warn(
          `⚠️  [Tool] ${name} returned error: ${truncatedResult.error.substring(0, 200)}`,
        );
      } else {
        console.log(`✅ [Tool] ${name} executed successfully`);
      }

      // Single owner of "a tool mutated the tree → refresh the FE". Per-call
      // rather than per-batch so a batch containing a slow run_command still
      // surfaces its earlier create_file immediately.
      if (!truncatedResult.error) {
        this.notifyIfTreeMutated(ctx, truncatedResult);
      }

      events.push({
        toolCallId: id,
        toolName: name,
        args,
        result: truncatedResult,
        cached: false,
      });
    }

    // Workflow: exit once per batch
    if (workflowUpdate && httpJobId) {
      await workflowUpdate.exitNode(httpJobId, 'tool', workerId);
    }

    // Build message blocks
    const { toolUseBlocks, toolResultBlocks } = buildToolResultMessage(events);

    return {
      events,
      toolUseBlocks,
      toolResultBlocks,
      updatedCache: this.config.cacheEnabled ? updatedCache : undefined,
    };
  }

  /**
   * Refresh the FE file tree when a tool reported a tree-mutating side effect.
   *
   * This is the ONE place that calls `notifyFileTreeUpdate` for tool writes.
   * It used to be five hand-copied blocks in the file handlers, which left
   * `mkdir` and `run_command` silent — an agent that created a directory (or
   * wrote via the shell) produced no event at all, so a workspace project's
   * output only appeared after a browser refresh. Handlers now report WHAT
   * happened via `sideEffects` and this decides whether the tree changed.
   *
   * The gate is the same one the handlers used: a notifier plus a
   * project/feature pair to address it to.
   */
  private notifyIfTreeMutated(ctx: ToolExecutionContext, result: ToolResult): void {
    if (!ctx.fileTreeUpdate || !ctx.project || !ctx.featureFolder) return;
    const mutated = result.sideEffects?.some(e => TREE_MUTATING_SIDE_EFFECTS.has(e.type));
    if (!mutated) return;
    // NOT awaited, and that is what makes the coalescing work: tool calls in a
    // batch run sequentially, so awaiting each notify would let every walk
    // finish before the next one starts — N writes, N walks, all on the agent's
    // critical path. Firing and forgetting lets calls 2..N join the walk started
    // by call 1 (KeyedSingleFlight), collapsing the batch to ≤2 walks.
    //
    // Nothing is lost at shutdown: the broadcaster registers every run
    // (initial AND coalesced rerun) with its InflightTracker, and `close()`
    // flushes before `pubRedis.quit()`. Registration happens synchronously
    // inside `run()`, so the job cannot end between this call and the tracking.
    void ctx.fileTreeUpdate.notifyFileTreeUpdate(ctx.project, ctx.featureFolder)
      .catch((e: Error) => {
        // A broadcast failure must never fail the tool call that succeeded.
        console.warn(`⚠️  [Tool] fileTree notify failed:`, e.message);
      });
  }

  private truncateResult(
    name: string,
    result: ToolResult,
    args: Record<string, any>,
    figmaContext?: FigmaContext,
  ): ToolResult {
    // No resultManager → passthrough (lightweight graphs skip truncation)
    if (!this.config.resultManager) return result;

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
