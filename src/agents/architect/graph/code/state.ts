import { CodeMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";

export interface IntegrationRequirement {
  name: string;
  type?: 'database' | 'api' | 'auth' | 'other';
  description?: string;
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
  
  // Evaluation
  evaluationReport?: any;
  
  // Learning
  learnings?: string;
  
  // Results (populated by learn node)
  branch?: string;
  filesWritten?: number;
  reportFile?: string;
}
