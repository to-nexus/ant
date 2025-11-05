/**
 * Core Types
 * 
 * Shared types used across multiple agents and core systems.
 * These types are fundamental to the domain logic.
 */

// Re-export workspace types
export * from './types/workspace';

/**
 * Agent task types
 * Defines what kind of work an agent performs
 */
export type AgentTask = 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';

/**
 * Code generation modes
 * Defines how code generation should be performed
 */
export type CodeMode = 'generate' | 'refactor' | 'explain';

/**
 * Design modes
 * Defines the nature of the design task
 */
export type DesignMode = 'greenfield' | 'evolution' | 'refactor';

/**
 * Codebase profile
 * Detected language and framework information
 */
export interface CodebaseProfile {
  language: string;
  framework?: string;
  version?: string;
  packageManager?: string;
  [key: string]: any;
}

/**
 * Task artifacts
 * Common input materials for both design and code tasks
 * All fields are optional - resolve nodes load what's available
 */
export interface TaskArtifacts {
  // Documents
  prd?: string;           // PRD document (product requirements)
  directive?: string;     // User instruction (current work directive)
  design?: string;        // Latest design document (from previous turn)
  
  // Code
  code?: string;          // Current codebase (working tree)
  codeHead?: string;      // Git HEAD version (for comparison)
  
  // Analysis
  profile?: CodebaseProfile;  // Detected language/framework
}

/**
 * Project context
 * Contains all metadata about current project and workspace
 */
export interface ProjectContext {
  project: string;
  workingDir: string;
  memory?: string;              // Vector memory (long-term knowledge)
  sessionHistory?: string;      // Session history (short-term context)
  [key: string]: any;
}

/**
 * Session Turn Input
 * Stores metadata about input rather than full content to avoid duplication
 */
export interface SessionTurnInput {
  type: 'text' | 'file' | 'directive' | 'design';
  source?: string;        // File path (e.g., "inputs/sources/prd.md")
  summary: string;        // Brief summary (200 chars max)
  hash?: string;          // Content hash for change detection
  size?: number;          // Content size in bytes
}

/**
 * Session Turn
 * Represents a single turn in the conversation/workflow
 * 
 * ⚠️ Breaking change: `input` is now structured metadata, not full content
 * This saves tokens and avoids duplication with source files
 */
export interface SessionTurn {
  turnId: number;
  task: AgentTask;
  timestamp: string;
  input: SessionTurnInput;
  output: SessionTurnOutput;
  reference?: {
    turnId: number;
  };
}

/**
 * Session Turn Output
 * Contains the results of a turn execution
 * 
 * ⚠️ Design: planText removed to avoid duplication with design file
 * ⚠️ Decisions simplified to avoid storing verbose lists
 */
export interface SessionTurnOutput {
  // Design task outputs
  designPath?: string;
  planSummary?: string;      // NEW: Brief summary instead of full planText
  decisionCount?: number;    // NEW: Count instead of full list
  
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

/**
 * Session Artifacts
 * Contains references to key artifacts in the session
 * 
 * ⚠️ Breaking change: Removed latestPlan to avoid duplication
 * Plan is accessible via latestDesign file reference
 */
export interface SessionArtifacts {
  latestDesign?: string;        // Path to latest design doc (contains full plan)
  activeBranch?: string;
  keyDecisions?: string[];      // Only high-level decisions, not verbose
  [key: string]: any;
}

/**
 * Session State Snapshot
 * Stores execution state for resuming after recursion limit
 * 
 * This enables continuing from the exact point where execution stopped,
 * without re-decomposing tasks or losing progress.
 */
export interface SessionState {
  // Task Queue State
  taskQueue?: any[];              // Remaining tasks (Task[] from state.ts)
  currentTask?: any;              // Currently executing task (Task from state.ts)
  completedTasks?: string[];      // IDs of completed tasks (for backward compatibility)
  completedTasksDetails?: any[];  // ✅ NEW: Full task objects of completed tasks
  
  // Retry State
  retries?: number;               // Current retry count
  maxRetries?: number;            // Maximum retry limit
  
  // History
  previousAttempts?: any[];       // Previous attempt history
  enforcementHistory?: any[];     // Enforcement feedback history
  lastViolations?: any[];         // Last validation violations
  
  // Progress Tracking
  previousFileCount?: number;     // File count from previous attempt
  resolvedCategories?: string[]; // Error categories resolved
  
  // Execution Context (for resume optimization)
  planText?: string;              // ✅ Cached plan to skip LLM call on resume
  
  // Pause State (for recursion limit)
  pausedDueToLimit?: boolean;     // ✅ Indicates if paused due to recursion limit
  tasksRemaining?: number;        // ✅ Number of tasks remaining when paused
  
  // Recursion Tracking
  recursionCount?: number;        // ✅ Current recursion iteration count
  recursionLimit?: number;        // ✅ Maximum recursion limit
}

/**
 * Session
 * Represents a feature development session with full context
 */
export interface Session {
  sessionId: string;  // Unique session identifier (UUID)
  project: string;
  feature: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  artifacts: SessionArtifacts;
  state?: SessionState;  // ✅ Execution state snapshot for resuming
}

