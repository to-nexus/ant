import { DesignMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";

/**
 * Design Task State
 * State for design generation graph (greenfield/evolution/refactor)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Previous design document
 * - code: Current codebase (for evolution/refactor)
 * - codeHead: Git HEAD version (not used in design)
 * - profile: Codebase profile (language/framework)
 */
export interface DesignGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext;
  spec: string;  // CLI input or PRD path
  
  // Dependencies
  deps?: {
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    chunk?: ChunkPort;
    session?: SessionPort;
    git?: GitPort;
    analyzer?: CodebaseAnalyzerPort;
  };

  // Mode (explicit or inferred)
  designMode?: DesignMode;  // greenfield / evolution / refactor

  // Execution
  planText: string;
  designMarkdown: string;
  
  // Results (populated by learn node)
  designFilePath?: string;
  learnings?: string;
}
