/**
 * WorkspacePort
 * 
 * Multi-tenant workspace management interface.
 * Provides isolated file systems for each tenant/project.
 */

import { FileSystemPort } from './filesystem';

/**
 * Workspace handle - opaque identifier for a workspace
 */
export interface WorkspaceHandle {
  tenantId: string;      // Organization:User (e.g., "acme:alice")
  projectId: string;     // Project name
  storageType: 'local' | 'efs';  // local (dev) or efs (cloud)
  storagePath: string;   // Physical path for direct access
}

/**
 * Workspace metadata
 */
export interface WorkspaceInfo {
  handle: WorkspaceHandle;
  createdAt: Date;
  lastAccessedAt: Date;
  sizeBytes: number;
}

/**
 * Workspace Service Port
 * 
 * Manages tenant workspaces and provides isolated file systems.
 */
export interface WorkspaceServicePort {
  /**
   * Create or get workspace for tenant/project
   * @returns Workspace handle
   */
  createWorkspace(tenantId: string, projectId: string): Promise<WorkspaceHandle>;
  
  /**
   * Delete workspace and all contents
   * ⚠️ Destructive operation
   */
  deleteWorkspace(tenantId: string, projectId: string): Promise<void>;
  
  /**
   * Get FileSystemPort for workspace
   * This is the primary way to access workspace files.
   * @returns Isolated FileSystemPort scoped to this workspace
   */
  getFileSystem(handle: WorkspaceHandle): FileSystemPort;
  
  /**
   * Get workspace metadata
   */
  getWorkspaceInfo(handle: WorkspaceHandle): Promise<WorkspaceInfo>;
  
  /**
   * List all workspaces for a tenant
   */
  listWorkspaces(tenantId: string): Promise<WorkspaceHandle[]>;
}
