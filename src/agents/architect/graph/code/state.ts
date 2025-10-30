import { CodeMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";

export interface IntegrationRequirement {
  name: string;
  type?: 'database' | 'api' | 'auth' | 'other';
  description?: string;
}

export interface ErrorSubtask {
  name: string;               // e.g., "Missing Entry Files"
  priority: number;           // Higher = more critical
  errors: string[];           // List of error messages in this category
  description: string;        // What needs to be done
  category: ErrorCategory;    // Type of errors
}

export type ErrorCategory = 
  | 'missing_files'       // Missing required files (index.html, etc)
  | 'missing_deps'        // Missing npm packages
  | 'type_errors'         // TypeScript type errors
  | 'config_errors'       // Configuration issues
  | 'import_errors'       // Import path errors
  | 'syntax_errors'       // Syntax errors
  | 'other';              // Uncategorized

export interface AttemptHistory {
  attemptNumber: number;           // Which attempt this was (1, 2, 3...)
  filesGenerated: string[];        // List of files created/modified
  keyChanges: string[];            // Human-readable summary of changes
  subtaskName?: string;            // Which subtask this was for (if any)
  errorsAttemptedToFix: string[];  // Which errors this attempt tried to fix
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

/**
 * Code Task State
 * State for code generation graph (generate/refactor/explain)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Latest design document
 * - code: Current codebase (working tree)
 * - codeHead: Git HEAD version (for comparison)
 * - profile: Codebase profile (language/framework)
 */
export interface ArchitectGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext & { enableEvaluation?: boolean };
  spec: string;  // CLI input
  
  // Dependencies
  deps?: { 
    git?: GitPort; 
    memory?: MemoryPort; 
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    analyzer?: CodebaseAnalyzerPort;
    chunk?: ChunkPort;
    session?: SessionPort;
    command?: CommandPort;
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  
  // Mode (inferred or explicit)
  codeMode?: CodeMode;  // generate / refactor / explain

  // Execution
  planText: string;
  codePrompt: string;
  rawResponse: string;
  responseSection?: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];
  modifications?: any[];  // For evaluation

  requiredIntegrations: IntegrationRequirement[];
  violations?: string[];

  retries: number;
  maxRetries: number;
  enforcementReason?: string | null;  // Validation errors passed from enforce to plan
  
  // Progress tracking (for smart retry reset)
  lastViolations?: string[];  // Previous violations to detect progress
  previousFileCount?: number; // Previous file count to detect new files
  
  // Attempt history (to prevent repeating same mistakes)
  previousAttempts?: AttemptHistory[];  // History of what we tried before
  
  // Task Decomposition (Divide & Conquer)
  currentSubtask?: ErrorSubtask;      // Current focused subtask
  remainingSubtasks?: ErrorSubtask[]; // Queue of remaining subtasks
  completedSubtasks?: string[];       // Names of completed subtasks
  resolvedCategories?: ErrorCategory[]; // Categories with 0 errors (successfully resolved)
  subtaskIndex: number;               // Current subtask index (for display)
  totalSubtasks: number;              // Total number of subtasks
  
  // Dynamic Validation
  dynamicValidationResult?: {
    passed: boolean;
    errors: string[];
  };
  
  // Evaluation
  evaluationReport?: any;
  
  // Learning
  learnings?: string;
  
  // Results (populated by learn node)
  branch?: string;
  filesWritten?: number;
  reportFile?: string;
}
