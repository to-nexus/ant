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
import type { ResolvedActionContext, ExecutionTierId } from '@ant/shared';
import type { Conversations } from '../../../common/graph/conversations';
import type { ChatTail } from '../../../../core/context/chatTailBuilder';

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
 * Ask Graph State — extends ResolvableState with ask-specific fields
 */
export interface AskGraphState extends ResolvableState {
  question: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  conversations: Conversations;
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
  evalType?: 'prd' | 'system-design' | 'ui-design' | 'game-art' | 'code' | 'all';
  chatMessageStarted?: boolean;
  /**
   * Join-barrier redo flag (explore subagent): set when the agent node
   * withheld its final response to deliver pending subagent reports first.
   * Router re-enters the agent node; the node clears it on its next return.
   */
  _subagentJoinRedo?: boolean;
  /**
   * 5-tier execution strategy. Ask / inline-ask are read-only Q&A flows —
   * always Tier 0 Reflex. The runner injects this at graph start; no LLM
   * judgment involved.
   */
  executionTier?: ExecutionTierId;
  /**
   * P1 rich tail (e2-humming-spindle) — recent user↔assistant exchanges
   * assembled from chat.jsonl by the caller. Rendered in the agent prompt's
   * "Recent Conversation" section so cross-job referents resolve.
   */
  recentConversation?: ChatTail;
}

export const AskAnnotation = Annotation.Root({
  ...ResolvableFields,
  // Ask-specific fields only:
  question: Annotation<string>,
  language: Annotation<'ko' | 'en'>,
  workspaceState: Annotation<WorkspaceState>,
  toolCalls: Annotation<AskToolCall[]>,
  pendingToolCalls: Annotation<Array<{ id: string; name: string; args: Record<string, any> }>>,
  response: Annotation<string | undefined>,
  streamingCompleted: Annotation<boolean | undefined>,
  chatMessageStarted: Annotation<boolean | undefined>,
  // Join-barrier redo flag (explore subagent): the agent node withheld its
  // final response because pending subagent reports had to be delivered
  // first. Router re-enters the agent node; the node clears the flag.
  _subagentJoinRedo: Annotation<boolean | undefined>,
  resolvedAction: Annotation<ResolvedActionContext | undefined>,
  isEvaluation: Annotation<boolean | undefined>,
  evalType: Annotation<'prd' | 'system-design' | 'ui-design' | 'game-art' | 'code' | 'all' | undefined>,
  executionTier: Annotation<ExecutionTierId | undefined>,
  recentConversation: Annotation<ChatTail | undefined>,
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
  recentConversation?: ChatTail;
}): AskGraphState {
  // ExecutionTierId.Reflex = 0. We hardcode the literal here to avoid a
  // runtime import in the state module (which is imported widely).
  const RESOLVED_TIER = 0 as ExecutionTierId;
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
    conversations: {},
    toolCalls: [],
    pendingToolCalls: [],
    // Ask is a read-only Q&A flow — always Tier 0 Reflex.
    executionTier: RESOLVED_TIER,
    recentConversation: params.recentConversation,
  } as unknown as AskGraphState;
}
