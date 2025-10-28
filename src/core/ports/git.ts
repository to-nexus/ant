/**
 * Git Port
 * Interface for Git operations
 */

export interface GitPort {
  getRepoRoot(): Promise<string>;
  createBranch(name: string, base: string): Promise<void>;
  getChangedFiles(): Promise<string[]>;
  getHeadFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

