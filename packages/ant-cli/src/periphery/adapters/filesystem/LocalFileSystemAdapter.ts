/**
 * LocalFileSystemAdapter
 * 
 * Local filesystem implementation of FileSystemPort.
 * Provides isolated file access scoped to a base directory.
 * 
 * Security features:
 * - Path traversal protection
 * - Workspace isolation
 * - Relative path enforcement
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob as globCallback } from 'glob';
import { promisify } from 'util';
import { FileSystemPort } from '../../../core/ports/filesystem';

const glob = promisify(globCallback);

export class LocalFileSystemAdapter implements FileSystemPort {
  private readonly basePath: string;
  
  constructor(basePath: string) {
    // Normalize base path (remove trailing slash, resolve absolute)
    this.basePath = path.resolve(basePath);
    
    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }
  
  /**
   * Resolve relative path to absolute path within workspace
   * @throws Error if path traversal detected
   */
  private resolvePath(relativePath: string): string {
    // Remove leading slash (enforce relative paths)
    const cleanPath = relativePath.startsWith('/') 
      ? relativePath.substring(1) 
      : relativePath;
    
    // Resolve to absolute path
    const fullPath = path.resolve(this.basePath, cleanPath);
    
    // Security check: prevent path traversal
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error(
        `Path traversal detected: "${relativePath}" resolves outside workspace. ` +
        `Workspace: ${this.basePath}, Requested: ${fullPath}`
      );
    }
    
    return fullPath;
  }
  
  async readFile(relativePath: string): Promise<string | null> {
    try {
      const fullPath = this.resolvePath(relativePath);
      return await fs.promises.readFile(fullPath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;  // File not found
      }
      throw error;
    }
  }
  
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    
    // Ensure parent directory exists
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }
  
  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(relativePath);
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
  
  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    
    try {
      await fs.promises.unlink(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - no-op
        return;
      }
      throw error;
    }
  }
  
  async readDirectory(relativePath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const fullPath = this.resolvePath(relativePath);
    
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory()
    }));
  }
  
  async createDirectory(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.promises.mkdir(fullPath, { recursive: true });
  }
  
  async listFiles(relativePath: string, exclude: string[] = []): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath);
    
    // Build glob pattern
    const pattern = path.join(fullPath, '**/*');
    
    // Default excludes
    const defaultExcludes = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
    ];
    
    const allExcludes = [...defaultExcludes, ...exclude];
    
    // Find all files
    const files: string[] = await glob(pattern, {
      ignore: allExcludes,
      nodir: true,  // Only files, not directories
      dot: false,   // Exclude hidden files
    }) as string[];
    
    // Convert to relative paths
    return files.map((file: string) => path.relative(this.basePath, file));
  }
  
  getWorkspaceRoot(): string {
    return this.basePath;
  }
}

