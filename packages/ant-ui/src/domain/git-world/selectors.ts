/**
 * git-world selectors — pure derivations over {@link GitSnapshot}.
 *
 * Design invariants (see `docs/internals/24-git-operations.md`):
 * - Every discriminant is a string-literal so consumers can switch
 *   exhaustively (`never` check at the default branch).
 * - Selectors **never** read `gitStatus` / `gitChanges` fields directly;
 *   the unified `GitSnapshot` is the single source of truth.
 * - `null` snapshots resolve to `kind: 'loading'` — this is the only
 *   representation of "data not yet available" in the UI.
 */

import type { GitSnapshot } from '@ant/shared';

// ============================================================================
// Primary CTA — the button shown in the ProjectSection / GitPanel header.
// ============================================================================

export type GitCta =
  | { kind: 'loading' }
  | { kind: 'noChanges' }
  | { kind: 'commit'; count: number }
  | { kind: 'publish'; variant: 'noRemoteWithFeatures' | 'noUpstream' }
  | { kind: 'sync'; ahead: number; behind: number }
  | { kind: 'push'; ahead: number }
  | { kind: 'pull'; behind: number };

export function deriveGitCta(snapshot: GitSnapshot | null): GitCta {
  if (!snapshot) return { kind: 'loading' };

  const total = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length;
  if (total > 0) {
    return { kind: 'commit', count: total };
  }

  if (!snapshot.hasRemote && snapshot.hasFeatures) {
    return { kind: 'publish', variant: 'noRemoteWithFeatures' };
  }
  if (snapshot.hasRemote && snapshot.hasUpstream === false) {
    return { kind: 'publish', variant: 'noUpstream' };
  }

  const ahead = snapshot.ahead ?? 0;
  const behind = snapshot.behind ?? 0;
  if (ahead > 0 && behind > 0) return { kind: 'sync', ahead, behind };
  if (ahead > 0) return { kind: 'push', ahead };
  if (behind > 0) return { kind: 'pull', behind };

  return { kind: 'noChanges' };
}

// ============================================================================
// Menu state — the dropdown / set of secondary actions.
// ============================================================================

export type GitMenu =
  | { kind: 'loading' }
  | { kind: 'disabled'; reason: 'noGit' | 'noConfig' }
  | {
      kind: 'setup';
      actions: ReadonlyArray<'clone' | 'publish' | 'ambiguous'>;
      /**
       * Clone is only permitted on a project with zero features. When the
       * project already has features the Clone item renders DISABLED with an
       * explanatory notice (never silently hidden — the user must learn why).
       */
      cloneBlockedByFeatures: boolean;
    }
  | { kind: 'publish'; source: 'noFeatures' | 'noUpstream' }
  /**
   * Connected project (`hasGit && hasRemote`) with ZERO features. The bare
   * anchor is the only repository, and `ensureGitRepository` rejects every
   * worktree-scoped op without a feature — `fetch` is the sole operation
   * that passes `allowAnchor`. Offering push/pull/publish/clone here would
   * be a guaranteed BE rejection.
   */
  | { kind: 'anchorOnly'; canFetch: boolean }
  | {
      kind: 'synced';
      canPush: boolean;
      canPull: boolean;
      canFetch: boolean;
      pullBlockedByChanges: boolean;
      /**
       * Diverged: pushing is a guaranteed non-fast-forward rejection, so the
       * item renders DISABLED with the reason rather than letting the user
       * discover it from GitHub.
       */
      pushBlockedByBehind: boolean;
    };

export interface DeriveGitMenuInput {
  snapshot: GitSnapshot | null;
  /** From projectConfig — declared repo URL before disk state is populated. */
  githubRepo: string | null;
}

export function deriveGitMenu(input: DeriveGitMenuInput): GitMenu {
  const { snapshot, githubRepo } = input;
  if (!snapshot) return { kind: 'loading' };

  if (!githubRepo && !snapshot.hasGit) {
    return { kind: 'disabled', reason: 'noConfig' };
  }

  if (!snapshot.hasGit || !snapshot.hasRemote) {
    const cta = deriveGitSetupCta(snapshot).kind;
    if (snapshot.hasFeatures) {
      // Publish is the real action for a featured project; clone stays
      // visible-but-blocked when the remote probe says (or may say) a repo
      // exists, so the user learns the zero-features rule instead of
      // wondering where Clone went.
      if (cta === 'publish') return { kind: 'publish', source: 'noFeatures' };
      return { kind: 'setup', actions: [cta], cloneBlockedByFeatures: true };
    }
    return { kind: 'setup', actions: [cta], cloneBlockedByFeatures: false };
  }

  // Connected but featureless (e.g. every feature was deleted). Must sit
  // AFTER the setup branch — an unconnected project still gets Clone /
  // Publish — and BEFORE the `hasUpstream` check, which would otherwise
  // route to Push, an operation the BE always rejects without a feature.
  if (!snapshot.hasFeatures) {
    return { kind: 'anchorOnly', canFetch: true };
  }

  if (snapshot.hasUpstream === false) {
    return { kind: 'publish', source: 'noUpstream' };
  }

  const ahead = snapshot.ahead ?? 0;
  const behind = snapshot.behind ?? 0;
  const hasUncommittedChanges =
    snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length > 0;

  return {
    kind: 'synced',
    canPush: ahead > 0 && behind === 0,
    canPull: behind > 0 && !hasUncommittedChanges,
    canFetch: true,
    pullBlockedByChanges: behind > 0 && hasUncommittedChanges,
    pushBlockedByBehind: ahead > 0 && behind > 0,
  };
}

// ============================================================================
// Badge — 3-state indicator reused across ConfigField / Wizard / Step.
// ============================================================================

export type GitBadge =
  | { kind: 'none' }                               // no repo declared, no git on disk
  | { kind: 'notConfigured' }                      // repo declared but disk state missing
  | { kind: 'configured'; branch: string | null }; // disk state present

export function deriveGitBadge(
  snapshot: GitSnapshot | null,
  githubRepo: string | null,
): GitBadge {
  if (!snapshot) {
    return githubRepo ? { kind: 'notConfigured' } : { kind: 'none' };
  }
  if (!snapshot.hasGit) {
    return githubRepo ? { kind: 'notConfigured' } : { kind: 'none' };
  }
  return { kind: 'configured', branch: snapshot.currentBranch ?? null };
}

// ============================================================================
// Setup CTA — resolves the "publish vs clone" ambiguity using remoteExists.
// ============================================================================

export type GitSetupCta =
  | { kind: 'clone' }      // remote exists → clone it
  | { kind: 'publish' }    // remote absent → publish local
  | { kind: 'ambiguous' }; // probe failed or unknown → show both

export function deriveGitSetupCta(snapshot: GitSnapshot | null): GitSetupCta {
  if (!snapshot) return { kind: 'ambiguous' };
  if (snapshot.remoteExists === true) return { kind: 'clone' };
  if (snapshot.remoteExists === false) return { kind: 'publish' };
  return { kind: 'ambiguous' };
}
