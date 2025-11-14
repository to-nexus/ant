/**
 * Workspace Port
 * 
 * 사용자별 작업 공간 경로 관리를 위한 인터페이스
 */

export interface WorkspacePort {
  /**
   * 사용자의 workspace 루트 경로 반환
   * @example workspaces/nexus/alice
   */
  getUserWorkspacePath(organizationId: string, userId: string): string;
  
  /**
   * 프로젝트 경로 반환
   * @example workspaces/nexus/alice/my-project
   */
  getProjectPath(org: string, user: string, project: string): string;
  
  /**
   * 피처 경로 반환
   * @example workspaces/nexus/alice/my-project/features/auth-system
   */
  getFeaturePath(org: string, user: string, project: string, feature: string): string;
  
  /**
   * Artifacts 경로 반환
   * @example workspaces/nexus/alice/my-project/features/auth-system/artifacts
   */
  getArtifactsPath(org: string, user: string, project: string, feature: string): string;
  
  /**
   * 코드베이스 경로 반환
   * @example workspaces/nexus/alice/my-project/codebase
   */
  getCodebasePath(org: string, user: string, project: string): string;
  
  /**
   * Config 파일 경로 반환
   * @example workspaces/nexus/alice/my-project/config.json
   */
  getConfigPath(org: string, user: string, project: string): string;
  
  /**
   * 경로 보안 검증 (Path Traversal 방지)
   */
  validatePath(basePath: string, targetPath: string): boolean;
}

