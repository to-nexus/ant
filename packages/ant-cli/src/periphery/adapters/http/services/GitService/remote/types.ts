import { UserContext } from '../../../../../../../core/types/user';

/**
 * Common types for Git remote operations
 */

export interface GitOperationContext {
  projectId: string;
  userContext: UserContext;
}

export interface GitOperationResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface ProjectConfig {
  githubRepo?: string;
  repoType?: 'local' | 'cloud';
  localPath?: string;
  branchBase?: string;
}

