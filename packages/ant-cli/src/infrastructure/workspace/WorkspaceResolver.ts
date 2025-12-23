/**
 * Workspace Resolver
 * 
 * Local/Cloud 모드에 따라 workspace 경로를 계산하는 인터페이스
 */

import * as path from 'path';
import { UserContext } from '../../core/types/user';

export interface WorkspaceResolver {
  /**
   * workspace 루트 경로 반환
   * @param userContext Local 모드에서는 무시됨, Cloud 모드에서는 검증용으로 사용
   */
  getWorkspacePath(userContext: UserContext): string;
  
  /**
   * 프로젝트 경로 반환
   * @param userContext Local 모드에서는 무시됨, Cloud 모드에서는 검증용으로 사용
   */
  getProjectPath(userContext: UserContext, projectId: string): string;
  
  /**
   * 피처 경로 반환
   * @param userContext Local 모드에서는 무시됨, Cloud 모드에서는 검증용으로 사용
   */
  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string;
  
  /**
   * Get physical workspaces directory path
   */
  getPhysicalWorkspacesPath(): string;
}

/**
 * Static utility for getting physical workspaces path
 */
export class WorkspacePathResolver {
  /**
   * Get physical workspaces directory path
   * ✅ NEW: Supports ANT_WORKSPACE_BASE_PATH for physical separation
   */
  static getPhysicalWorkspacesPath(): string {
    // ⭐ 환경변수로 물리적 위치 결정 (ant 소스와 분리 가능)
    if (process.env.ANT_WORKSPACE_BASE_PATH) {
      return path.resolve(process.env.ANT_WORKSPACE_BASE_PATH);
    }
    
    // Fallback: 기존 방식 (ant 소스 내부)
    const projectRoot = path.resolve(__dirname, '../../../../..');
    return path.join(projectRoot, 'workspaces');
  }
  
  /**
   * Helper: Resolve feature path from context
   * Extracts UserContext from ProjectContext and calls WorkspaceResolver
   * 
   * @param context ProjectContext with userId, organizationId
   * @param resolver WorkspaceResolver instance
   * @returns Feature path
   */
  static resolveFeaturePath(
    context: { project: string; featureFolder: string; userId?: string; organizationId?: string; featurePath?: string; workspaceResolver?: WorkspaceResolver },
    resolver?: WorkspaceResolver
  ): string {
    // ✅ Use cached featurePath if available (performance)
    if (context.featurePath) {
      return context.featurePath;
    }
    
    // ✅ Use provided resolver or extract from context
    const workspaceResolver = resolver || (context as any).workspaceResolver;
    if (!workspaceResolver) {
      // ⚠️ Fallback: construct ABSOLUTE path (assumes Local mode)
      console.warn('[WorkspacePathResolver.resolveFeaturePath] No resolver available, using fallback');
      const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
      return path.join(workspacesPath, 'local', 'user', context.project, 'features', context.featureFolder);
    }
    
    // ✅ Build UserContext from ProjectContext
    const userContext: UserContext = {
      userId: context.userId || 'local',
      organizationId: context.organizationId || 'local',
      workspacePath: ''
    };
    
    return workspaceResolver.getFeaturePath(userContext, context.project, context.featureFolder);
  }
  
}


/**
 * Local Mode Workspace Resolver
 * 
 * 구조: workspaces/local/user/<project>/features/<feature>
 * Local 모드에서는 단일 사용자이므로 UserContext 무시
 */
export class LocalWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspacesPath: string) {}
  
  getWorkspacePath(userContext: UserContext): string {
    // Local 모드에서는 userContext 무시
    return path.join(this.workspacesPath, 'local', 'user');
  }
  
  getProjectPath(userContext: UserContext, projectId: string): string {
    // Local 모드에서는 userContext 무시
    return path.join(this.workspacesPath, 'local', 'user', projectId);
  }
  
  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string {
    // Local 모드에서는 userContext 무시
    return path.join(this.workspacesPath, 'local', 'user', projectId, 'features', featureId);
  }
  
  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

/**
 * Cloud Mode Workspace Resolver
 * 
 * 구조: workspaces/<org>/<user>/<project>/features/<feature>
 * Cloud 모드에서는 요청마다 UserContext 검증
 */
export class CloudWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspacesPath: string) {}
  
  private validateContext(userContext: UserContext): void {
    if (!userContext || userContext.organizationId === 'local' || userContext.userId === 'local') {
      console.error(`[CloudWorkspaceResolver] ❌ Invalid context in Cloud mode:`, userContext);
      console.error(`   This indicates authentication failure. Check that cookies are being sent.`);
      throw new Error('Authentication required for Cloud mode. Please ensure cookies are enabled and user is authenticated.');
    }
  }
  
  getWorkspacePath(userContext: UserContext): string {
    this.validateContext(userContext);
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId);
  }
  
  getProjectPath(userContext: UserContext, projectId: string): string {
    this.validateContext(userContext);
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId, projectId);
  }
  
  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string {
    this.validateContext(userContext);
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId, projectId, 'features', featureId);
  }
  
  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

