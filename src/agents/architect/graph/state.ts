import { ProjectContext } from "../types";

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
