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
 * - Accepts both relative and absolute paths (absolute must be within workspace)
 * 
 * Works with any POSIX-compatible filesystem (local, EFS).
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
   * Resolve input path to absolute path within workspace.
   * Accepts both relative paths and absolute paths within the workspace boundary.
   * @throws Error if path resolves outside workspace (traversal protection)
   */
  private resolvePath(inputPath: string): string {
    // Absolute path: validate it's within workspace
    if (path.isAbsolute(inputPath)) {
      const normalized = path.normalize(inputPath);
      if (normalized === this.basePath || normalized.startsWith(this.basePath + path.sep)) {
        return normalized;
      }
      throw new Error(
        `Path traversal detected: "${inputPath}" resolves outside workspace. ` +
        `Workspace: ${this.basePath}, Requested: ${normalized}`
      );
    }
    
    // Relative path: resolve against basePath
    const fullPath = path.resolve(this.basePath, inputPath);
    
    // Security check: prevent path traversal (e.g., "../../../etc/passwd")
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error(
        `Path traversal detected: "${inputPath}" resolves outside workspace. ` +
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
  
  async isDirectory(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(relativePath);
      const stat = await fs.promises.stat(fullPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
  
  async copyFile(src: string, dest: string, overwrite = true): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    
    // Check source exists
    try {
      await fs.promises.access(srcPath);
    } catch {
      throw new Error(`Source file not found: ${src}`);
    }
    
    // Check overwrite
    if (!overwrite) {
      try {
        await fs.promises.access(destPath);
        throw new Error(`Destination file already exists: ${dest}`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        // ENOENT = file doesn't exist, proceed
      }
    }
    
    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    
    // Binary-safe copy using fs.promises.copyFile
    const flags = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
    await fs.promises.copyFile(srcPath, destPath, flags);
  }
  
  async moveFile(src: string, dest: string, overwrite = true): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    
    // Check source exists
    try {
      await fs.promises.access(srcPath);
    } catch {
      throw new Error(`Source file not found: ${src}`);
    }
    
    // Check overwrite
    if (!overwrite) {
      try {
        await fs.promises.access(destPath);
        throw new Error(`Destination file already exists: ${dest}`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    
    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    
    try {
      // Try atomic rename (works on same filesystem/mount)
      await fs.promises.rename(srcPath, destPath);
    } catch (error: any) {
      // EXDEV = cross-device link, fall back to copy + delete
      if (error.code === 'EXDEV') {
        await fs.promises.copyFile(srcPath, destPath);
        await fs.promises.unlink(srcPath);
      } else {
        throw error;
      }
    }
  }
  
  async copyDirectory(src: string, dest: string): Promise<void> {
    const srcPath = this.resolvePath(src);
    const destPath = this.resolvePath(dest);
    
    // Verify source is a directory
    const srcStat = await fs.promises.stat(srcPath);
    if (!srcStat.isDirectory()) {
      throw new Error(`Source is not a directory: ${src}`);
    }
    
    // Ensure destination directory exists
    await fs.promises.mkdir(destPath, { recursive: true });
    
    // Recursive merge: iterate source entries, preserve dest-only entries
    const entries = await fs.promises.readdir(srcPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcEntryPath = path.join(srcPath, entry.name);
      const destEntryPath = path.join(destPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursive merge for subdirectories
        await this.copyDirectory(
          path.relative(this.basePath, srcEntryPath),
          path.relative(this.basePath, destEntryPath)
        );
      } else {
        // Overwrite file (binary-safe)
        await fs.promises.copyFile(srcEntryPath, destEntryPath);
      }
    }
  }
  
  async moveDirectory(src: string, dest: string): Promise<void> {
    // Merge copy first, then remove source
    await this.copyDirectory(src, dest);
    
    const srcPath = this.resolvePath(src);
    await fs.promises.rm(srcPath, { recursive: true, force: true });
  }
  
  getRootPath(): string {
    return this.basePath;
  }

  /** @deprecated Use getRootPath() instead */
  getWorkspaceRoot(): string {
    return this.getRootPath();
  }
}
