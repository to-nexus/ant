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

/**
 * The turn's confirmed work context — universal's analog of the canonical
 * detect contract (slots + provenance + execution tier, confirmed once, read
 * everywhere downstream). The detect node is the ONLY writer.
 *
 * Deliberately NOT a `ResolvedActionContext`: RAC's identity half
 * (intent/intentGroup/mode) is a closed code-branching vocabulary, while a
 * universal job's intents are workspace-authored data (job.yaml catalog).
 * Universal follows RAC's *structure* without forging canonical identity.
 */
export interface UniversalTurnContext {
  /** Active intent ids — job.yaml catalog vocabulary, not canonical IntentId. */
  intents: string[];
  /** `@ctx:` workspace paths attached to this turn (advisory, not a read gate). */
  context: string[];
  /** `@plan` — while true the tool node confines writes to `plan/`. */
  planTurn: boolean;
  /** Whether the user pinned the context explicitly (`@` mentions) or it was inferred. */
  source: 'explicit' | 'infer';
  /** LLM-declared execution tier (detect's `<executionTier>` tag). */
  executionTier: ExecutionTierId;
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
   * Real file writes THIS RUN (from tool side-effects) — the respond node's
   * outputs-contract check and artifact manifest read this, never the LLM's
   * claims (completion-signal = actual-write principle).
   */
  _turnToolWrites: string[];
  /** Top-level artifact tree overview built by resolve (existence band). */
  artifactsOverview?: string;
  /** Per-phase cumulative usage history (token popup rows). */
  phaseTokenUsages?: import('@ant/shared').PhaseTokenUsage[];
  /**
   * Confirmed turn context — detect node output, sealed by respond,
   * restored (intents + tier) by the runner. Downstream nodes read THIS,
   * never the raw runner inputs below.
   */
  turnContext?: UniversalTurnContext;
  /** Restored classification from the sealed session (resume input). */
  restoredIntents?: string[];
  /** Restored execution tier from the sealed session (resume input). */
  restoredExecutionTier?: ExecutionTierId;
  /** Explicit `@intent:` mentions for THIS run only (never persisted). */
  explicitIntents?: string[];
  /** Explicit `@ctx:` artifact paths for THIS run only (never persisted). */
  explicitContext?: string[];
  /** Per-turn plan-mode request (`@plan`) — never sealed, mirrors explicitIntents. */
  planRequested?: boolean;
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
  _turnToolWrites: Annotation<string[]>,
  artifactsOverview: Annotation<string | undefined>,
  phaseTokenUsages: Annotation<import('@ant/shared').PhaseTokenUsage[] | undefined>,
  // Undeclared channels are DROPPED by LangGraph — declare every field.
  turnContext: Annotation<UniversalTurnContext | undefined>,
  restoredIntents: Annotation<string[] | undefined>,
  restoredExecutionTier: Annotation<ExecutionTierId | undefined>,
  explicitIntents: Annotation<string[] | undefined>,
  explicitContext: Annotation<string[] | undefined>,
  planRequested: Annotation<boolean | undefined>,
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
  recursionLimit?: number;
  /** Restored classification from the sealed session (resume). */
  restoredIntents?: string[];
  /** Restored execution tier from the sealed session (resume). */
  restoredExecutionTier?: ExecutionTierId;
  /** `@intent:` mentions for this run (validated at accept). */
  explicitIntents?: string[];
  /** `@ctx:` artifact paths for this run (existence-checked at accept). */
  explicitContext?: string[];
  /** `@plan` per-turn plan-mode request. */
  planRequested?: boolean;
}): UniversalGraphState {
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
    // Node phase labels (token gauge / estimating banner) localize via
    // _uiLocale; universal never sets directive/overrideDirective, so the
    // shared resolve node cannot derive it — seed it here.
    _uiLocale: params.language,
    projectId: params.projectId,
    conversations: params.conversations ?? {},
    toolCalls: [],
    pendingToolCalls: [],
    recursionLimit: params.recursionLimit,
    _turnToolWrites: [],
    restoredIntents: params.restoredIntents,
    restoredExecutionTier: params.restoredExecutionTier,
    explicitIntents: params.explicitIntents,
    explicitContext: params.explicitContext,
    planRequested: params.planRequested,
  } as unknown as UniversalGraphState;
}
