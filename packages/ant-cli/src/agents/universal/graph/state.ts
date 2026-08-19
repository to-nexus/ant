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
import { GENERAL_INTENT } from '@ant/shared';
import type { UniversalChecklist } from '@ant/shared';
import type { Conversations } from '../../common/graph/conversations';
import type { StopHookCheck, StopHookLedger } from '../../../core/customAgents/stopHooks';

/** Tool call record for debugging / observability. */
export interface UniversalToolCall {
  name: string;
  args: Record<string, any>;
  result?: string;
  error?: string;
  timestamp: number;
}

/**
 * The turn's confirmed work context — assembled deterministically from
 * runner inputs (no LLM). The resolve node is the ONLY writer; downstream
 * nodes read THIS, never the raw runner inputs below.
 *
 * Deliberately NOT a `ResolvedActionContext`: RAC's identity half
 * (intent/intentGroup/mode) is a closed code-branching vocabulary, while a
 * universal job's intents are workspace-authored data (job.yaml catalog).
 * Universal follows RAC's *structure* without forging canonical identity.
 */
export interface UniversalTurnContext {
  /** Active intent ids — explicit `@intent:` mentions, else `['general']`
   *  (every intent prompt stays a read_file pointer for self-selection off
   *  the rendered Intent Catalog; there is no catalog default). */
  intents: string[];
  /** `@ctx:` workspace paths attached to this turn (advisory, not a read gate). */
  context: string[];
  /** `@plan` — while true the tool node confines writes to `plan/`. */
  planTurn: boolean;
  /**
   * Which of the three deterministic resolution steps produced `intents` —
   * `@` mentions, clarify-continuity inheritance, or the `general` fallback.
   * Never `'infer'`: no step classifies. Names the INTENT facet's provenance
   * only (an @ctx-only turn does not claim `pinned`). The chat card reads
   * this, and `'unpinned'` is the one value the author needs to see (no
   * declared intent is active, so intent prompts stayed pointers).
   */
  source: 'pinned' | 'unpinned' | 'inherited';
}

/**
 * The facets of a paused turn's context that survive the clarify pause
 * (`source` is re-derived by the answer turn's resolve — never inherited).
 */
export type InheritedTurnContext = Pick<UniversalTurnContext, 'intents' | 'context' | 'planTurn'>;

/**
 * Parse the sealed `clarifyTurnContext` (JSON round-trip — sanitize every
 * field). Returns undefined when malformed OR contentless: a general-only,
 * context-free, non-plan seal inherits nothing the answer turn would not
 * re-derive deterministically, and dropping it keeps the `unpinned` banner
 * (with its catalog choice list) instead of a meaningless `inherited`.
 */
export function parseSealedTurnContext(raw: unknown): InheritedTurnContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const intents = Array.isArray(o.intents)
    ? o.intents.filter((i): i is string => typeof i === 'string')
    : [];
  const context = Array.isArray(o.context)
    ? o.context.filter((c): c is string => typeof c === 'string')
    : [];
  const planTurn = o.planTurn === true;
  // A `['general']` intent list (the paused turn was unpinned) is normalized
  // to [] so the answer turn re-resolves intents through default/general
  // while still inheriting context/planTurn when those were the content.
  const meaningfulIntents = intents.filter((i) => i !== GENERAL_INTENT);
  if (meaningfulIntents.length === 0 && context.length === 0 && !planTurn) return undefined;
  return { intents: meaningfulIntents.length > 0 ? intents : [], context, planTurn };
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
   * Real file writes THIS RUN (from tool side-effects) — the stop-hook gate
   * (agent node), respond's stop-hook recomputation, and the artifact
   * manifest read this, never the LLM's claims (completion-signal =
   * actual-write principle).
   */
  _turnToolWrites: string[];
  /**
   * Successful tool-call names THIS RUN (calls whose result carried no
   * error) — the action stop hooks' evidence. Gate-rejected calls carry
   * `result.error`, so "advertised but blocked" never counts as performed.
   */
  _turnToolActions: string[];
  /** Stop-hook forced re-entries spent this turn (budget: stopHooks.ts). */
  hookBounceRounds?: number;
  /** Stop-hook bounce redo flag — routeAfterAgent reads it (join-redo shape). */
  _hookRedo?: boolean;
  /** Unmet checks after the bounce budget — respond recomputes; runner surfaces. */
  _hooksUnmet?: StopHookCheck[];
  /**
   * Hook ledger restored from a paused seal (`hookLedger`) — hooks already
   * met on a prior turn of the paused sequence are not re-demanded.
   */
  restoredHookLedger?: StopHookLedger;
  /** Top-level artifact tree overview built by resolve (existence band). */
  artifactsOverview?: string;
  /** Per-phase cumulative usage history (token popup rows). */
  phaseTokenUsages?: import('@ant/shared').PhaseTokenUsage[];
  /**
   * Confirmed turn context — resolve node output (deterministic).
   * Downstream nodes read THIS, never the raw runner inputs below.
   */
  turnContext?: UniversalTurnContext;
  /**
   * Existing plan documents under `plan/{agentId}/{jobId}/` — resolve's
   * disk listing (deterministic plan-consumption gate). Empty = no band.
   */
  planDocs?: string[];
  /**
   * Checklist authored THIS run (agent's `<checklist>` tag, full-replace —
   * last emit wins). Sealed by respond; the board mirrors it live.
   */
  turnChecklist?: UniversalChecklist;
  /** Checklist restored from the sealed session (resume/continuation input). */
  restoredChecklist?: UniversalChecklist;
  /** Explicit `@intent:` mentions for THIS run only (never persisted). */
  explicitIntents?: string[];
  /** Explicit `@ctx:` artifact paths for THIS run only (never persisted). */
  explicitContext?: string[];
  /** Per-turn plan-mode request (`@plan`) — never sealed, mirrors explicitIntents. */
  planRequested?: boolean;
  /** Clarify pauses spent this (agent, job) session — seal-restored, budget input. */
  clarifyRoundsUsed?: number;
  /**
   * Clarify continuity — the paused turn's sealed context, restored by the
   * runner ONLY when THIS run closes a dangling clarify tool_use (structural
   * gate; the seal marker stays advisory). Input tier below explicit mentions
   * in buildTurnContext; never re-sealed as-is (respond seals the RESOLVED
   * turnContext). Per-run input, like explicitIntents.
   */
  inheritedTurnContext?: InheritedTurnContext;
  /**
   * Set by clarifyPauseNode when THIS run ends on a clarify question —
   * routes tool→respond and shapes the seal. Per-run only, never restored.
   */
  _clarifyPause?: { toolUseId: string; question: string };
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
  _turnToolActions: Annotation<string[]>,
  hookBounceRounds: Annotation<number | undefined>,
  _hookRedo: Annotation<boolean | undefined>,
  _hooksUnmet: Annotation<StopHookCheck[] | undefined>,
  restoredHookLedger: Annotation<StopHookLedger | undefined>,
  artifactsOverview: Annotation<string | undefined>,
  phaseTokenUsages: Annotation<import('@ant/shared').PhaseTokenUsage[] | undefined>,
  // Undeclared channels are DROPPED by LangGraph — declare every field.
  turnContext: Annotation<UniversalTurnContext | undefined>,
  planDocs: Annotation<string[] | undefined>,
  turnChecklist: Annotation<UniversalChecklist | undefined>,
  restoredChecklist: Annotation<UniversalChecklist | undefined>,
  explicitIntents: Annotation<string[] | undefined>,
  explicitContext: Annotation<string[] | undefined>,
  planRequested: Annotation<boolean | undefined>,
  clarifyRoundsUsed: Annotation<number | undefined>,
  inheritedTurnContext: Annotation<InheritedTurnContext | undefined>,
  _clarifyPause: Annotation<{ toolUseId: string; question: string } | undefined>,
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
  /** Checklist restored from the sealed session (resume/continuation). */
  restoredChecklist?: UniversalChecklist;
  /** Clarify pauses already spent this session (restored from the seal). */
  clarifyRoundsUsed?: number;
  /** `@intent:` mentions for this run (validated at accept). */
  explicitIntents?: string[];
  /** `@ctx:` artifact paths for this run (existence-checked at accept). */
  explicitContext?: string[];
  /** `@plan` per-turn plan-mode request. */
  planRequested?: boolean;
  /** Paused turn's context, adopted only when this run closes a dangling clarify. */
  inheritedTurnContext?: InheritedTurnContext;
  /** Hook ledger restored from a paused seal (stop-hook / clarify continuity). */
  restoredHookLedger?: StopHookLedger;
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
    _turnToolActions: [],
    restoredHookLedger: params.restoredHookLedger,
    restoredChecklist: params.restoredChecklist,
    clarifyRoundsUsed: params.clarifyRoundsUsed,
    explicitIntents: params.explicitIntents,
    explicitContext: params.explicitContext,
    planRequested: params.planRequested,
    inheritedTurnContext: params.inheritedTurnContext,
  } as unknown as UniversalGraphState;
}
