/**
 * `git-world` public surface.
 *
 * **The only sanctioned entry point** to Git state, operations, and PAT
 * management from outside `src/domain/git-world/**`.
 *
 * API contract:
 *  - Types: {@link GitSnapshot}, {@link GitUserOperation}, {@link GitOperationError},
 *    {@link GitOperationState}, {@link GitPatState} (re-exported from `@ant/shared`).
 *  - Hooks: `useGitSnapshot`, `useGitOperation`, `useGitPat`, `useGitCta`,
 *    `useGitMenu`, `useGitBadge`, `useGitSetupCta`, `useGitDispatch`,
 *    `useGitPatDispatch`.
 *  - SSE: `registerGitStateHandler()` — call once at app root.
 *  - Slice: `createGitWorldSlice` for store composition.
 *  - Selectors: `deriveGitCta` / `deriveGitMenu` / `deriveGitBadge` /
 *    `deriveGitSetupCta` for test reuse.
 *
 * **Not exported** (structurally sealed):
 *  - `infrastructure/api.ts` — underscore-prefixed writers — REST paths.
 */

export { createGitWorldSlice } from './state';
export type { GitWorldSlice, GitWorldState, GitWorldActions, AsyncFields } from './state';
export { registerGitStateHandler } from './sse-handler';

/**
 * One-shot REST dispatch for callers that manage their own UI state
 * (ProjectWizardModal is the only sanctioned caller today). It does NOT
 * touch the git-world slice — use `useGitDispatch().runGitOperation` when
 * you want FSM integration + automatic error banner.
 *
 * The private infrastructure module stays sealed; re-exporting just this
 * thin wrapper keeps the wizard's ephemeral project-creation flow working
 * without carving another ESLint exception.
 */
export { dispatchGitOp as dispatchGitOpOneShot } from './infrastructure/api';
export {
  deriveGitCta,
  deriveGitMenu,
  deriveGitBadge,
  deriveGitSetupCta,
} from './selectors';
export type { GitCta, GitMenu, GitBadge, GitSetupCta, DeriveGitMenuInput } from './selectors';
export {
  useGitSnapshot,
  useGitSnapshotRefreshing,
  useGitOperation,
  useGitPat,
  useGitPatRefreshing,
  useGitCta,
  useGitMenu,
  useGitBadge,
  useGitSetupCta,
  useGitDispatch,
  useGitPatDispatch,
} from './hooks';

// Re-export the shared Git contract types so consumers have a single import.
export type {
  GitSnapshot,
  GitUserOperation,
  GitUserOperationKind,
  GitOperationState,
  GitOperationError,
  GitOperationErrorKind,
  GitSuggestedAction,
  GitPatState,
  FileChange,
  FileChangeStatus,
} from '@ant/shared';
