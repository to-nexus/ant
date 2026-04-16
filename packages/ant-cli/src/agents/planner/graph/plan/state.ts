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
import type { ResolvedActionContext, ResolvedArtifact, ActionMetadata } from '@ant/shared';
import type { Conversations } from '../../../common/graph/conversations';

export const PlanAnnotation = Annotation.Root({
  ...DetectableFields,
  language: Annotation<any>,
  evalReport: Annotation<any>,
  rubricContent: Annotation<any>,
  recentTurnSummaries: Annotation<any>,
  isConversationContinuation: Annotation<any>,
  pendingToolCalls: Annotation<any>,
  phaseTokenUsages: Annotation<any>,
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
