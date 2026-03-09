/**
 * WorkspaceServiceAdapter
 * 
 * Adapter that wraps WorkspaceServicePort to provide WorkspaceResolver interface
 * This allows gradual migration from WorkspaceResolver to WorkspaceService
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver, resolveLocalPath } from './WorkspaceResolver';
import { WorkspaceServicePort } from '../../core/ports/workspace';
import { UserContext } from '../../core/types/user';

export class WorkspaceServiceAdapter implements WorkspaceResolver {
  constructor(
    private readonly workspaceService: WorkspaceServicePort,
    private readonly basePath: string
  ) {}

  getWorkspacePath(userContext: UserContext): string {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    // Return base path for workspace (parent of project)
    return path.join(this.basePath, tenantId.replace(':', '/'));
  }

  getProjectPath(userContext: UserContext, projectId: string): string {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    // ✅ CRITICAL: Replace colon with slash for proper directory structure
    const sanitizedTenantId = tenantId.replace(':', '/');
    return path.join(this.basePath, sanitizedTenantId, projectId);
  }

  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string {
    return path.join(this.getProjectPath(userContext, projectId), 'features', featureId);
  }

  getCodebasePath(userContext: UserContext, projectId: string, featureId?: string): string {
    const projectPath = this.getProjectPath(userContext, projectId);
    
    // Read project config for repoType and branchBase
    let branchBase = 'main';
    const configPath = path.join(projectPath, 'config.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.repoType === 'local' && config.localPath) {
          return resolveLocalPath(config.localPath);
        }
        if (config.branchBase) {
          branchBase = config.branchBase;
        }
      }
    } catch {
      // Config read failed, fall through to default
    }
    
    // For features (not base branch), return the feature's worktree codebase path
    if (featureId && featureId.toLowerCase() !== branchBase.toLowerCase()) {
      const featurePath = this.getFeaturePath(userContext, projectId, featureId);
      return path.join(featurePath, 'codebase');
    }
    
    // Default: base branch codebase in project root
    return path.join(projectPath, 'codebase');
  }

  getPhysicalWorkspacesPath(): string {
    return this.basePath;
  }
}

