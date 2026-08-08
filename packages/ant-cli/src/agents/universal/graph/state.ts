/**
 * Universal LangGraph State
 *
 * State for the universal job — the file-defined custom agent/job runtime.
 * The conversation is the job's only working memory (non-task, no TaskQueue),
 * held on the `session:main` channel so it persists across runs of the same
 * (agent, job) pair (`{container}/sessions/{agentId}/{jobId}.json`).
 *
 * Extends ResolvableFields from the common annotation chain.
 */

import { Annotation } from '@langchain/langgraph';
import { ResolvableFields } from '../../common/graph/annotationHelpers';
import type { ResolvableState } from '../../common/graph/annotationHelpers';
import type { ExecutionTierId } from '@ant/shared';
import type { Conversations } from '../../common/graph/conversations';

/** Tool call record for debugging / observability. */
export interface UniversalToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  error?: string;
  timestamp: number;
}

export interface UniversalGraphState extends ResolvableState {
  /** The user's message for this run (directive / overrideDirective). */
  userMessage: string;
  language: 'ko' | 'en';
  /** Project id (universal sessions live outside the features/ plane). */
  projectId?: string;
  conversations: Conversations;
  toolCalls: UniversalToolCall[];
  pendingToolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
  response?: string;
  streamingCompleted?: boolean;
  chatMessageStarted?: boolean;
  /** Join-barrier redo flag (explore subagent) — same contract as ask. */
  _subagentJoinRedo?: boolean;
  /**
   * Phase 1 pins Reflex like plan/visual (injected at graph start, no LLM
   * judgment); Phase 2 moves to LLM-declared `<executionTier>` per 7a.
   */
  executionTier?: ExecutionTierId;
  /**
   * Real file writes THIS RUN (from tool side-effects) — the respond node's
   * outputs-contract check and artifact manifest read this, never the LLM's
   * claims (completion-signal = actual-write principle).
   */
  _turnToolWrites: string[];
  /** Top-level artifact tree overview built by resolve (existence band). */
  artifactsOverview?: string;
  /**
   * Active intent ids for this run — classify node output (explicit >
   * inferred > ['general']). Gates injection inlining in the agent's system
   * block. Sealed by respond; restored by the runner.
   */
  activeIntents: string[];
  /** Explicit `@intent:` mentions for THIS run only (never persisted). */
  explicitIntents?: string[];
  /** Explicit `@ctx:` artifact paths for THIS run only (never persisted). */
  explicitContext?: string[];
}

export const UniversalAnnotation = Annotation.Root({
  ...ResolvableFields,
  userMessage: Annotation<string>,
  language: Annotation<'ko' | 'en'>,
  projectId: Annotation<string | undefined>,
  toolCalls: Annotation<UniversalToolCall[]>,
  pendingToolCalls: Annotation<Array<{ id: string; name: string; args: Record<string, any> }>>,
  response: Annotation<string | undefined>,
  streamingCompleted: Annotation<boolean | undefined>,
  chatMessageStarted: Annotation<boolean | undefined>,
  _subagentJoinRedo: Annotation<boolean | undefined>,
  executionTier: Annotation<ExecutionTierId | undefined>,
  _turnToolWrites: Annotation<string[]>,
  artifactsOverview: Annotation<string | undefined>,
  // Undeclared channels are DROPPED by LangGraph — declare every intent field.
  activeIntents: Annotation<string[]>,
  explicitIntents: Annotation<string[] | undefined>,
  explicitContext: Annotation<string[] | undefined>,
} as const);

export function createInitialUniversalState(params: {
  userMessage: string;
  language: 'ko' | 'en';
  containerPath: string;
  projectId?: string;
  deps?: any;
  _httpJobId?: string;
  isResume?: boolean;
  conversations?: Conversations;
  /** Restored classification from the sealed session (resume). */
  activeIntents?: string[];
  /** `@intent:` mentions for this run (validated at accept). */
  explicitIntents?: string[];
  /** `@ctx:` artifact paths for this run (existence-checked at accept). */
  explicitContext?: string[];
}): UniversalGraphState {
  const RESOLVED_TIER = 0 as ExecutionTierId; // ExecutionTierId.Reflex (avoid runtime import)
  return {
    featurePath: params.containerPath,
    context: {} as any,
    deps: params.deps as any,
    _httpJobId: params._httpJobId,
    currentJob: 'universal',
    currentAgent: 'universal',
    isResume: params.isResume,
    userMessage: params.userMessage,
    language: params.language,
    projectId: params.projectId,
    conversations: params.conversations ?? {},
    toolCalls: [],
    pendingToolCalls: [],
    executionTier: RESOLVED_TIER,
    _turnToolWrites: [],
    activeIntents: params.activeIntents?.length ? params.activeIntents : ['general'],
    explicitIntents: params.explicitIntents,
    explicitContext: params.explicitContext,
  } as unknown as UniversalGraphState;
}
