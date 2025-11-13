/**
 * LLM Types
 * 
 * Common types for LLM adapters and streaming
 */

export type LLMStreamEventType = 
  // LLM-generated content
  | 'thinking'          // LLM thinking / reasoning process
  | 'text'              // General LLM response
  | 'file_creating'     // File creation in progress (streaming)
  | 'file_create'       // File creation complete
  | 'file_editing'      // File edit in progress (streaming)
  | 'file_edit'         // File edit complete
  | 'file_deleting'     // File deletion in progress
  | 'file_delete'       // File deletion complete
  | 'command_running'   // Command execution in progress
  | 'command_streaming' // Command output streaming
  | 'command'           // Command execution complete
  // System events
  | 'error'             // Error event
  | 'done';             // Stream complete

export interface LLMStreamEvent {
  type: LLMStreamEventType;
  content: string;
  index?: number;
  metadata?: {
    model?: string;
    provider?: string;
    timestamp?: string;
    blockStart?: boolean;  // For thinking: marks <thinking> tag opened (new block)
  };
}

export interface LLMClient {
  invoke(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): Promise<string>;
  stream(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<string>;
  invokeStructured<T>(messages: Array<{ role: string; content: string }>, schema: any, options?: Record<string, any>): Promise<T>;
  streamRaw?(messages: Array<{ role: string; content: string }>, options?: Record<string, any>): AsyncIterable<LLMStreamEvent>;
}

