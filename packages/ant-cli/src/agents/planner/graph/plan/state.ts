/**
 * Plan Graph State
 * 
 * State for the plan (PRD) generation/refinement graph.
 * Follows PRD-as-State pattern: existing PRD is loaded as context.
 * 
 * Implements TriageableState-compatible fields for shared triage node.
 */

import { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers';
import { TriageableState, WorkspaceState } from '../../../common/nodes/triage/types';
import { ConversationEntry } from '../../../../core/types/session';
import type { PromptPort } from '../../../../core/ports/prompt';
import type { ResolvedActionContext, ActionMetadata } from '@ant/shared';

export interface PlanGraphState extends TriageableState, PhaseTrackingState {
  // Input
  directive?: string;
  language: 'ko' | 'en';
  featurePath: string;
  
  // Planner phase (distinct from universal RAC `Mode`)
  plannerPhase: 'generate' | 'refine' | 'explain';
  
  // Context (loaded by resolve node)
  context: { featurePath?: string; [key: string]: any };
  existingDocument?: string;
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
  
  // Output
  generatedDocument?: string;
  
  /** Intent-centric resolved context (passed from FE actionMetadata, consumed by templates) */
  resolvedAction?: ResolvedActionContext;
  
  // Dependencies (extends TriageableState.deps)
  deps?: {
    llm?: any;
    session?: any;
    kanbanUpdate?: any;
    fileTreeUpdate?: any;
    workflowUpdate?: any;
    promptPort?: PromptPort;
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

export function createInitialPlanState(params: {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  plannerPhase?: 'generate' | 'refine' | 'explain';
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
    plannerPhase: params.plannerPhase || 'generate',
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
