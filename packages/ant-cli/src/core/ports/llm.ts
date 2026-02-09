/**
 * LLM Port
 * Interface for Large Language Model interactions
 */

import { TaskTokenUsage } from '../../agents/architect/types/task';

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
 * Content blocks for LLM messages.
 * Historically this was text-only for Anthropic prompt caching.
 * Now expanded to support multimodal image blocks.
 */
export type CacheableContent = TextContentBlock | ImageContentBlock;

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
  text?: string;              // Visible text delta (type === 'text')
  
  // ---- Tool call ----
  toolUse?: {
    id: string;               // Unique tool invocation ID
    name: string;             // Tool name (e.g. "read_file", "delete_file", "run_command")
    input: Record<string, any>;  // Tool arguments
    type?: 'function' | 'command';  // Optional classification
  };
  
  // ---- Error ----
  error?: {
    code?: string;            // Error code (e.g. "rate_limit_error")
    message: string;          // Human-readable error message
  };
  
  // ---- Done ----
  done?: boolean;             // Stream complete flag (type === 'done')
  
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
  invoke(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<string>;
  
  /**
   * Invoke with token usage tracking
   * Returns both content and token usage information
   * 
   * ✅ Supports Prompt Caching via CacheableContent[]
   */
  invokeWithUsage?(messages: Array<{ role: string; content: string | CacheableContent[] }>, options?: Record<string, any>): Promise<LLMInvokeResult>;
  
  /**
   * 🎯 Unified streaming interface
   * 
   * Single stream method that handles:
   * - Thinking blocks (Anthropic)
   * - Tool calling (when tools provided)
   * - Regular text generation
   * - Prompt caching (Anthropic)
   * 
   * @param messages - Chat messages (content can be string, CacheableContent[], or tool results)
   * @param options - Optional configuration
   * @param options.tools - Available tools (enables tool calling)
   * @param options.maxTokens - Maximum tokens to generate
   * @returns AsyncIterable of structured events (thinking, text, tool_use, done)
   */
  stream(
    messages: Array<{ role: string; content: string | CacheableContent[] | any[] }>,
    options?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
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

