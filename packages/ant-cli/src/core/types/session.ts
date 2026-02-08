/**
 * Session & Interruption Types
 * 
 * Defines the session lifecycle: turns, state, interruptions, and artifacts.
 * Sessions track job execution history and enable resume after interruption.
 */

import type { AgentJob } from './agent';
import type { TaskTokenUsage, JobTiming, InterruptionDetails } from '@ant/shared';

// Re-export shared types
export type { InterruptionReason, InterruptionDetails } from '@ant/shared';
export type { JobTiming } from '@ant/shared';

// ============================================
// Session Turn Types
// ============================================

/** Input metadata for a session turn */
export interface SessionTurnInput {
  type: 'text' | 'file' | 'directive' | 'design';
  source?: string;        // File path (e.g., "inputs/sources/prd.md")
  summary: string;        // Brief summary (200 chars max)
  hash?: string;          // Content hash for change detection
  size?: number;          // Content size in bytes
}

/** Output results of a session turn */
export interface SessionTurnOutput {
  // Design task outputs
  designPath?: string;
  planSummary?: string;
  decisionCount?: number;
  
  // Code task outputs
  branch?: string;
  filesWritten?: number;
  files?: string[];
  modifications?: string[];
  
  // Common outputs
  reportPath?: string;
  error?: string;
  [key: string]: any;
}

/** A single turn in the conversation/workflow */
export interface SessionTurn {
  turnId: number;
  job: AgentJob;
  timestamp: string;
  input: SessionTurnInput;
  output: SessionTurnOutput;
  reference?: {
    turnId: number;
  };
}

// ============================================
// Session Artifacts
// ============================================

/** References to key artifacts in the session */
export interface SessionArtifacts {
  latestDesign?: string;        // Path to latest design doc
  activeBranch?: string;
  keyDecisions?: string[];
  [key: string]: any;
}

// ============================================
// Session State (Execution Snapshot)
// ============================================

/**
 * Execution state snapshot for resuming after interruption.
 * Enables continuing from the exact point where execution stopped.
 */
export interface SessionState {
  // Job Identity
  jobId?: string;
  
  // Directives
  directives?: string[];
  overrideDirective?: string;
  chatSource?: boolean;
  
  // Reference Projects
  referenceRequests?: Array<{ project: string; branch?: string }>;
  
  // Task Queue State
  taskQueue?: any[];
  currentTask?: any;
  completedTasks?: string[];
  completedTasksDetails?: any[];
  
  // Retry State
  retries?: number;
  maxRetries?: number;
  
  // History
  previousAttempts?: any[];
  enforcementHistory?: any[];
  lastViolations?: any[];
  
  // Progress Tracking
  previousFileCount?: number;
  resolvedCategories?: string[];
  
  // Execution Context
  planText?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string | any[] }>;
  files?: Array<{ path: string; content: string }>;
  filesToDelete?: string[];
  
  // Interruption
  interruption?: InterruptionDetails;
  
  // Recursion Tracking
  recursionCount?: number;
  recursionLimit?: number;
  
  // Job-level Timing
  jobTiming?: JobTiming;
  
  // Token usage
  tokenUsage?: TaskTokenUsage;
  
  // Project Code Context (for LLM RAG)
  projectCodeContext?: {
    source: 'plan' | 'stackTrace' | 'semantic';
    filePaths: string[];
    files: any[];
    stats?: {
      filesLoaded: number;
      stackTraceCount?: number;
      semanticCount?: number;
      deduplicatedCount?: number;
      estimatedTokens?: number;
    };
  };
}

// ============================================
// Session
// ============================================

/** A feature development session with full context */
export interface Session {
  sessionId: string;
  project: string;
  feature: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  artifacts: SessionArtifacts;
  state?: SessionState;
}
