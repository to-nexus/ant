/**
 * Session & Interruption Types
 * 
 * Defines the session lifecycle: runs, state, interruptions, and artifacts.
 * Sessions track job execution history and enable resume after interruption.
 */

import type { AgentJob } from './agent';
import type { TaskTokenUsage, JobTiming, InterruptionDetails } from '@ant/shared';
import type { MessageContentBlock } from '../ports/llm';

// Re-export shared types
export type { InterruptionReason, InterruptionDetails } from '@ant/shared';
export type { JobTiming } from '@ant/shared';

// ============================================
// Session Run Types
// ============================================

/** Input metadata for a session run (one BullMQ job execution) */
export interface SessionRunInput {
  type: 'text' | 'file' | 'directive' | 'design';
  source?: string;        // File path (e.g., "inputs/sources/prd.md")
  summary: string;        // Brief summary (200 chars max)
  hash?: string;          // Content hash for change detection
  size?: number;          // Content size in bytes
}

/** Output results of a session run */
export interface SessionRunOutput {
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

/** A single run in the session (one BullMQ job execution = one process) */
export interface SessionRun {
  runId: number;
  job: AgentJob;
  timestamp: string;
  input: SessionRunInput;
  output: SessionRunOutput;
  reference?: {
    runId: number;
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
// Multi-Turn Conversation
// ============================================

/**
 * A single entry in the agent-user semantic conversation history.
 * Stored per agent/job session and persisted across job runs.
 * 
 * Unlike conversationHistory (LLM message format with tool_use/tool_result),
 * this captures only semantic content — user intent and agent responses.
 * Tool call details are ephemeral within each run's ReAct loop.
 * 
 * The 'system' role is used for:
 *  - Chapter markers (Visual deliver node: asset save notifications)
 *  - Compaction summaries (persist pruning: summarized older entries)
 */
export interface ConversationEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    hasArtifact?: boolean;   // This turn produced a PRD/design/code artifact
    artifactPath?: string;   // Path to the produced artifact
    mode?: string;           // generate, refine, etc.
    savedAsset?: string;     // Visual: deliver node saved asset path
    chapterSummary?: string; // Visual: chapter marker summary / persist pruning summary
    boundary?: 'heavyweight' | 'lightweight';  // Inter-Job Context Bridge: job complexity classification
    jobId?: string;          // Inter-Job Context Bridge: originating job ID
    taskCount?: number;      // Inter-Job Context Bridge: number of tasks completed
    filesWritten?: number;   // Inter-Job Context Bridge: number of files written
  };
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
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>;
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
  
  // Multi-Turn Conversation (cross-run semantic history)
  conversation?: ConversationEntry[];

  // Inter-Job Context Bridge (cross-job directive+result history)
  jobConversation?: ConversationEntry[];
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
  runs: SessionRun[];
  artifacts: SessionArtifacts;
  state?: SessionState;
}
