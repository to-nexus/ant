/**
 * Session & Interruption Types
 * 
 * Defines the session lifecycle: runs, state, interruptions, and artifacts.
 * Sessions track job execution history and enable resume after interruption.
 */

import type { AgentJob, CodebaseProfile } from './agent';
import type { TaskTokenUsage, JobTiming, InterruptionDetails, ResolvedActionContext, InferredAction, Boundary, ExecutionTierId, SpecClarify } from '@ant/shared';
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
    boundary?: Boundary;  // Inter-Job Context Bridge: job complexity classification
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
  failedTasks?: Array<{ taskId: string; taskName: string; error: string; timestamp: string }>;

  // Parallel Execution
  parallelMode?: boolean;
  
  // Retry State
  retries?: number;
  maxRetries?: number;
  
  // History
  previousAttempts?: any[];
  enforcementHistory?: any[];

  // Progress Tracking
  previousFileCount?: number;
  resolvedCategories?: string[];
  
  // Execution Context
  planText?: string;
  files?: Array<{ path: string; content: string }>;
  filesToDelete?: string[];
  
  // Interruption
  interruption?: InterruptionDetails;
  
  // Recursion Tracking
  recursionCount?: number;
  recursionLimit?: number;
  
  // Job-level Timing
  jobTiming?: JobTiming;
  
  // User Language (for LLM response localization on resume)
  userLanguage?: 'en' | 'ko' | 'ja' | 'zh';
  
  // Token usage
  tokenUsage?: TaskTokenUsage;

  // Multi-Turn Conversation (cross-run semantic history)
  conversation?: ConversationEntry[];

  // Unified conversations record (new format — node:* + session:* keys)
  conversations?: Record<string, any[]>;

  /**
   * Verification session snapshot — the SSOT that carries the current
   * diagnostic cycle (required/passed gates, attempt counter, plan
   * history, dep hash, batch-split count, previous batch diagnostics)
   * across session boundaries. Produced by `VerificationSession.snapshot()`
   * and consumed by `VerificationSession.rehydrate()` in `runner.ts`.
   *
   * Typed as `unknown` to keep `core/types/session.ts` free of
   * code-job-specific imports; the concrete shape is `VerificationSnapshot`
   * (see `agents/architect/graph/code/tasks/verification/model/snapshot.ts`).
   */
  verification?: unknown;

  // Detection & Profile
  // Effective TechTier is derived on demand via getTechTier(state) from
  // resolvedAction.basis.techTier. Do not persist as a top-level field.
  resolvedAction?: ResolvedActionContext;
  profile?: CodebaseProfile;
  lastInferredAction?: InferredAction;

  // Artifact Restoration
  directive?: string;
  design?: string;
  prd?: string;

  // Token Estimation Tracking
  estimatingTokenUsage?: TaskTokenUsage;
  estimatingLabel?: string;
  estimatingStartedAt?: number;
  estimatingNodeId?: string;

  // Design Job: Figma & UI
  figmaConfig?: any;
  figmaExplorationResult?: any;
  figmaAvailable?: boolean;
  figmaFileKey?: string;
  figmaStartNodeId?: string;
  awaitingDetectClarify?: boolean;
  awaitingClarify?: boolean;

  // ============================================
  // Session Redesign (5-tier execution model)
  // ============================================

  /**
   * Decompose-level clarify pause. Set when either (a) the clarify tool was
   * invoked during the decompose LLM turn, or (b) Decompose emitted
   * `<specClarify>`. Readers: routeAfterResolve (resume path).
   */
  awaitingDecomposeClarify?: boolean;

  /**
   * 5-tier execution strategy emitted by each job's Tier Entry Node
   * (code/design: Decompose, plan/visual: Detect). Consumed by
   * `routeAfterDecompose`, the `direct` node loop budget, and learn's
   * breadcrumb / boundary policy.
   */
  executionTier?: ExecutionTierId;

  /**
   * Hints produced by the Tier Entry Node for the `direct` node
   * (Tier 0-2 paths). Persisted so resume paths can rebuild direct-node
   * context without re-running decompose.
   */
  directHints?: { targetFiles?: string[]; explorationScope?: string };

  /**
   * Spec-clarify choice emitted by Decompose when a task-tier (3 or 4)
   * generate/refactor job has no design / directive-relevant spec source.
   * Presence pauses the job at `__end__` pending user choice.
   */
  specClarify?: SpecClarify;

  /**
   * User-bypass flag for spec-clarify. Set by the `proceed_without_spec`
   * route handler; read by decompose on re-entry to suppress re-emission
   * of `<specClarify>`.
   */
  _specClarifyBypassed?: boolean;

  /**
   * Runtime-escalation guard: the `direct` node may re-enter `decompose`
   * at most once per job. Set true when direct promotes to decompose;
   * read by `routeAfterDirect` to prevent infinite direct↔decompose loops.
   */
  _promotedThisJob?: boolean;

  /**
   * Direct-node escalation signal surfaced to `routeAfterDirect`.
   */
  needsEscalation?: boolean;
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
