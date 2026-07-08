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
import type { ResolvedActionContext, ResolvedArtifact, ActionMetadata, ExecutionTierId } from '@ant/shared';
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
  _planAuthoringPhase: Annotation<any>,
} as const);

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
   * 5-tier execution strategy — LLM direct output from the Tier Entry Node
   * (plan uses Detect). Phase nodes consume via `getExecutionTier(state)`
   * only.
   */
  executionTier?: ExecutionTierId;

  /**
   * Set when generate emits a `<clarify>` card and the run pauses for user
   * input. On the next invocation, runner restores this flag from session
   * state so `routeAfterPlannerResolve` can short-circuit triage/detect and
   * generate's entry hook (`consumeAwaitingClarify`) can append the user's
   * answer to NODE_GENERATE before the LLM call. Cleared by the helper.
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
   * generate → generate self-loop signal for the dedicated authoring turn.
   *
   * Set by `generate` when a `generate`-mode ReAct research loop concludes
   * (model stopped calling tools) WITHOUT emitting a `<file>` — the
   * arctic-edging-grass failure: after a long codebase-inspection loop a weak
   * model spills the PRD as prose. On re-entry the node authors in a
   * **tool-free turn over a compacted findings context** (not the raw tool
   * transcript), reproducing the confirmed-working greenfield condition where
   * `<file>` is emitted cleanly. The write channel stays `<file>` (no new
   * tool / channel — see plan-job-valiant-pebble). `routeAfterGenerate` reads
   * this to route back to `generate`; the authoring turn clears it so the loop
   * runs at most once.
   */
  _planAuthoringPhase?: boolean;
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
