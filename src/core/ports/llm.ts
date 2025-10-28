/**
 * LLM Port
 * Interface for Large Language Model interactions
 */

export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
}

