export const DIRECTIVE_TYPES = {
  CODE: 'code',
  DESIGN: 'design',
  LEARN: 'learn'
} as const;

export type DirectiveType = typeof DIRECTIVE_TYPES[keyof typeof DIRECTIVE_TYPES];
export type AgentMode = 'design' | 'code' | 'learn';

export interface ProjectContext {
  project: string;
  featureFolder: string;
  workingDir: string;
  config: any;
  memory: string;
}

export interface ArchitectResult {
  success: boolean;
  mode: AgentMode;
  reportFile: string;
  filesAnalyzed?: number;
  message: string;
}
