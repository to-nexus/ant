/**
 * @ant/shared — Git REST contract types
 *
 * Single source of truth for GET /projects/:id/git/status and
 * GET /projects/:id/git/changes response shapes.
 * Both ant-cli (StatusService) and ant-ui (gitSlice, selectors) import from here.
 */

export type FileChangeStatus = 'modified' | 'deleted' | 'new' | 'renamed';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
}

/** Response of GET /projects/:id/git/status */
export interface GitStatusResponse {
  hasGit: boolean;
  hasCodebase: boolean;
  codebaseHasFiles: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
  remoteUrl?: string;
}

/** Response of GET /projects/:id/git/changes */
export interface GitChangesResponse {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  ahead: number;
  behind: number;
  isGitInitialized: boolean;
  hasUpstream: boolean;
}
