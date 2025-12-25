/**
 * WorkspaceServiceAdapter
 * 
 * Adapter that wraps WorkspaceServicePort to provide WorkspaceResolver interface
 * This allows gradual migration from WorkspaceResolver to WorkspaceService
 */

import * as path from 'path';
import { WorkspaceResolver } from './WorkspaceResolver';
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

  getPhysicalWorkspacesPath(): string {
    return this.basePath;
  }
}

