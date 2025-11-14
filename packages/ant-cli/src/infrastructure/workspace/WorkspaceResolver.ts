/**
 * Workspace Resolver
 * 
 * Local/Cloud 모드에 따라 workspace 경로를 계산하는 인터페이스
 */

import * as path from 'path';
import { UserContext } from '../../core/types/user';

export interface WorkspaceResolver {
  /**
   * 사용자 컨텍스트를 기반으로 workspace 루트 경로 반환
   */
  getWorkspacePath(context: UserContext): string;
  
  /**
   * 프로젝트 경로 반환
   */
  getProjectPath(context: UserContext, projectId: string): string;
  
  /**
   * 피처 경로 반환
   */
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string;
}

/**
 * Local Mode Workspace Resolver
 * 
 * workspaces/local/<project>
 */
export class LocalWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspaceRoot: string) {}
  
  getWorkspacePath(context: UserContext): string {
    return path.join(this.workspaceRoot, 'local');
  }
  
  getProjectPath(context: UserContext, projectId: string): string {
    return path.join(this.workspaceRoot, 'local', projectId);
  }
  
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string {
    return path.join(this.workspaceRoot, 'local', projectId, featureId);
  }
}

/**
 * Cloud Mode Workspace Resolver
 * 
 * workspaces/<org>/<user>/<project>
 */
export class CloudWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspaceRoot: string) {}
  
  getWorkspacePath(context: UserContext): string {
    return path.join(this.workspaceRoot, context.organizationId, context.userId);
  }
  
  getProjectPath(context: UserContext, projectId: string): string {
    return path.join(this.workspaceRoot, context.organizationId, context.userId, projectId);
  }
  
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string {
    return path.join(this.workspaceRoot, context.organizationId, context.userId, projectId, featureId);
  }
}

