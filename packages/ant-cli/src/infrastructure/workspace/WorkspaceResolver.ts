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
  
  /**
   * Get physical workspaces directory path
   * Reads from WORKSPACES_PATH environment variable
   * Supports:
   * - Absolute paths: /Users/wag/dev/ant/workspaces
   * - Home directory: ~/dev/ant/workspaces
   * - Relative paths: ../../workspaces (not recommended)
   * Falls back to default relative path for development
   */
  getPhysicalWorkspacesPath(): string;
}

/**
 * Static utility for getting physical workspaces path
 */
export class WorkspacePathResolver {
  /**
   * Get physical workspaces directory path
   * This is the ONLY place that reads WORKSPACES_PATH env var
   */
  static getPhysicalWorkspacesPath(): string {
    const envPath = process.env.WORKSPACES_PATH;
    if (envPath) {
      // ✅ Handle tilde expansion
      let resolvedPath = envPath;
      if (envPath.startsWith('~/')) {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (!homeDir) {
          throw new Error('Cannot resolve ~: HOME environment variable not set');
        }
        resolvedPath = path.join(homeDir, envPath.slice(2));
      }
      
      // Convert to absolute path if relative
      return path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(process.cwd(), resolvedPath);
    }
    
    // Fallback: 개발 환경용 (server.ts 기준 상대 경로)
    // server.ts 위치: packages/ant-cli/src/composition/
    // workspaces 위치: workspaces/
    const defaultPath = path.resolve(__dirname, '../../../../workspaces');
    console.warn(`⚠️  WORKSPACES_PATH not set, using default: ${defaultPath}`);
    return defaultPath;
  }
}

/**
 * Local Mode Workspace Resolver
 * 
 * workspaces/local/user/<project>/features/<feature>
 */
export class LocalWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspacesPath: string) {}
  
  getWorkspacePath(context: UserContext): string {
    return path.join(this.workspacesPath, 'local', 'user');
  }
  
  getProjectPath(context: UserContext, projectId: string): string {
    return path.join(this.workspacesPath, 'local', 'user', projectId);
  }
  
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string {
    return path.join(this.workspacesPath, 'local', 'user', projectId, 'features', featureId);
  }
  
  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

/**
 * Cloud Mode Workspace Resolver
 * 
 * workspaces/<org>/<user>/<project>/features/<feature>
 */
export class CloudWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspacesPath: string) {}
  
  getWorkspacePath(context: UserContext): string {
    // ⚠️ Validate context in Cloud mode
    if (context.organizationId === 'local' || context.userId === 'local') {
      console.error(`[CloudWorkspaceResolver] ❌ Invalid context in Cloud mode:`, context);
      console.error(`   This indicates authentication failure. Check that cookies are being sent.`);
      throw new Error('Authentication required for Cloud mode. Please ensure cookies are enabled and user is authenticated.');
    }
    return path.join(this.workspacesPath, context.organizationId, context.userId);
  }
  
  getProjectPath(context: UserContext, projectId: string): string {
    if (context.organizationId === 'local' || context.userId === 'local') {
      console.error(`[CloudWorkspaceResolver] ❌ Invalid context in Cloud mode:`, context);
      throw new Error('Authentication required for Cloud mode.');
    }
    return path.join(this.workspacesPath, context.organizationId, context.userId, projectId);
  }
  
  getFeaturePath(context: UserContext, projectId: string, featureId: string): string {
    if (context.organizationId === 'local' || context.userId === 'local') {
      console.error(`[CloudWorkspaceResolver] ❌ Invalid context in Cloud mode:`, context);
      throw new Error('Authentication required for Cloud mode.');
    }
    return path.join(this.workspacesPath, context.organizationId, context.userId, projectId, 'features', featureId);
  }
  
  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

