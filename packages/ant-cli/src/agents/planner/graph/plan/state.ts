/**
 * Plan Graph State
 * 
 * State for the plan (PRD) generation/refinement graph.
 * Follows PRD-as-State pattern: existing PRD is loaded as context.
 * 
 * Implements TriageableState-compatible fields for shared triage node.
 */

import { TokenUsage, PhaseTrackingState } from '../../../common/graph/llmHelpers';
import { TriageResult, WorkspaceState } from '../../../common/nodes/triage/types';
import { ConversationEntry } from '../../../../core/types/session';
import type { PromptPort } from '../../../../core/ports/prompt';

export interface PlanGraphState extends PhaseTrackingState {
  // Input
  directive?: string;
  language: 'ko' | 'en';
  workspaceState?: WorkspaceState;
  featurePath: string;
  
  // Mode
  mode: 'generate' | 'refine' | 'explain';
  isResume?: boolean;
  
  // Context (loaded by resolve node)
  existingDocument?: string;
  evalReport?: string;
  rubricContent?: string;        // PRD rubric (auto-loaded when eval is absent, for self-diagnosis)
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
  
  // TriageableState-compatible fields (for shared triage node)
  context: { featurePath?: string; [key: string]: any };
  triageResult?: TriageResult;
  skipTriage?: boolean;
  currentAgent?: string;
  currentJob?: string;
  overrideDirective?: string;
  chatSource?: boolean;
  
  // Dependencies
  deps?: {
    llm?: any;
    session?: any;
    kanbanUpdate?: any;
    fileTreeUpdate?: any;
    workflowUpdate?: any;
    promptPort?: PromptPort;
    /** Mutable shared reference for SIGTERM handler access to latest graph state */
    stateSnapshot?: {
      conversationHistory: Array<{ role: string; content: any }>;
      directive?: string;
      overrideDirective?: string;
      tokenUsage?: TokenUsage;
    };
  };
  
  // UI locale (auto-detected from directive)
  _uiLocale?: 'ko' | 'en';
  
  // HTTP context
  _httpJobId?: string;
  
  // Token tracking
  tokenUsage?: TokenUsage;
  
  // Recursion tracking (for kanban badge display)
  recursionCount: number;
  recursionLimit: number;
}

export function createInitialPlanState(params: {
  directive: string;
  language: 'ko' | 'en';
  workspaceState: WorkspaceState;
  featurePath: string;
  mode?: 'generate' | 'refine' | 'explain';
  isResume?: boolean;
  deps?: PlanGraphState['deps'];
  _httpJobId?: string;
  chatSource?: boolean;
  skipTriage?: boolean;
}): PlanGraphState {
  return {
    directive: params.directive,
    language: params.language,
    workspaceState: params.workspaceState,
    featurePath: params.featurePath,
    mode: params.mode || 'generate',
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
    // Dependencies
    deps: params.deps,
    _httpJobId: params._httpJobId,
    // Recursion tracking
    recursionCount: 0,
    recursionLimit: parseInt(process.env.RECURSION_LIMIT || '200', 10),
  };
}
