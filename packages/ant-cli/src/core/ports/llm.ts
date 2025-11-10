/**
 * LLM Port
 * Interface for Large Language Model interactions
 */

export type LLMStreamEventType = 'thinking' | 'text' | 'error' | 'done';

export interface LLMStreamEvent {
  type: LLMStreamEventType;
  content: string;
  index?: number;  // Content block index
  metadata?: {
    model?: string;
    provider?: string;
    timestamp?: string;
  };
}

export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
  
  /**
   * Stream response from LLM (simple, backward compatible)
   * Returns combined text without thinking/text separation
   */
  stream?(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<string>;
  
  /**
   * 🎯 Stream with provider-specific features (thinking blocks, etc.)
   * 
   * Anthropic: Separates thinking and text blocks
   * OpenAI: Exposes function_call events
   * 
   * @returns AsyncIterable of structured events
   */
  streamRaw?(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<LLMStreamEvent>;
  
  /**
   * Invoke with structured output (JSON schema enforcement)
   * Forces LLM to return valid JSON matching the schema
   * 
   * @param messages - Chat messages
   * @param schema - JSON schema for the expected output
   * @param schemaName - Name of the schema (for tool calling)
   * @returns Parsed object matching the schema
   */
  invokeStructured<T = any>(
    messages: Array<{ role: string; content: string }>,
    schema: Record<string, any>,
    schemaName: string
  ): Promise<T>;
}

