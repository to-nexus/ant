/**
 * @ant/shared — Git domain contract types
 *
 * Single source of truth for Git state, user-facing operations, error
 * classification, and PAT state shared across BE (ant-cli) and FE (ant-ui).
 *
 * ## Ant Git Domain Vocabulary (see docs/architecture/24-git-operations.md)
 *
 * - `Publish` is **polymorphic**: one FE dispatch maps to 4 backend variants
 *   depending on the current state matrix (S1/S2/S3/S4).
 * - `Sync` is **not** a raw fetch+pull+push chain; it conditionally fetches,
 *   pulls only when behind>0, pushes only when ahead>0, and lazily creates
 *   worktrees.
 * - `Worktree` is fully hidden from the user — features are the only user
 *   concept.
 * - GitHub-only, PAT-authenticated, auto local-init, `_base` is a reserved
 *   feature name.
 * - Canonical git vocabulary (`status`, `changes`, `initialize`,
 *   `publish-branch`) is intentionally absent from the FE type surface.
 */

export type FileChangeStatus = 'modified' | 'deleted' | 'new' | 'renamed';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
}

/**
 * Unified Git state snapshot — single readonly container covering every field
 * UI/selectors need to drive CTA, menu, badge, and working-tree rendering.
 *
 * Mutation is forbidden at the type level (Readonly) and enforced at runtime
 * by `Object.freeze` inside `StatusService.getSnapshot` (see docs §7.1).
 */
export type GitSnapshot = Readonly<{
  /** `true` once `.git` exists on the project codebase. */
  hasGit: boolean;
  /** `true` if a GitHub remote is configured for the project. */
  hasRemote: boolean;
  /** `true` if the project has a codebase directory. */
  hasCodebase: boolean;
  /** `true` if the codebase directory is non-empty. */
  codebaseHasFiles: boolean;
  /** `true` if any non-`_base` features exist. */
  hasFeatures: boolean;
  /**
   * Optional probe result of GitHub repo existence (Setup states only).
   *
   * - `true`   → present → "Clone" CTA.
   * - `false`  → absent  → "Publish to GitHub" CTA.
   * - `undefined` → probe skipped or failed → `[Clone] [Publish]` fallback.
   */
  remoteExists?: boolean;
  /** Current branch of the currently selected feature's worktree. */
  currentBranch?: string;
  /** Remote URL resolved from project config (GitHub repo URL). */
  remoteUrl?: string;
  /** `true` when the current branch has a configured upstream. */
  hasUpstream: boolean;
  /** Number of commits local-ahead of upstream. */
  ahead: number;
  /** Number of commits upstream-ahead of local. */
  behind: number;
  staged: ReadonlyArray<FileChange>;
  unstaged: ReadonlyArray<FileChange>;
  untracked: ReadonlyArray<FileChange>;
}>;

/**
 * Eight user-facing Git operations. The only operation kinds the FE may
 * dispatch; the BE resolves their polymorphism (notably `publish`).
 *
 * Canonical git vocabulary (`initialize`, `publish-branch`) is absent by
 * design — `publish` auto-resolves to init/base-push/branch-push variants.
 */
export type GitUserOperation =
  | { kind: 'publish'; feature?: string }
  | { kind: 'push'; feature?: string }
  | { kind: 'pull'; feature?: string }
  | { kind: 'fetch'; feature?: string }
  | { kind: 'sync'; feature?: string }
  | { kind: 'commit'; message?: string; files?: string[]; feature?: string }
  | { kind: 'discard'; files?: string[]; feature?: string }
  | { kind: 'clone' };

export type GitUserOperationKind = GitUserOperation['kind'];

/**
 * Error classification for Git operations. Drives UI branching (retry,
 * suggestedAction) and is stable across transport boundaries.
 */
export type GitOperationErrorKind =
  | 'auth'      // PAT missing/expired → Configure PAT
  | 'conflict'  // merge conflict / already exists → IDE or Clone
  | 'notFound'  // repo missing → reconfigure
  | 'config'    // githubRepo/localPath missing → Config
  | 'network'   // transient → Retry
  | 'unknown';  // other → Retry + message

export type GitSuggestedAction =
  | 'configurePat'
  | 'resolveConflict'
  | 'reconfigureRepo'
  | 'runClone';

export interface GitOperationError {
  kind: GitOperationErrorKind;
  message: string;
  retryable: boolean;
  suggestedAction?: GitSuggestedAction | null;
}

/**
 * Four-state operation FSM. `idle` is the default; `running` is exclusive
 * (only one op at a time); `failed` holds the error until cleared/retried.
 */
export type GitOperationState =
  | { status: 'idle' }
  | { status: 'running'; op: GitUserOperation; startedAt: number }
  | {
      status: 'failed';
      op: GitUserOperation;
      error: GitOperationError;
      failedAt: number;
    }
  | { status: 'succeeded'; op: GitUserOperation; completedAt: number };

export interface GitPatState {
  configured: boolean;
  username?: string;
}

/** Body shape for POST /projects/:id/git/ops/:userOp (partial by kind). */
export type GitOperationRequestBody = Partial<
  Omit<Extract<GitUserOperation, { kind: string }>, 'kind'>
> & Record<string, unknown>;

/**
 * Response shape for GET /projects/:id/git/state.
 */
export interface GitStateResponse {
  snapshot: GitSnapshot;
  pat: GitPatState;
}

/**
 * Response shape for POST /projects/:id/git/ops/:userOp on success.
 * On error the server returns `{ error: GitOperationError }` with 4xx/5xx.
 */
export interface GitOperationSuccessResponse {
  success: true;
  warnings?: string[];
  result?: unknown;
}

export interface GitOperationFailureResponse {
  success: false;
  error: GitOperationError;
}

export type GitOperationResponse =
  | GitOperationSuccessResponse
  | GitOperationFailureResponse;

// ---------------------------------------------------------------------------
// Legacy REST contract — retained only during the greenfield migration window
// inside a single PR. Both @ant/cli and @ant/ui continue to reference these
// symbols until cutover removes all old endpoints.
// ---------------------------------------------------------------------------

/** @deprecated Use {@link GitSnapshot}. Removed at greenfield cutover. */
export interface GitStatusResponse {
  hasGit: boolean;
  hasCodebase: boolean;
  codebaseHasFiles: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
  remoteUrl?: string;
}

/** @deprecated Use {@link GitSnapshot}. Removed at greenfield cutover. */
export interface GitChangesResponse {
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  ahead: number;
  behind: number;
  isGitInitialized: boolean;
  hasUpstream: boolean;
}
