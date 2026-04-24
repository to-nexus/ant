/**
 * git-world selectors — pure derivations over {@link GitSnapshot}.
 *
 * Design invariants (see `docs/architecture/24-git-operations.md`):
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
  | { kind: 'setup'; actions: ReadonlyArray<'clone' | 'publish' | 'ambiguous'> }
  | { kind: 'publish'; source: 'noFeatures' | 'noUpstream' }
  | {
      kind: 'synced';
      canPush: boolean;
      canPull: boolean;
      canFetch: boolean;
      pullBlockedByChanges: boolean;
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
    if (snapshot.hasFeatures) return { kind: 'publish', source: 'noFeatures' };
    return { kind: 'setup', actions: [deriveGitSetupCta(snapshot).kind] };
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
    canPush: ahead > 0,
    canPull: behind > 0 && !hasUncommittedChanges,
    canFetch: true,
    pullBlockedByChanges: behind > 0 && hasUncommittedChanges,
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
