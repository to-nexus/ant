/**
 * Git Port
 * Interface for Git operations
 */

export interface GitPort {
  getRepoRoot(): Promise<string>;
  createBranch(name: string, base: string): Promise<void>;
  getChangedFiles(): Promise<string[]>;
  hasChanges(): Promise<boolean>;  // Check if working tree has changes
  getHeadFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  diff(): Promise<string[]>;  // Legacy compatibility
  show(args: string[]): Promise<string>;  // Legacy compatibility
  status(): Promise<{ files: Array<{ path: string }> }>;  // Legacy compatibility
}

