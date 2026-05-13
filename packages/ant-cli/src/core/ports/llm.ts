/**
 * LLM Port
 * Interface for Large Language Model interactions
 */

import { TaskTokenUsage } from '../types/task';

/**
 * Cacheable content block for Anthropic Prompt Caching
 * 
 * Allows marking specific content blocks for caching (5 min TTL)
 * Use for: system prompts, codebase context, rules, examples
 * Don't cache: user questions, changing state, recent responses
 */
export type TextContentBlock = {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
  };
};

/**
 * Image content block (Multimodal)
 *
 * Notes:
 * - Currently used for Anthropic Messages API (supports image blocks in `content`).
 * - Not cacheable (Anthropic prompt caching applies to text blocks).
 * - Only base64 is supported here to keep transport self-contained.
 */
export type ImageContentBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    data: string; // base64 (no data: prefix)
  };
};

/**
 * Content blocks for LLM messages (non-tool).
 * Used by invoke/invokeWithUsage where tool calling is not involved.
 */
export type CacheableContent = TextContentBlock | ImageContentBlock;

/**
 * Tool use content block — LLM requesting tool execution.
 * Appears in assistant messages within conversation history.
 */
export type ToolUseContentBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
  thoughtSignature?: string;
};

/**
 * Tool result content block — result of executing a tool.
 * Appears in user messages following an assistant tool_use.
 *
 * `content` may include ImageContentBlock for multimodal tool results
 * (e.g. reading an image file for the LLM to analyze).
 */
export type ToolResultContentBlock = {
  type: 'tool_result';
  tool_use_id: string;
  tool_name: string;
  content: CacheableContent[] | string;
  is_error?: boolean;
};

/**
 * Thinking content block — Anthropic extended thinking.
 * Preserved in conversation history so the API accepts thinking
 * on subsequent turns. The signature field is required by the
 * Anthropic API to validate unmodified thinking blocks.
 */
export type ThinkingContentBlock = {
  type: 'thinking';
  thinking: string;
  signature?: string;
};

/**
 * All content block types that can appear in LLM messages.
 * Replaces the previous `any[]` escape hatch in stream() signatures.
 */
export type MessageContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | ThinkingContentBlock;

/**
 * LLM Stream Event Types
 * 
 * Core events:
 * - thinking: LLM reasoning process
 * - text: General LLM response
 * - tool_use: LLM requested tool execution
 * - error: Error occurred
 * - done: Stream complete
 * 
 * UI events (for ChatAPIClient):
 * - file_creating, file_create: File creation
 * - file_editing, file_edit: File editing
 * - file_deleting, file_delete: File deletion
 * - command_running, command_streaming, command: Command execution
 */
export type LLMStreamEventType = 
  // Core LLM events
  | 'thinking'
  | 'text'
  | 'tool_use'
  | 'error'
  | 'done'
  | 'retry'
  | 'usage_partial'  // ✅ In-flight token usage snapshot (Anthropic message_start/delta, Gemini usageMetadata chunks). Overwrite-only; not yet finalized.
  // UI events (for file operations, commands)
  | 'file_creating'
  | 'file_create'
  | 'file_create_failed'
  | 'file_editing'
  | 'file_edit'
  | 'file_edit_failed'
  | 'file_deleting'
  | 'file_delete'
  | 'file_delete_failed'
  | 'command_running'
  | 'command_streaming'
  | 'command';

/**
 * LLM Stream Event (Unified Delta Format)
 * 
 * Inspired by Cursor/Copilot/OpenAI/Anthropic streaming patterns.
 * Designed for real-time character-by-character rendering.
 */
export interface LLMStreamEvent {
  type: LLMStreamEventType;
  
  // ---- Common fields ----
  id?: string;                // Chunk/block ID (optional)
  index?: number;             // Content block index (for ordering)
  
  // ---- Content (명확하게 분리) ----
  thinking?: string;          // Reasoning/chain-of-thought delta (type === 'thinking')
  signature?: string;         // Thinking block signature (Anthropic API requirement for multi-turn)
  text?: string;              // Visible text delta (type === 'text')
  
  // ---- Tool call ----
  toolUse?: {
    id: string;               // Unique tool invocation ID
    name: string;             // Tool name (e.g. "read_file", "delete_file", "run_command")
    input: Record<string, any>;  // Tool arguments
    type?: 'function' | 'command';  // Optional classification
    thoughtSignature?: string;  // Gemini 3 thought signature (must be preserved in tool loop)
  };
  
  // ---- Error ----
  error?: {
    code?: string;            // Error code (e.g. "rate_limit_error")
    message: string;          // Human-readable error message
  };
  
  // ---- Done ----
  done?: boolean;             // Stream complete flag (type === 'done')

  // ---- Stop reason (type === 'done') ----
  // Unified across providers. 'max_tokens' is the truncation signal callers
  // gate on; the rest map a provider-specific finish reason to a stable name.
  // Anthropic: end_turn/max_tokens/stop_sequence/tool_use/pause_turn/refusal.
  // OpenAI:    stop/length/tool_calls/content_filter/function_call → length=max_tokens.
  // Gemini:    STOP/MAX_TOKENS/SAFETY/RECITATION/OTHER/... → MAX_TOKENS=max_tokens.
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'other';

  // ---- Usage ----
  usage?: TaskTokenUsage;
  
  // ---- Metadata ----
  metadata?: {
    model?: string;           // Model name (e.g. "claude-3-5-sonnet")
    provider?: string;        // Provider name (e.g. "anthropic", "openai")
    timestamp?: string;       // ISO 8601 timestamp
    blockStart?: boolean;     // Marks block opening (e.g. thinking block start)
    blockEnd?: boolean;       // ✅ Marks block ending (e.g. thinking block end)
    placeholder?: boolean;    // Mark as placeholder for replacement
    durationMs?: number;      // ✅ Duration in milliseconds (for thinking/tasks)
    thinkingDuration?: number;  // Alias for durationMs (thinking blocks)
  };
}

/**
 * Tool definition for LLM function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      /**
       * JSON-schema `enum` constraint. Used by tools whose argument is a
       * closed vocabulary — e.g. `run_command.verifies` (gate vocabulary
       * derived from `tasks/_shared/verify/gates.GATE_ORDER`),
       * `discovery_tool.scope`, etc. Optional; non-enum properties omit it.
       */
      enum?: readonly string[];
      /** JSON-schema `items` for array properties (e.g. clarify options). */
      items?: { type: string; description?: string };
    }>;
    required?: string[];
  };
}

/**
 * LLM invocation result with token usage
 */
export interface LLMInvokeResult {
  content: string;
  usage?: TaskTokenUsage;
}

export interface LLMClient {
  readonly provider: string;
  readonly modelName: string;

  invoke(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<string>;
  
  /**
   * Invoke with token usage tracking
   * Returns both content and token usage information
   * 
   * ✅ Supports Prompt Caching via CacheableContent[]
   */
  invokeWithUsage?(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<LLMInvokeResult>;
  
  /**
   * Unified streaming interface.
   *
   * Handles thinking blocks, tool calling, text generation, and prompt caching.
   * Content accepts MessageContentBlock[] for tool-loop conversation history
   * (tool_use, tool_result, thinking blocks) alongside CacheableContent[].
   *
   * Recognised options (provider-agnostic; adapters that ignore them are
   * still spec-compliant):
   *   - `tools`           → tool-use definitions
   *   - `maxTokens`       → output cap
   *   - `enableThinking`  → request extended thinking (provider-dependent)
   *   - `thinkingBudget`  → token budget for the thinking block
   *   - `stopSequences`   → hard-stop strings; generation terminates the
   *                          moment any of these appears in the model's
   *                          text output. Used to cut wasted tokens after
   *                          a structural tag (e.g. `</plan>`, `</detect>`).
   */
  stream(
    messages: Array<{ role: string; content: string | MessageContentBlock[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      stopSequences?: string[];
      [key: string]: any;
    }
  ): AsyncIterable<LLMStreamEvent>;
  
  /**
   * Invoke with structured output (JSON schema enforcement)
   * Forces LLM to return valid JSON matching the schema
   * 
   * @param messages - Chat messages (supports prompt caching)
   * @param schema - JSON schema for the expected output
   * @param schemaName - Name of the schema (for tool calling)
   * @returns Parsed object matching the schema
   */
  invokeStructured<T = any>(
    messages: Array<{ role: string; content: string | CacheableContent[] }>,
    schema: Record<string, any>,
    schemaName: string
  ): Promise<T>;
}

