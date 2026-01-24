/**
 * FileSystemAdapter
 * 
 * POSIX-compatible filesystem implementation of FileSystemPort.
 * Works with local filesystem and AWS EFS (any POSIX mount).
 * Provides isolated file access scoped to a base directory.
 * 
 * Security features:
 * - Path traversal protection
 * - Workspace isolation
 * - Relative path enforcement
 * 
 * Note: Previously named LocalFileSystemAdapter. Renamed because it works
 * with any POSIX-compatible filesystem (local, EFS), not just local.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileSystemPort } from '../../../core/ports/filesystem';

export class FileSystemAdapter implements FileSystemPort {
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
    
    // Default excludes
    const defaultExcludes = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
    ];
    
    const allExcludes = [...defaultExcludes, ...exclude];
    
    // ✅ Use direct fs.readdirSync (faster and more reliable than glob)
    const results: string[] = [];
    
    const walk = (currentPath: string) => {
      try {
        if (!fs.existsSync(currentPath)) return;
        
        const stat = fs.statSync(currentPath);
        if (!stat.isDirectory()) {
          // If it's a file, add it
          results.push(path.relative(this.basePath, currentPath));
          return;
        }
        
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip hidden files and excluded directories
          if (entry.name.startsWith('.')) continue;
          
          const fullEntryPath = path.join(currentPath, entry.name);
          const relativeEntryPath = path.relative(fullPath, fullEntryPath);
          
          // Check if this path should be excluded
          const shouldExclude = allExcludes.some(pattern => {
            // Simple pattern matching (exact name or contains)
            return relativeEntryPath.includes(pattern) || entry.name === pattern;
          });
          
          if (shouldExclude) continue;
          
          if (entry.isDirectory()) {
            walk(fullEntryPath);
          } else {
            results.push(path.relative(this.basePath, fullEntryPath));
          }
        }
      } catch (error) {
        // Skip directories that can't be read
        return;
      }
    };
    
    walk(fullPath);
    return results;
  }
  
  getWorkspaceRoot(): string {
    return this.basePath;
  }
}

// ✅ Backward compatibility alias (deprecated)
/** @deprecated Use FileSystemAdapter instead */
export const LocalFileSystemAdapter = FileSystemAdapter;
