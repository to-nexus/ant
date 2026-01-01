import { UserContext } from '../../../../../../core/types/user';
import { EnvironmentDetection } from '../../../../../../core/types/environment';

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
  environment?: EnvironmentDetection;  // ✅ 환경 감지 결과 저장
}

