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
}

