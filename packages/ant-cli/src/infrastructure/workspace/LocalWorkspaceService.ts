/**
 * LocalWorkspaceService
 * 
 * Local filesystem-based workspace service implementation.
 * Manages multi-tenant workspaces on local disk.
 * 
 * Structure:
 *   <basePath>/<tenantId>/<projectId>/
 *     ├── config.json
 *     ├── codebase/        (Git repository)
 *     └── features/
 *         └── <feature>/
 *             ├── inputs/
 *             ├── outputs/
 *             └── sessions/
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  WorkspaceServicePort, 
  WorkspaceHandle, 
  WorkspaceInfo, 
  MountPoint 
} from '../../core/ports/workspace';
import { FileSystemPort } from '../../core/ports/filesystem';
import { LocalFileSystemAdapter } from '../../periphery/adapters/filesystem/LocalFileSystemAdapter';

export class LocalWorkspaceService implements WorkspaceServicePort {
  private readonly basePath: string;
  private readonly fileSystemCache: Map<string, FileSystemPort>;
  
  /**
   * @param basePath - Root directory for all workspaces (e.g., /mnt/workspaces)
   */
  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    this.fileSystemCache = new Map();
    
    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
      console.log(`[LocalWorkspaceService] Created workspace base: ${this.basePath}`);
    }
  }
  
  /**
   * Generate cache key for FileSystemPort instances
   */
  private getCacheKey(handle: WorkspaceHandle): string {
    return `${handle.tenantId}:${handle.projectId}`;
  }
  
  /**
   * Validate tenant/project identifiers
   * Prevent path traversal and injection attacks
   */
  private validateIdentifier(id: string, name: string): void {
    if (!id || id.trim() === '') {
      throw new Error(`${name} cannot be empty`);
    }
    
    // Check for path traversal
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error(`${name} contains invalid characters: ${id}`);
    }
    
    // Only allow alphanumeric, hyphen, underscore, colon
    const validPattern = /^[a-zA-Z0-9_:-]+$/;
    if (!validPattern.test(id)) {
      throw new Error(`${name} must contain only alphanumeric characters, hyphens, underscores, or colons: ${id}`);
    }
  }
  
  /**
   * Get workspace directory path
   */
  private getWorkspacePath(tenantId: string, projectId: string): string {
    return path.join(this.basePath, tenantId, projectId);
  }
  
  async createWorkspace(tenantId: string, projectId: string): Promise<WorkspaceHandle> {
    this.validateIdentifier(tenantId, 'tenantId');
    this.validateIdentifier(projectId, 'projectId');
    
    const workspacePath = this.getWorkspacePath(tenantId, projectId);
    
    // Create workspace structure
    if (!fs.existsSync(workspacePath)) {
      await fs.promises.mkdir(workspacePath, { recursive: true });
      
      // Create standard subdirectories
      await fs.promises.mkdir(path.join(workspacePath, 'features'), { recursive: true });
      await fs.promises.mkdir(path.join(workspacePath, 'codebase'), { recursive: true });
      
      console.log(`[LocalWorkspaceService] Created workspace: ${tenantId}/${projectId}`);
    }
    
    return {
      tenantId,
      projectId,
      storageType: 'local',
      storagePath: workspacePath
    };
  }
  
  async deleteWorkspace(tenantId: string, projectId: string): Promise<void> {
    this.validateIdentifier(tenantId, 'tenantId');
    this.validateIdentifier(projectId, 'projectId');
    
    const workspacePath = this.getWorkspacePath(tenantId, projectId);
    
    if (fs.existsSync(workspacePath)) {
      await fs.promises.rm(workspacePath, { recursive: true, force: true });
      console.log(`[LocalWorkspaceService] Deleted workspace: ${tenantId}/${projectId}`);
    }
    
    // Remove from cache
    const cacheKey = this.getCacheKey({ tenantId, projectId } as WorkspaceHandle);
    this.fileSystemCache.delete(cacheKey);
  }
  
  getFileSystem(handle: WorkspaceHandle): FileSystemPort {
    const cacheKey = this.getCacheKey(handle);
    
    // Check cache
    let fileSystem = this.fileSystemCache.get(cacheKey);
    
    if (!fileSystem) {
      // Create new FileSystemPort scoped to this workspace
      fileSystem = new LocalFileSystemAdapter(handle.storagePath);
      this.fileSystemCache.set(cacheKey, fileSystem);
    }
    
    return fileSystem;
  }
  
  async getWorkspaceInfo(handle: WorkspaceHandle): Promise<WorkspaceInfo> {
    const stats = await fs.promises.stat(handle.storagePath);
    
    // Calculate workspace size (recursive)
    const size = await this.calculateDirectorySize(handle.storagePath);
    
    return {
      handle,
      createdAt: stats.birthtime,
      lastAccessedAt: stats.atime,
      sizeBytes: size
    };
  }
  
  /**
   * Calculate total size of directory recursively
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await this.calculateDirectorySize(fullPath);
      } else {
        const stats = await fs.promises.stat(fullPath);
        totalSize += stats.size;
      }
    }
    
    return totalSize;
  }
  
  async mountWorkspace(handle: WorkspaceHandle, readonly: boolean = false): Promise<MountPoint> {
    // For local filesystem, mounting is a no-op (already local)
    // Just return the path directly
    
    return {
      path: handle.storagePath,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours
      readonly
    };
  }
  
  async unmountWorkspace(mountPoint: MountPoint): Promise<void> {
    // For local filesystem, unmounting is a no-op
    // No cleanup needed
  }
  
  async listWorkspaces(tenantId: string): Promise<WorkspaceHandle[]> {
    this.validateIdentifier(tenantId, 'tenantId');
    
    const tenantPath = path.join(this.basePath, tenantId);
    
    if (!fs.existsSync(tenantPath)) {
      return [];
    }
    
    const projects = await fs.promises.readdir(tenantPath, { withFileTypes: true });
    
    const handles: WorkspaceHandle[] = [];
    
    for (const project of projects) {
      if (project.isDirectory()) {
        handles.push({
          tenantId,
          projectId: project.name,
          storageType: 'local',
          storagePath: path.join(tenantPath, project.name)
        });
      }
    }
    
    return handles;
  }
}

