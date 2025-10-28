import { ProjectContext, CodeMode } from "../../types";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, CodebaseProfile } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";

export interface IntegrationRequirement {
  name: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export interface ArchitectGraphState {
  context: ProjectContext;
  spec: string;
  deps?: { 
    git?: GitPort; 
    memory?: MemoryPort; 
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    analyzer?: CodebaseAnalyzerPort;
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  codeMode?: CodeMode;  // Inferred or explicit mode for code generation
  codebaseProfile?: CodebaseProfile | null;  // Detected language/framework profile

  latestDesign: string;
  directive: string;
  originalFilesBlock: string; // concatenated FILE: ... blocks

  planText: string;

  codePrompt: string;
  rawResponse: string;
  responseSection?: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];

  requiredIntegrations: IntegrationRequirement[];
  violations?: string[];

  retries: number;
  maxRetries: number;
  
  // Learning data extracted from execution
  learnings?: string;
  
  // Results after saving (populated by learn node)
  branch?: string;
  filesWritten?: number;
}
