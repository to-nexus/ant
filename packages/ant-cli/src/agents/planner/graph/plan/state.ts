/**
 * Plan Graph State
 * 
 * State for the plan (PRD) generation/refinement graph.
 * Document content is injected via resolvedAction.documents (not stored in state).
 * 
 * Plan mode is determined by resolvedAction.mode (derived from intentId).
 * The old plannerPhase field is removed. resolvedAction replaces detectionReport.
 * 
 * Implements TriageableState-compatible fields for shared triage node.
 */

import { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers';
import { TriageableState, WorkspaceState } from '../../../common/nodes/triage/types';
import { ConversationEntry } from '../../../../core/types/session';
import type { PromptPort } from '../../../../core/ports/prompt';
import type { ResolvedActionContext, ResolvedArtifact, ActionMetadata } from '@ant/shared';

export interface PlanGraphState extends TriageableState, PhaseTrackingState {
  // Input
  directive?: string;
  language: 'ko' | 'en';
  featurePath: string;
  
  // Context (loaded by resolve node)
  context: { featurePath?: string; [key: string]: any };
  evalReport?: string;
  rubricContent?: string;
  recentTurnSummaries?: string[];
  
  // Multi-turn conversation (cross-run semantic history)
  conversation?: ConversationEntry[];
  isConversationContinuation?: boolean;
  
  // LLM conversation (ReAct loop)
  conversationHistory: Array<{ role: string; content: any }>;
  pendingToolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  
  /** Intent-centric resolved context (detect output, immutable) */
  resolvedAction?: ResolvedActionContext;
  /** Materialized file contents from resolvedAction refs/context */
  resolvedArtifacts?: ResolvedArtifact[];
  
  // Dependencies (extends TriageableState.deps)
  deps?: {
    llm?: any;
    session?: any;
    kanbanUpdate?: any;
    fileTreeUpdate?: any;
    workflowUpdate?: any;
    promptPort?: PromptPort;
    promptBuilder?: import('../../../../core/prompt/builder/PromptBuilder').PromptBuilder;
    stateSnapshot?: {
      conversationHistory: Array<{ role: string; content: any }>;
      directive?: string;
      overrideDirective?: string;
      tokenUsage?: TokenUsage;
      jobTiming?: import('@ant/shared').JobTiming;
    };
  };
  
  // ✅ UI locale (narrowed from TriageableState.string to literal union)
  _uiLocale?: 'ko' | 'en';
  
  // Recursion tracking (for kanban badge display)
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
    conversationHistory: [],
    pendingToolCalls: [],
    conversation: [],
    isConversationContinuation: false,
    // TriageableState fields
    context: { featurePath: params.featurePath },
    currentAgent: 'planner',
    currentJob: 'plan',
    overrideDirective: params.directive,
    chatSource: params.chatSource,
    skipTriage: params.skipTriage,
    actionMetadata: params.actionMetadata,
    // Dependencies
    deps: params.deps,
    _httpJobId: params._httpJobId,
    // Recursion tracking
    recursionCount: 0,
    recursionLimit: parseInt(process.env.RECURSION_LIMIT || '200', 10),
  };
}
