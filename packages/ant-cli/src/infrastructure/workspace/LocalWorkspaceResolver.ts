/**
 * Local Workspace Resolver
 * 
 * Implementation for local file system workspace resolution
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { WorkspaceResolver } from './WorkspaceResolver';
import { UserContext } from '../../core/types/user';

// ESM: derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LocalWorkspaceResolver implements WorkspaceResolver {
  private workspacesPath: string;

  constructor(workspacesPath?: string) {
    // Use provided path or default to project root
    if (workspacesPath) {
      this.workspacesPath = workspacesPath;
    } else {
      // Get workspaces directory (5 levels up from dist/infrastructure/workspace)
      const projectRoot = path.resolve(__dirname, '../../../../..');
      this.workspacesPath = path.join(projectRoot, 'workspaces');
    }
  }

  getWorkspacePath(userContext: UserContext): string {
    // For local mode, use 'local' organization
    return path.join(this.workspacesPath, 'local', 'user');
  }

  getProjectPath(userContext: UserContext, projectId: string): string {
    return path.join(this.getWorkspacePath(userContext), projectId);
  }

  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string {
    return path.join(this.getProjectPath(userContext, projectId), 'features', featureId);
  }

  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

