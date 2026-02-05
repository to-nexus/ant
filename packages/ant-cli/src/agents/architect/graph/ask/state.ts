/**
 * Ask LangGraph State
 * 
 * State for Agentic Ask system that explores Ant source code to answer questions.
 * Uses Anthropic native message format (same as Code Job) for tool calling compatibility.
 */

import { WorkspaceState } from '../../../common/nodes/triage/types.js';
import { TokenUsage } from '../common/llmHelpers.js';

/**
 * Tool call record for debugging
 */
export interface AskToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  error?: string;
  timestamp: number;
}

/**
 * Anthropic native content block types
 */
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

/**
 * Anthropic native message format (same as Code Job)
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
}

/**
 * Ask Graph State
 */
export interface AskGraphState {
  // Input
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  
  // LLM conversation (Anthropic native format - same as Code Job)
  conversationHistory: ConversationMessage[];
  
  // Tool execution tracking
  toolCalls: AskToolCall[];
  pendingToolCall?: {
    id: string;  // Tool use ID for result matching
    name: string;
    args: Record<string, any>;
  };
  
  // Output
  response?: string;
  streamingCompleted?: boolean;
  
  // Chat streaming state (to prevent starting new message after tool calls)
  chatMessageStarted?: boolean;
  
  // Dependencies
  deps?: {
    llm?: any;
  };
  
  // HTTP context
  _httpJobId?: string;
  
  // Token tracking
  tokenUsage?: TokenUsage;
}

/**
 * Initial state factory
 */
export function createInitialAskState(params: {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  deps?: { llm?: any };
  _httpJobId?: string;
}): AskGraphState {
  return {
    question: params.question,
    language: params.language,
    workspaceState: params.workspaceState,
    currentJob: params.currentJob,
    currentAgent: params.currentAgent,
    conversationHistory: [],  // Anthropic native format
    toolCalls: [],
    deps: params.deps,
    _httpJobId: params._httpJobId,
  };
}
