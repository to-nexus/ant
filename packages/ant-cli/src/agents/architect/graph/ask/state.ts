/**
 * Ask LangGraph State
 * 
 * State for Agentic Ask system that explores Ant source code to answer questions.
 * Uses Anthropic native message format (same as Code Job) for tool calling compatibility.
 *
 * Extends ResolvableFields from the common annotation chain, inheriting:
 * featurePath, context, directive, deps, _httpJobId, tokenUsage,
 * currentAgent, currentJob, recursionCount, recursionLimit, etc.
 */

import { Annotation } from '@langchain/langgraph';
import { ResolvableFields } from '../../../common/graph/annotationHelpers';
import type { ResolvableState } from '../../../common/graph/annotationHelpers';
import { WorkspaceState } from '../../../common/graph/nodes/triage/types';
import type { MessageContentBlock } from '../../../../core/ports/llm';
import type { ResolvedActionContext } from '@ant/shared';

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
 * Message format for conversation history (same as Code Job)
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | MessageContentBlock[];
}

/**
 * Ask Graph State — extends ResolvableState with ask-specific fields
 */
export interface AskGraphState extends ResolvableState {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  conversationHistory: ConversationMessage[];
  toolCalls: AskToolCall[];
  pendingToolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  response?: string;
  streamingCompleted?: boolean;
  resolvedAction?: ResolvedActionContext;
  isEvaluation?: boolean;
  evalType?: 'prd' | 'design-system' | 'design-ui' | 'code' | 'all';
  chatMessageStarted?: boolean;
}

export const AskAnnotation = Annotation.Root({
  ...ResolvableFields,
  // Ask-specific fields only:
  question: Annotation<string>,
  language: Annotation<'ko' | 'en'>,
  workspaceState: Annotation<WorkspaceState>,
  conversationHistory: Annotation<ConversationMessage[]>,
  toolCalls: Annotation<AskToolCall[]>,
  pendingToolCalls: Annotation<Array<{ id: string; name: string; args: Record<string, any> }>>,
  response: Annotation<string | undefined>,
  streamingCompleted: Annotation<boolean | undefined>,
  chatMessageStarted: Annotation<boolean | undefined>,
  resolvedAction: Annotation<ResolvedActionContext | undefined>,
  isEvaluation: Annotation<boolean | undefined>,
  evalType: Annotation<'prd' | 'design-system' | 'design-ui' | 'code' | 'all' | undefined>,
} as const);

/**
 * Initial state factory
 */
export function createInitialAskState(params: {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  currentJob?: string;
  currentAgent?: string;
  deps?: {
    llm?: any;
    promptBuilder?: import('../../../../core/prompt/builder/PromptBuilder').PromptBuilder;
  };
  _httpJobId?: string;
  featurePath?: string;
}): AskGraphState {
  return {
    // ResolvableState fields
    featurePath: params.featurePath,
    context: {} as any,
    deps: params.deps as any,
    _httpJobId: params._httpJobId,
    currentJob: params.currentJob,
    currentAgent: params.currentAgent,
    // Ask-specific fields
    question: params.question,
    language: params.language,
    workspaceState: params.workspaceState,
    conversationHistory: [],
    toolCalls: [],
    pendingToolCalls: [],
  } as AskGraphState;
}
