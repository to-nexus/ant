/**
 * Git Port
 * Interface for Git operations and file system access
 * 
 * Note: Includes file system operations to maintain Hexagonal Architecture
 * (Application layer should not depend on Node.js 'fs' module directly)
 */

export interface GitPort {
  // Git operations
  getRepoRoot(): Promise<string>;
  createBranch(name: string, base: string): Promise<void>;
  getChangedFiles(): Promise<string[]>;
  hasChanges(): Promise<boolean>;  // Check if working tree has changes
  getHeadFile(path: string): Promise<string | null>;
  diff(): Promise<string[]>;  // Legacy compatibility
  show(args: string[]): Promise<string>;  // Legacy compatibility
  status(): Promise<{ files: Array<{ path: string }> }>;  // Legacy compatibility
  
  // GitHub integration
  clone(url: string, targetPath: string, options?: { depth?: number }): Promise<void>;
  fetch(remote?: string): Promise<void>;
  pull(remote?: string, branch?: string): Promise<void>;
  push(remote?: string, branch?: string, options?: { setUpstream?: boolean; force?: boolean }): Promise<void>;
  commit(message: string, files?: string[]): Promise<void>;
  stage(files: string[]): Promise<void>;  // git add
  unstage(files: string[]): Promise<void>;  // git reset
  getCurrentBranch(): Promise<string>;
  getBranches(options?: { remote?: boolean }): Promise<string[]>;
  checkoutBranch(branch: string, options?: { create?: boolean }): Promise<void>;
  getRemotes(): Promise<Array<{ name: string; url: string }>>;
  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  setRemoteUrl(name: string, url: string): Promise<void>;
  
  // File system operations (Hexagonal Architecture compliance)
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
  readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  createDirectory(path: string): Promise<void>;
  
  /**
   * List all files in directory recursively
   * @param path - Directory path (relative to repo root)
   * @param exclude - Glob patterns to exclude (e.g., ['node_modules', '*.test.ts'])
   * @returns Array of file paths relative to repo root
   */
  listFiles(path: string, exclude?: string[]): Promise<string[]>;
}

