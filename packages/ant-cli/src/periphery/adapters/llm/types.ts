/**
 * LLM Types
 * 
 * Common types for LLM adapters and streaming
 */

export type LLMStreamEventType = 'thinking' | 'text' | 'error' | 'done';

export interface LLMStreamEvent {
  type: LLMStreamEventType;
  content: string;
  index?: number;
  metadata?: {
    model?: string;
    provider?: string;
    timestamp?: string;
  };
}

export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
  stream(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<string>;
  invokeStructured<T>(messages: Array<{ role: string; content: string }>, schema: any, options?: Record<string, any>): Promise<T>;
  streamRaw?(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<LLMStreamEvent>;
}

