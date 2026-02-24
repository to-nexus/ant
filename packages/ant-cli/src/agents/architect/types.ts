import { AgentJob as CoreAgentJob, JobMode, ProjectContext as CoreProjectContext, SessionTurn as CoreSessionTurn } from "../../core/types";

export const DIRECTIVE_TYPES = {
  CODE: 'code',
  DESIGN: 'design',
  LEARN: 'learn'
} as const;

export type DirectiveType = typeof DIRECTIVE_TYPES[keyof typeof DIRECTIVE_TYPES];

// Re-export core types
export type AgentJob = CoreAgentJob;
export type SessionTurn = CoreSessionTurn;
export { JobMode };

// Extend core ProjectContext with architect-specific fields
export interface ProjectContext extends CoreProjectContext {
  featureFolder: string;
  config?: any;  // ✅ Make optional to avoid JSON serialization issues
  projectPath?: string;     // ✅ Extracted from config.localPath
  repoType?: string;        // ✅ Extracted from config.repoType
  branchBase?: string;      // ✅ Extracted from config.branchBase (for learn node)
  
  // ✅ UserContext information for path resolution
  userId?: string;
  organizationId?: string;
}

export interface ArchitectResult {
  success: boolean;
  status?: 'success' | 'paused' | 'partial';  // ✅ Explicit status for better clarity
  job: AgentJob;
  reportFile?: string;  // Only for code jobs (report.md)
  filesAnalyzed?: number;
  interruption?: import('../../core/types').InterruptionDetails;  // ✅ Unified interruption details
  message: string;
}
