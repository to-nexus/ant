/**
 * Ask System Types
 * 
 * Types for the Ant system question-answering functionality.
 * Ask System handles questions about Ant itself, not project codebases.
 */

import { WorkspaceState } from '../../agents/common/nodes/triage/types.js';
import { LLMClient } from '../ports/llm.js';

/**
 * Ask response from LLM
 */
export interface AskResponse {
  /** Whether the question is about Ant (in-scope) */
  inScope: boolean;
  /** Response content */
  content: string;
  /** Suggested follow-up questions */
  suggestions?: string[];
}

/**
 * Context provided to Ask System
 */
export interface AskContext {
  /** User's question */
  userQuestion: string;
  /** Current workspace state (from Triage) */
  workspaceState: WorkspaceState;
  /** Current job context */
  currentJob?: string;
  /** Current agent context */
  currentAgent?: string;
  /** User's preferred language (detected from input) */
  language: 'ko' | 'en';
}

/**
 * Dependencies for Ask System
 */
export interface AskDependencies {
  llm: LLMClient;
}

/**
 * Static knowledge structure
 * Note: Job info comes from AgentRegistry.generatePromptContext()
 */
export interface StaticKnowledge {
  agentOverview: string;
  workflow: string;
  outputs: string;
  features: string;
  jobGuide?: string;  // Deprecated, use AgentRegistry instead
}
