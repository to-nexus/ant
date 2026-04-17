/**
 * Pure selectors for deriving Git UI states.
 *
 * Both `ProjectSection` (dropdown menu) and `ActionButton` (primary CTA) used
 * to recompute the same branching rules independently — duplicating subtle
 * logic like "hasUpstream === undefined means loading, not State 3". These
 * selectors are the single source of interpretation: hand them the raw
 * `gitStatus` + `gitChanges` + `githubRepo` and read off a discriminated union.
 *
 * No imports beyond types — these are pure functions usable from any layer.
 */

import type { GitStatus } from '@/domain/store/types';
import type { GitChanges } from '@/infrastructure/http/api';

// ============================================================================
// GitMenuState — ProjectSection's dropdown variants
// ============================================================================

export type GitMenuState =
  /** Status hasn't arrived yet OR disambiguating fields are still pending. */
  | { kind: 'loading' }
  /** Git + remote config both missing and the user has no features to publish. */
  | { kind: 'disabled'; reason: 'noGit' | 'noConfig' }
  /** 1b — needs setup (clone OR initialize). */
  | { kind: 'setup'; actions: Array<'clone' | 'initialize'> }
  /** 1a (noFeatures: nothing to push yet) or 2 (branch not upstreamed). */
  | { kind: 'publishBranch'; source: 'noFeatures' | 'noUpstream' }
  /** 3 — repo + upstream present; standard push/pull/fetch flow. */
  | {
      kind: 'synced';
      canPush: boolean;
      canPull: boolean;
      canFetch: boolean;
      pullBlockedByChanges: boolean;
    };

export interface DeriveGitMenuStateInput {
  gitStatus: GitStatus | null;
  /** From projectConfig — declared repo URL before disk state is populated. */
  githubRepo: string | null;
}

export function deriveGitMenuState(input: DeriveGitMenuStateInput): GitMenuState {
  const { gitStatus, githubRepo } = input;

  // Loading — status hasn't come back yet.
  if (!gitStatus) return { kind: 'loading' };

  const hasRemote = !!gitStatus.remoteUrl;
  const hasGit = gitStatus.hasGit === true;

  // Neither a declared github repo nor a disk-level git repo → nothing to offer.
  if (!githubRepo && !hasGit) {
    return { kind: 'disabled', reason: 'noConfig' };
  }

  // Ambiguous: remote exists but hasUpstream hasn't been computed yet.
  // Falling through would misclassify into State 3 (synced) and show push/pull
  // based on stale ahead/behind from a different feature.
  if (hasGit && hasRemote && gitStatus.hasUpstream === undefined) {
    return { kind: 'loading' };
  }

  if (!hasGit || !hasRemote) {
    // Repo not set up, but the user has features to preserve.
    if (gitStatus.hasFeatures) return { kind: 'publishBranch', source: 'noFeatures' };
    return { kind: 'setup', actions: ['clone', 'initialize'] };
  }

  if (gitStatus.hasUpstream === false) {
    return { kind: 'publishBranch', source: 'noUpstream' };
  }

  const ahead = gitStatus.ahead ?? 0;
  const behind = gitStatus.behind ?? 0;
  return {
    kind: 'synced',
    canPush: ahead > 0,
    // Disallow pull when local changes would be overwritten — the backend
    // reports `hasUncommittedChanges` after a getGitChanges call.
    canPull: behind > 0 && gitStatus.hasUncommittedChanges !== true,
    canFetch: true,
    pullBlockedByChanges: behind > 0 && gitStatus.hasUncommittedChanges === true,
  };
}

// ============================================================================
// GitActionCta — ActionButton's primary CTA
// ============================================================================

export type GitActionCta =
  /** Either we're fetching or fields required for decision are still absent. */
  | { kind: 'loading' }
  /** Committed & in sync. */
  | { kind: 'noChanges' }
  /** Working-tree has modifications → encourage Commit. */
  | { kind: 'commit'; count: number }
  /** Publish variant depends on why the branch can't be push/pulled normally. */
  | { kind: 'publish'; variant: 'noRemoteWithFeatures' | 'noUpstream' }
  /** Both ahead & behind → offer a sync. */
  | { kind: 'sync'; ahead: number; behind: number }
  | { kind: 'push'; ahead: number }
  | { kind: 'pull'; behind: number };

export interface DeriveGitActionCtaInput {
  gitChanges: GitChanges | null;
  gitStatus: GitStatus | null;
  isLoading: boolean;
}

export function deriveGitActionCta(input: DeriveGitActionCtaInput): GitActionCta {
  const { gitChanges, gitStatus, isLoading } = input;

  if (isLoading || !gitChanges || !gitStatus) {
    return { kind: 'loading' };
  }

  const total =
    gitChanges.staged.length +
    gitChanges.unstaged.length +
    gitChanges.untracked.length;

  if (total > 0) {
    return { kind: 'commit', count: total };
  }

  const hasRemote = !!gitStatus.remoteUrl;

  // No remote yet, but features exist → the CTA is "create repo".
  if (!hasRemote && gitStatus.hasFeatures) {
    return { kind: 'publish', variant: 'noRemoteWithFeatures' };
  }
  // Remote exists, but this local branch has no upstream → offer to publish it.
  if (gitChanges.hasUpstream === false && hasRemote) {
    return { kind: 'publish', variant: 'noUpstream' };
  }

  if (gitChanges.ahead > 0 && gitChanges.behind > 0) {
    return { kind: 'sync', ahead: gitChanges.ahead, behind: gitChanges.behind };
  }
  if (gitChanges.ahead > 0) return { kind: 'push', ahead: gitChanges.ahead };
  if (gitChanges.behind > 0) return { kind: 'pull', behind: gitChanges.behind };

  return { kind: 'noChanges' };
}
