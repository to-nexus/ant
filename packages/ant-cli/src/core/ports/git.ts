/**
 * Git Port
 * 
 * Pure Git operations interface.
 * 
 * ⚠️ BREAKING CHANGE: File system operations removed.
 * Use FileSystemPort for file I/O operations.
 * 
 * This separation maintains Single Responsibility Principle:
 * - GitPort: Git version control operations only
 * - FileSystemPort: File read/write/list operations
 */

export interface GitPort {
  // Repository info
  getRepoRoot(): Promise<string>;
  getRepoName(): Promise<string>;
  
  // Branch operations
  createBranch(name: string, base: string): Promise<void>;
  getCurrentBranch(): Promise<string>;
  checkoutBranch(branch: string, options?: { create?: boolean }): Promise<void>;
  getBranches(options?: { remote?: boolean }): Promise<string[]>;
  
  // Working tree
  getChangedFiles(): Promise<string[]>;
  hasChanges(): Promise<boolean>;
  status(): Promise<{ files: Array<{ path: string }> }>;
  
  // History
  getCurrentCommit(): Promise<string>;
  getHeadFile(path: string): Promise<string | null>;  // Get file content from HEAD (Git history)
  diff(): Promise<string[]>;
  show(args: string[]): Promise<string>;
  
  // Staging
  stage(files: string[]): Promise<void>;
  unstage(files: string[]): Promise<void>;
  commit(message: string, files?: string[]): Promise<void>;
  
  // Remote operations
  clone(url: string, targetPath: string, options?: { depth?: number }): Promise<void>;
  fetch(remote?: string): Promise<void>;
  pull(remote?: string, branch?: string): Promise<void>;
  push(remote?: string, branch?: string, options?: { setUpstream?: boolean; force?: boolean }): Promise<void>;
  getRemotes(): Promise<Array<{ name: string; url: string }>>;
  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  setRemoteUrl(name: string, url: string): Promise<void>;
}

