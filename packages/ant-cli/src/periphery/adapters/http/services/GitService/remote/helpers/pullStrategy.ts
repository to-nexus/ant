import type { SimpleGit, StatusResult } from 'simple-git';
import type { GitPullStrategy } from '@ant/shared';
import { GitConflictError } from '../../errors';

/**
 * Reconciliation flags for `git pull`.
 *
 * Git >= 2.34 aborts a bare `git pull` on divergent branches
 * (`fatal: Need to specify how to reconcile divergent branches`), so both
 * PullOperation and SyncOperation must pass a strategy explicitly. This is
 * the single mapping — the flag is never persisted to `pull.rebase`, which
 * would also change the behaviour of the user's own terminal in the same
 * worktree.
 *
 * The argument arrives unvalidated from the HTTP body, so anything that is
 * not exactly `'rebase'` folds to merge: an arbitrary string must never
 * reach git's argv as a flag.
 */
export function pullArgs(strategy?: unknown): string[] {
  return strategy === 'rebase' ? ['--rebase'] : ['--no-rebase', '--no-edit'];
}

/** Narrow an unvalidated body field to the canonical strategy. */
export function normalizeStrategy(strategy?: unknown): GitPullStrategy {
  return strategy === 'rebase' ? 'rebase' : 'merge';
}

/**
 * Perform the reconciling pull and translate every failure mode into a typed
 * error. Pull and Sync share it so the two can never diverge on strategy,
 * on the dirty-worktree gate, or on how a broken rebase is cleaned up.
 *
 * `status` must be read AFTER the fetch — it is the freshness the decision
 * rests on.
 */
export async function pullWithStrategy(
  git: SimpleGit,
  branch: string,
  strategy: unknown,
  status: StatusResult
): Promise<void> {
  // A merge/rebase into a dirty worktree aborts halfway with an opaque
  // "local changes would be overwritten" — refuse before touching the tree.
  // Same definition as the FE's `pullBlockedByChanges` gate.
  if (!status.isClean()) {
    throw new GitConflictError(
      'Commit or discard your changes before pulling from the remote.',
      { retryable: false, suggestedAction: 'commitFirst' }
    );
  }

  const rebasing = normalizeStrategy(strategy) === 'rebase';
  try {
    await git.pull('origin', branch, pullArgs(strategy));
  } catch (error: any) {
    const message = error?.message || String(error);

    if (/refusing to merge unrelated histories/i.test(message)) {
      throw new GitConflictError(
        `This workspace and origin/${branch} have no common history, so they cannot be ` +
          `merged. The repository was most likely initialized separately from the remote.`,
        { retryable: false, cause: error }
      );
    }

    if (rebasing) {
      // A stopped rebase leaves `.git/rebase-merge` + conflict markers, and
      // GitSnapshot has no channel for "rebase in progress" — every later op
      // would misread the worktree. Roll it back and offer merge instead.
      try {
        await git.raw(['rebase', '--abort']);
      } catch {
        /* nothing to abort — the rebase failed before it started */
      }
      throw new GitConflictError(
        `Rebase onto origin/${branch} hit a conflict and was rolled back. ` +
          `Pull with the merge strategy, or resolve it in the IDE.`,
        { retryable: false, suggestedAction: 'retryWithMerge', cause: error }
      );
    }

    if (/conflict/i.test(message)) {
      throw new GitConflictError(
        'Merge conflict detected. Resolve the conflicts in the IDE and commit.',
        { retryable: false, suggestedAction: 'resolveConflict', cause: error }
      );
    }

    throw error;
  }
}
