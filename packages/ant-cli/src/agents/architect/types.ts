import { AgentTask as CoreAgentTask, CodeMode as CoreCodeMode, ProjectContext as CoreProjectContext } from "../../core/types";

export const DIRECTIVE_TYPES = {
  CODE: 'code',
  DESIGN: 'design',
  LEARN: 'learn'
} as const;

export type DirectiveType = typeof DIRECTIVE_TYPES[keyof typeof DIRECTIVE_TYPES];

// Re-export core types for backward compatibility
export type AgentTask = CoreAgentTask;
export type CodeMode = CoreCodeMode;

// Extend core ProjectContext with architect-specific fields
export interface ProjectContext extends CoreProjectContext {
  featureFolder: string;
  config: any;
  
  // ✅ UserContext information for path resolution
  userId?: string;
  organizationId?: string;
}

export interface ArchitectResult {
  success: boolean;
  status?: 'success' | 'paused' | 'partial';  // ✅ Explicit status for better clarity
  task: AgentTask;
  reportFile: string;
  filesAnalyzed?: number;
  interruption?: import('../../core/types').InterruptionDetails;  // ✅ Unified interruption details
  message: string;
}
