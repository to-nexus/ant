export const DIRECTIVE_TYPES = {
  CODE: 'code',
  DESIGN: 'design',
  LEARN: 'learn'
} as const;

export type DirectiveType = typeof DIRECTIVE_TYPES[keyof typeof DIRECTIVE_TYPES];

// Task: What to produce (design doc, code, or learning data)
export type AgentTask = 'design' | 'code' | 'learn';

// Mode: How to perform the task (for code task)
export type CodeMode = 'generate' | 'edit' | 'refactor' | 'explain';

export interface ProjectContext {
  project: string;
  featureFolder: string;
  workingDir: string;
  config: any;
  memory: string;
}

export interface ArchitectResult {
  success: boolean;
  task: AgentTask;
  reportFile: string;
  filesAnalyzed?: number;
  message: string;
}
