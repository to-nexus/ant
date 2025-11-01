/**
 * LLM Port
 * Interface for Large Language Model interactions
 */

export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
  
  /**
   * Stream response from LLM (optional)
   * If not implemented, falls back to invoke
   */
  stream?(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<string>;
  
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

