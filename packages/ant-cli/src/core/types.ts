/**
 * Core Types
 * 
 * Shared types used across multiple agents and core systems.
 * These types are fundamental to the domain logic.
 */

// Re-export workspace types
export * from './types/workspace';

// Re-export environment types
export * from './types/environment';

/**
 * Agent task types
 * Defines what kind of work an agent performs
 */
export type AgentTask = 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';

/**
 * Vector DB Collection Types
 * Defines the types of collections in the vector database
 */
export type CollectionType = 
  | 'codebase'     // Source code chunks
  | 'documents'    // Design docs, PRD, directives, specs
  | 'lessons'      // Learned patterns, problem-solution-outcome
  | 'context';     // User preferences, session history (future)

/**
 * Document Types (for 'documents' collection)
 * Defines the types of documents that can be stored
 */
export type DocumentType = 
  | 'design'       // Design documents
  | 'prd'          // Product requirements documents
  | 'directive'    // User directives/instructions
  | 'spec';        // Technical specifications

/**
 * Get collection name from type and project
 * 
 * @param type - Collection type
 * @param project - Project name
 * @returns Collection name (e.g., 'codebase-myproject')
 */
export function getCollectionName(
  type: CollectionType, 
  project: string
): string {
  return `${type}-${project}`;
}

/**
 * Code generation modes
 * Defines how code generation should be performed
 * Note: Mode is now inferred by LLM in detectEnvironment node (no 'ambiguous' state)
 */
export type CodeMode = 'generate' | 'refactor' | 'explain';

/**
 * Design modes
 * Defines the nature of the design task
 */
export type DesignMode = 'greenfield' | 'evolution' | 'refactor';

/**
 * Codebase profile
 * Detected language, framework, and environment information
 */
export interface CodebaseProfile {
  language: string;
  framework?: string;
  version?: string;
  packageManager?: string;
  environment?: import('./types/environment').EnvironmentDetection;  // ✅ Environment detection result
  [key: string]: any;
}

/**
 * Task artifacts (REFACTORED)
 * Common input materials for both design and code tasks
 */
export interface TaskArtifacts {
  prd?: string;
  prdSpec?: string;  // ✅ Added for design graph
  directive?: string;
  design?: string;
  designDocPath?: string;
  code?: string;     // ✅ Added for design graph (codebase context)
  profile?: CodebaseProfile;
  lessons?: any;     // ✅ Changed to any for flexibility (string | array)
  documents?: any[];
}

/**
 * Project context
 * Contains all metadata about current project and workspace
 */
export interface ProjectContext {
  project: string;
  workingDir: string;
  memory?: string;              // Vector memory (long-term knowledge)
  userLanguage?: 'en' | 'ko' | 'ja' | 'zh';  // User's preferred language for this job
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
 * Interruption Reason
 * Categorizes why a job was interrupted
 */
export type InterruptionReason = 
  | 'recursion_limit'      // Hit recursion limit
  | 'user_stopped'         // User clicked Stop button
  | 'api_error'            // LLM API error (overloaded, rate limit, etc.)
  | 'process_crash'        // Child process crashed unexpectedly
  | 'timeout'              // Job timeout
  | 'server_shutdown'      // Server graceful shutdown
  | 'unknown';             // Unknown reason

/**
 * Interruption Details
 * Provides context about the interruption
 */
export interface InterruptionDetails {
  reason: InterruptionReason;
  message: string;          // Human-readable message
  timestamp: string;        // ISO timestamp
  canResume: boolean;       // Whether the job can be resumed
  metadata?: Record<string, any>;  // Additional context (e.g., error type, recursion count)
}

/**
 * Session State Snapshot
 * Stores execution state for resuming after interruption
 * 
 * This enables continuing from the exact point where execution stopped,
 * without re-decomposing tasks or losing progress.
 */
export interface SessionState {
  // ✨ Job Identity (Resume 시 재사용)
  jobId?: string;                 // Current active job ID (persists until completion or reset)
  
  // ✅ Directives (최신이 맨 앞, Continue 시 추가)
  directives?: string[];          // User directives (newest first for highest priority)
  overrideDirective?: string;     // ✅ Chat-initiated directive (highest priority, from chat input)
  chatSource?: boolean;           // ✅ Flag indicating if job was started from chat interface
  
  // ✅ Reference Projects (for tool calling)
  referenceRequests?: Array<{ project: string; branch?: string }>;  // Reference projects for semantic search
  
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
  planText?: string;              // Cached plan to skip LLM call on resume
  files?: Array<{ path: string; content: string }>;  // ✅ Generated files (design & code)
  filesToDelete?: string[];       // ✅ Files to delete (design & code)
  
  // ⚠️  DEPRECATED: Legacy fields (for backward compatibility only)
  designMarkdown?: string;        // Use files[] instead
  
  // ✅ Unified Interruption State
  interruption?: InterruptionDetails;  // Details about why and how the job was interrupted
  
  // Recursion Tracking
  recursionCount?: number;        // Current recursion iteration count
  recursionLimit?: number;        // Maximum recursion limit
  
  // ✨ Job-level Timing (총 소요 시간 추적)
  jobTiming?: {
    startedAt: string;              // Job 최초 시작 시간 (Resume 후에도 유지)
    lastResumedAt?: string;         // 마지막 Resume 시간
    pausedAt?: string;              // 중단 시간 (Stop 또는 recursion limit)
    completedAt?: string;           // 완료 시간
    totalPausedDuration: number;    // 총 일시정지 시간 (ms)
    estimatingDuration?: number;    // Estimating 단계 소요 시간 (ms, decompose 완료까지)
    totalElapsedTime?: number;      // 총 실 소요 시간 (ms, 일시정지 제외)
  };
  
  // ✅ Token usage tracking (for entire job)
  tokenUsage?: import('../agents/architect/types/task').TaskTokenUsage;
  
  // ✅ Project Code Context (for LLM RAG)
  projectCodeContext?: {
    source: 'plan' | 'stackTrace' | 'semantic';
    filePaths: string[];            // File paths only (lightweight)
    files: any[];                   // Content (empty in checkpoint)
    stats?: {
      filesLoaded: number;
      stackTraceCount?: number;
      semanticCount?: number;
      deduplicatedCount?: number;
      estimatedTokens?: number;
    };
  };
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

