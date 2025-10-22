import * as ts from "typescript";

export const DIRECTIVE_TYPES = {
  CODE: 'code',
  DESIGN: 'design',
  LEARN: 'learn'
} as const;

export type DirectiveType = typeof DIRECTIVE_TYPES[keyof typeof DIRECTIVE_TYPES];
export type AgentMode = 'design' | 'code' | 'learn';

// 비 TypeScript 파일을 위한 구조
export interface FileStructure {
  kind: 'file';
  fileName: string;
  content: string;
}

// 코드베이스 노드 타입
export interface CodebaseNode {
  path: string;
  imports: string[];
  exports: string[];
  structure: ts.Node | FileStructure;
}

export interface BranchMetadata {
  project: string;
  branch: string;
  baseBranch?: string;
  commitHash: string;
  timestamp: string;
}

export interface ProjectContext {
  project: string;
  featureFolder: string;
  workingDir: string;
  config: any;
  memory: string;
}

export interface DirectiveResult {
  content: string;
  path: string;
}

export interface ArchitectResult {
  success: boolean;
  mode: AgentMode;
  reportFile: string;
  filesAnalyzed?: number;
  message: string;
}
