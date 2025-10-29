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
 * Session Turn
 * Represents a single turn in the conversation/workflow
 */
export interface SessionTurn {
  turnId: number;
  task: AgentTask;
  timestamp: string;
  input: string;
  output: SessionTurnOutput;
  reference?: {
    turnId: number;
  };
}

/**
 * Session Turn Output
 * Contains the results of a turn execution
 */
export interface SessionTurnOutput {
  // Design task outputs
  designPath?: string;
  planText?: string;
  decisions?: string[];
  
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
 */
export interface SessionArtifacts {
  latestDesign?: string;
  latestPlan?: string;
  activeBranch?: string;
  keyDecisions?: string[];
  [key: string]: any;
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
}

