/**
 * Workspace Service
 * 
 * 사용자별 작업 공간 경로 관리
 * Path Traversal 공격 방지
 */

import * as path from 'path';
import { WorkspacePort } from '../../core/ports/workspace';
import { WorkspaceResolver, LocalWorkspaceResolver, WorkspacePathResolver } from './WorkspaceResolver';

export class WorkspaceService implements WorkspacePort {
  private readonly workspaceResolver: WorkspaceResolver;
  
  /**
   * @param workspaceRoot - 작업 공간 루트 디렉토리 (예: /path/to/workspaces)
   */
  constructor(workspaceRoot: string) {
    // Use WorkspacePathResolver to get the correct workspaces path
    const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
    this.workspaceResolver = new LocalWorkspaceResolver(workspacesPath);
  }
  
  /**
   * 사용자의 workspace 루트 경로
   * @example workspaces/nexus/alice
   */
  getUserWorkspacePath(organizationId: string, userId: string): string {
    this.validateIdentifier(organizationId, 'organizationId');
    this.validateIdentifier(userId, 'userId');
    return this.workspaceResolver.getWorkspacePath({ organizationId, userId, workspacePath: '' });
  }
  
  /**
   * 프로젝트 경로
   * @example workspaces/nexus/alice/my-project
   */
  getProjectPath(org: string, user: string, project: string): string {
    this.validateIdentifier(org, 'organizationId');
    this.validateIdentifier(user, 'userId');
    this.validateIdentifier(project, 'projectId');
    return this.workspaceResolver.getProjectPath({ organizationId: org, userId: user, workspacePath: '' }, project);
  }
  
  /**
   * 피처 경로
   * @example workspaces/nexus/alice/my-project/features/auth-system
   */
  getFeaturePath(org: string, user: string, project: string, feature: string): string {
    this.validateIdentifier(org, 'organizationId');
    this.validateIdentifier(user, 'userId');
    this.validateIdentifier(project, 'projectId');
    this.validateIdentifier(feature, 'featureId');
    return this.workspaceResolver.getFeaturePath({ organizationId: org, userId: user, workspacePath: '' }, project, feature);
  }
  
  /**
   * Artifacts 경로
   * @example workspaces/nexus/alice/my-project/features/auth-system/artifacts
   */
  getArtifactsPath(org: string, user: string, project: string, feature: string): string {
    const featurePath = this.getFeaturePath(org, user, project, feature);
    return `${featurePath}/artifacts`;
  }
  
  /**
   * 코드베이스 경로
   * @example workspaces/nexus/alice/my-project/codebase
   */
  getCodebasePath(org: string, user: string, project: string): string {
    const projectPath = this.getProjectPath(org, user, project);
    return `${projectPath}/codebase`;
  }
  
  /**
   * Config 파일 경로
   * @example workspaces/nexus/alice/my-project/config.json
   */
  getConfigPath(org: string, user: string, project: string): string {
    const projectPath = this.getProjectPath(org, user, project);
    return `${projectPath}/config.json`;
  }
  
  /**
   * 경로 보안 검증 (Path Traversal 방지)
   * 
   * @param basePath - 기준 경로
   * @param targetPath - 검증할 경로
   * @returns targetPath가 basePath 내부에 있으면 true
   * 
   * @example
   * validatePath('/workspace/nexus/alice', '/workspace/nexus/alice/project-a') → true
   * validatePath('/workspace/nexus/alice', '/workspace/nexus/bob/project-b') → false
   * validatePath('/workspace/nexus/alice', '/workspace/nexus/alice/../bob') → false
   */
  validatePath(basePath: string, targetPath: string): boolean {
    const normalizedBase = path.resolve(basePath);
    const normalizedTarget = path.resolve(targetPath);
    
    // targetPath가 basePath로 시작하는지 확인
    return normalizedTarget.startsWith(normalizedBase + path.sep) || 
           normalizedTarget === normalizedBase;
  }
  
  // ========================================
  // Private Methods
  // ========================================
  
  /**
   * Identifier 보안 검증
   * - Path traversal 방지 (.., /, \)
   * - 특수문자 제한
   */
  private validateIdentifier(identifier: string, fieldName: string): void {
    if (!identifier || identifier.trim() === '') {
      throw new Error(`${fieldName} cannot be empty`);
    }
    
    // Path traversal 패턴 검사
    if (identifier.includes('..') || 
        identifier.includes('/') || 
        identifier.includes('\\')) {
      throw new Error(`${fieldName} contains invalid characters: ${identifier}`);
    }
    
    // 허용된 문자만 사용 (영문, 숫자, 하이픈, 언더스코어)
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(identifier)) {
      throw new Error(`${fieldName} must contain only alphanumeric characters, hyphens, and underscores: ${identifier}`);
    }
  }
}

