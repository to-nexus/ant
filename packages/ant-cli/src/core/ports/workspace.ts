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
  storageType: 'local' | 's3' | 'nfs';
  storagePath: string;   // Physical path (opaque - do not access directly)
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
 * Mount point for job execution
 * Provides temporary local access to workspace
 */
export interface MountPoint {
  path: string;          // Local filesystem path
  expiresAt: Date;       // Auto-unmount time
  readonly: boolean;     // Read-only mount
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
   * Mount workspace to local filesystem (for job execution)
   * Used when spawning child processes that need direct file access.
   * @returns Mount point with local path
   */
  mountWorkspace(handle: WorkspaceHandle, readonly?: boolean): Promise<MountPoint>;
  
  /**
   * Unmount workspace
   * Cleanup temporary mounts and sync changes back to storage.
   */
  unmountWorkspace(mountPoint: MountPoint): Promise<void>;
  
  /**
   * List all workspaces for a tenant
   */
  listWorkspaces(tenantId: string): Promise<WorkspaceHandle[]>;
}
