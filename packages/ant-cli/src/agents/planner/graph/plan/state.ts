/**
 * Plan Graph State
 * 
 * PlanAnnotation = SSOT for LangGraph graph registration.
 * PlanGraphState = mutable interface for node/runner code.
 */

import { Annotation } from '@langchain/langgraph';
import { DetectableFields } from '../../../common/graph/annotationHelpers';
import type { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers';
import type { TriageableState, WorkspaceState } from '../../../common/graph/nodes/triage/types';
import type { PromptPort } from '../../../../core/ports/prompt';
import type { ResolvedActionContext, ResolvedArtifact, ActionMetadata, ExecutionTierId, TokenUsageByModel } from '@ant/shared';
import type { Conversations } from '../../../common/graph/conversations';
import type { FeatureContext } from '../../../../core/context/featureContextBuilder';

export const PlanAnnotation = Annotation.Root({
  ...DetectableFields,
  language: Annotation<any>,
  evalReport: Annotation<any>,
  rubricContent: Annotation<any>,
  recentTurnSummaries: Annotation<any>,
  isConversationContinuation: Annotation<any>,
  pendingToolCalls: Annotation<any>,
  phaseTokenUsages: Annotation<any>,
  executionTier: Annotation<any>,
  awaitingClarify: Annotation<any>,
  clarifyRoundsUsed: Annotation<any>,
  clarifyPhase: Annotation<any>,
  featureContext: Annotation<any>,
  turnId: Annotation<any>,
  planText: Annotation<any>,
  _activePhase: Annotation<any>,
  // Join-barrier redo flag (explore subagent) — see routeAfterExecute.
  _subagentJoinRedo: Annotation<any>,
  // No-output window (tool-strip salvage trigger) — see _noOutputCallCount.
  _noOutputCallCount: Annotation<any>,
} as const);

/**
 * No-output circuit (cyan-catching-cedar follow-up — planner parity with the
 * design job). Both planner loops (plan⟷tool research, execute⟷tool authoring)
 * were bounded only by `recursionLimit=200`; a glm-5.2-class degenerate loop
 * that keeps issuing NOVEL reads/searches while never sealing a brief / writing
 * a document could burn ~100 tool rounds before the recursion backstop fires.
 *
 * `NO_OUTPUT_HARD_CAP − DRAIN_FINALIZE_MARGIN` (= 20) tool rounds without
 * forward output strips the tool list for the next call (see
 * `nodes/drainFinalize.ts`). Because both planner phases terminate structurally
 * on a tool-less round (plan seals best-effort, execute writes/errors), the
 * strip alone guarantees termination — no router hard-divert needed.
 */
export const NO_OUTPUT_HARD_CAP = 25;
export const DRAIN_FINALIZE_MARGIN = 5;

export interface PlanGraphState extends TriageableState, PhaseTrackingState {
  directive?: string;
  language: 'ko' | 'en';
  featurePath: string;
  context: { featurePath?: string; [key: string]: any };
  evalReport?: string;
  rubricContent?: string;
  recentTurnSummaries?: string[];
  conversations: Conversations;
  isConversationContinuation?: boolean;
  pendingToolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
  resolvedAction?: ResolvedActionContext;
  resolvedArtifacts?: ResolvedArtifact[];
  deps?: {
    llm?: any;
    /** Per-node models for the plan→execute split (orchestrator-created). Plan
     *  node uses `planLlm` (Opus), execute uses `executeLlm` (Sonnet); both fall
     *  back to `llm` (job default) when unset. See llmModels.plan config. */
    planLlm?: any;
    executeLlm?: any;
    session?: any;
    /**
     * Required by detect's infer branch (createInferDetectNode → inferRacWithTools).
     * Orchestrator must inject; absence trips the runtime guard in detect/index.ts.
     */
    fileSystem?: import('../../../../core/ports/filesystem').FileSystemPort;
    kanbanUpdate?: any;
    fileTreeUpdate?: any;
    workflowUpdate?: any;
    promptPort?: PromptPort;
    promptBuilder?: import('../../../../core/prompt/builder/PromptBuilder').PromptBuilder;
    stateSnapshot?: {
      conversations: Conversations;
      directive?: string;
      overrideDirective?: string;
      tokenUsage?: TokenUsage;
      jobTiming?: import('@ant/shared').JobTiming;
    };
  };
  _uiLocale?: 'ko' | 'en';
  recursionCount: number;
  recursionLimit: number;

  /**
   * Per-model job-level token usage, keyed by model id. Declared explicitly
   * here (the reducer-form annotation in ResolvableFields isn't surfaced on
   * this hand-written interface the way plain `tokenUsage` is). Carried across
   * the plan→execute node boundary so the per-model billing breakdown includes
   * every node's model, not just the last node's.
   */
  tokenUsageByModel?: TokenUsageByModel;

  /**
   * 5-tier execution strategy — LLM direct output from the Tier Entry Node
   * (plan uses Detect). Phase nodes consume via `getExecutionTier(state)`
   * only.
   */
  executionTier?: ExecutionTierId;

  /**
   * Set when the plan node emits a `<clarify>` card and the run pauses for
   * user input. On the next invocation, runner restores this flag from session
   * state so `routeAfterPlannerResolve` can short-circuit triage/detect and the
   * plan node's entry hook (`consumeAwaitingClarify`) can append the user's
   * answer to NODE_PLAN before the LLM call. Cleared by the helper.
   */
  awaitingClarify?: boolean;

  /** Clarify budget tracking (job-scoped) — written via shared applyClarifyGate. */
  clarifyRoundsUsed?: number;
  clarifyPhase?: import('@ant/shared').ClarifyPhase;

  /**
   * Cross-job feature context loaded from feature.jsonl (T2 user_turn +
   * T3 breadcrumb + boundary). Populated by `resolve` via
   * `hydrateFeatureContext` and re-hydrated by `triage` on every turn
   * (skipCompaction) so multi-turn intent inference inside the same job
   * can see the prior `actionMetadata` of the previous turn.
   *
   * SSOT lives in `core/context/featureContextBuilder.ts`. Consumers read
   * via PromptBuilder.enrichFeatureContextVars (universal channel).
   */
  featureContext?: FeatureContext;

  /**
   * Current user turn id recovered by `hydrateFeatureContext` (matches on
   * `jobId`). Consumed by downstream nodes that attribute trace events and
   * breadcrumb/boundary lines to the originating user request.
   */
  turnId?: string;

  /**
   * Phase D — DetectResult channel populated by `createInferDetectNode`.
   * Carries `status` (proceed / blocked / redirect-suggested) plus the
   * SSOT-side `resolvedAction` / `artifacts` / `missingPrerequisites` /
   * `suggestedAlternatives` / `displayMessage` / `choiceOptions`.
   * `routeAfterPlannerDetect` reads `status` to decide generate vs __end__.
   */
  detect?: import('../../../common/graph/nodes/detect/types').DetectResult<PlanGraphState>;

  /**
   * Sealed plan artifact (the brief payload, sealed in a `<plan>` tag) produced by the `plan` node
   * and consumed by `execute`. Mirrors the code/design job's `state.planText`.
   * The plan node clears its `NODE_PLAN` transcript on seal, so `execute`
   * starts from `directive + planText` with the research history severed.
   */
  planText?: string;

  /**
   * Which loop (`plan` or `execute`) is active. Set by the plan/execute nodes
   * before yielding to the shared `tool` node; read by `routeAfterTool` to
   * dispatch back and by the tool node's `activeConvKey` to pick the
   * conversation channel (NODE_PLAN vs NODE_EXECUTE). Same field name and
   * discipline as the design job's `_activePhase`.
   */
  _activePhase?: 'plan' | 'execute';
  /**
   * Join-barrier redo flag (explore subagent): execute withheld its
   * finalization to deliver pending subagent reports; the router re-enters
   * execute and the node clears the flag on its next return.
   */
  _subagentJoinRedo?: boolean;

  /**
   * No-output window: consecutive tool-call rounds (in either the plan or the
   * execute loop) that produced no forward output — no `<plan>` seal, no
   * `<file>` write. Incremented by the plan/execute nodes on each tool-round
   * return; reset to 0 when the plan node seals the brief (→execute) or a
   * subagent-join redo delivers reports (both = forward progress). At
   * `NO_OUTPUT_HARD_CAP − DRAIN_FINALIZE_MARGIN` the node strips its tool list
   * (`applyPlanDrainFinalization`), forcing a terminal turn. The tool node does
   * not touch this channel (last-write-wins preserves it across the hop).
   */
  _noOutputCallCount?: number;
}

/** Helper to read planMode from resolvedAction */
export function getPlanMode(state: PlanGraphState): 'generate' | 'refactor' | 'explain' {
  return state.resolvedAction?.mode || 'generate';
}

export function createInitialPlanState(params: {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  isResume?: boolean;
  deps?: PlanGraphState['deps'];
  _httpJobId?: string;
  chatSource?: boolean;
  skipTriage?: boolean;
  actionMetadata?: ActionMetadata;
}): PlanGraphState {
  return {
    directive: params.directive,
    language: params.language,
    workspaceState: params.workspaceState,
    featurePath: params.featurePath,
    isResume: params.isResume,
    conversations: {},
    pendingToolCalls: [],
    isConversationContinuation: false,
    context: { featurePath: params.featurePath },
    currentAgent: 'planner',
    currentJob: 'plan',
    overrideDirective: params.directive,
    chatSource: params.chatSource,
    skipTriage: params.skipTriage,
    actionMetadata: params.actionMetadata,
    deps: params.deps,
    _httpJobId: params._httpJobId,
    recursionCount: 0,
    recursionLimit: parseInt(process.env.RECURSION_LIMIT || '200', 10),
  };
}
