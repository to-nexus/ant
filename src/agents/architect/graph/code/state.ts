import { ProjectContext, CodeMode } from "../../types";
import { GitPort, MemoryPort, LLMClient } from "../../../../core/ports";
import { ArchitectPromptor } from "../../prompt/ArchitectPromptor";

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
    promptor?: ArchitectPromptor;
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  codeMode?: CodeMode;  // Inferred or explicit mode for code generation

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
}
