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

