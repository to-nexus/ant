/**
 * git-world selector tests.
 *
 * These tests lock the derived UI state against the `GitSnapshot` shape.
 * Any drift in `deriveGitCta` / `deriveGitMenu` / `deriveGitBadge` /
 * `deriveGitSetupCta` is caught here before it reaches the UI.
 *
 * Runner: vitest (to be wired into packages/ant-ui; tracked in the
 * greenfield follow-up). The specs use no framework-specific features
 * beyond `describe` / `it` / `expect`, so they port cleanly.
 */

import { describe, it, expect } from 'vitest';
import type { GitSnapshot } from '@ant/shared';
import {
  deriveGitCta,
  deriveGitMenu,
  deriveGitBadge,
  deriveGitSetupCta,
} from '../../src/domain/git-world/selectors';

// Default = a normal operating project: `hasFeatures` is derived from the
// `features/` dir on disk, so any snapshot carrying a branch / ahead-behind
// counters / a working tree necessarily has at least one feature. Zero-feature
// rows opt out explicitly.
function snap(partial: Partial<GitSnapshot>): GitSnapshot {
  return {
    hasGit: true,
    hasRemote: true,
    hasUpstream: true,
    hasFeatures: true,
    remoteExists: true,
    currentBranch: 'feature/x',
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    ...partial,
  } as GitSnapshot;
}

describe('deriveGitCta', () => {
  it('returns loading for null snapshot', () => {
    expect(deriveGitCta(null)).toEqual({ kind: 'loading' });
  });

  it('returns commit when working-tree has changes', () => {
    const s = snap({ staged: ['a'], unstaged: ['b'], untracked: [] });
    expect(deriveGitCta(s)).toEqual({ kind: 'commit', count: 2 });
  });

  it('returns publish noRemoteWithFeatures when no remote but features exist', () => {
    const s = snap({ hasRemote: false, hasFeatures: true });
    expect(deriveGitCta(s)).toEqual({ kind: 'publish', variant: 'noRemoteWithFeatures' });
  });

  it('returns publish noUpstream when remote exists but no upstream', () => {
    const s = snap({ hasRemote: true, hasUpstream: false });
    expect(deriveGitCta(s)).toEqual({ kind: 'publish', variant: 'noUpstream' });
  });

  it('returns sync when ahead and behind', () => {
    const s = snap({ ahead: 2, behind: 3 });
    expect(deriveGitCta(s)).toEqual({ kind: 'sync', ahead: 2, behind: 3 });
  });

  it('returns push when only ahead', () => {
    const s = snap({ ahead: 2 });
    expect(deriveGitCta(s)).toEqual({ kind: 'push', ahead: 2 });
  });

  it('returns pull when only behind', () => {
    const s = snap({ behind: 1 });
    expect(deriveGitCta(s)).toEqual({ kind: 'pull', behind: 1 });
  });

  it('returns noChanges when everything is in sync', () => {
    expect(deriveGitCta(snap({}))).toEqual({ kind: 'noChanges' });
  });
});

describe('deriveGitMenu', () => {
  it('returns loading when snapshot is null', () => {
    expect(deriveGitMenu({ snapshot: null, githubRepo: null })).toEqual({ kind: 'loading' });
  });

  it('returns disabled:noConfig when neither disk nor config has git', () => {
    const s = snap({ hasGit: false, hasRemote: false });
    expect(deriveGitMenu({ snapshot: s, githubRepo: null })).toEqual({
      kind: 'disabled',
      reason: 'noConfig',
    });
  });

  it('returns publish (noUpstream) when remote exists but upstream missing', () => {
    const s = snap({ hasUpstream: false });
    const m = deriveGitMenu({ snapshot: s, githubRepo: 'https://github.com/x/y' });
    expect(m.kind).toBe('publish');
    if (m.kind === 'publish') expect(m.source).toBe('noUpstream');
  });

  it('returns synced with push permission when ahead', () => {
    const s = snap({ ahead: 1 });
    const m = deriveGitMenu({ snapshot: s, githubRepo: 'x' });
    expect(m.kind).toBe('synced');
    if (m.kind === 'synced') {
      expect(m.canPush).toBe(true);
      expect(m.canPull).toBe(false);
    }
  });

  // Diverged: a push is a guaranteed non-fast-forward rejection, so the menu
  // must say so instead of letting the user discover it from GitHub. The CTA
  // resolves the same state to `sync`.
  it('blocks push when the remote is ahead too (diverged)', () => {
    const s = snap({ ahead: 2, behind: 3 });
    const m = deriveGitMenu({ snapshot: s, githubRepo: 'x' });
    expect(m.kind).toBe('synced');
    if (m.kind === 'synced') {
      expect(m.canPush).toBe(false);
      expect(m.pushBlockedByBehind).toBe(true);
      expect(m.canPull).toBe(true);
    }
    expect(deriveGitCta(s)).toEqual({ kind: 'sync', ahead: 2, behind: 3 });
  });

  it('blocks pull when dirty working tree', () => {
    const s = snap({ behind: 1, unstaged: ['foo'] });
    const m = deriveGitMenu({ snapshot: s, githubRepo: 'x' });
    expect(m.kind).toBe('synced');
    if (m.kind === 'synced') {
      expect(m.canPull).toBe(false);
      expect(m.pullBlockedByChanges).toBe(true);
    }
  });

  // Clone is only permitted on a project with ZERO features. With features
  // present the item renders disabled + notice, never silently hidden.
  it('setup with zero features → clone available (not blocked)', () => {
    const s = snap({ hasGit: false, hasRemote: false, hasFeatures: false, remoteExists: true });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'setup',
      actions: ['clone'],
      cloneBlockedByFeatures: false,
    });
  });

  it('setup with features + remoteExists=true → clone shown but blocked', () => {
    const s = snap({ hasGit: true, hasRemote: false, hasFeatures: true, remoteExists: true });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'setup',
      actions: ['clone'],
      cloneBlockedByFeatures: true,
    });
  });

  it('setup with features + ambiguous probe → blocked clone + initialize reachable', () => {
    const s = snap({ hasGit: true, hasRemote: false, hasFeatures: true, remoteExists: undefined });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'setup',
      actions: ['ambiguous'],
      cloneBlockedByFeatures: true,
    });
  });

  it('features + remoteExists=false stays publish/noFeatures (clone irrelevant)', () => {
    const s = snap({ hasGit: true, hasRemote: false, hasFeatures: true, remoteExists: false });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'publish',
      source: 'noFeatures',
    });
  });

  // Every feature of a CONNECTED project was deleted. The anchor is the only
  // repo left, so the menu must offer fetch alone — push/pull/publish all
  // require a feature worktree and would be rejected by the BE. Before this
  // branch existed the state fell through to publish/noUpstream, which
  // MenuDropdown maps to push → guaranteed "requires a feature" failure.
  it('connected + zero features → anchorOnly (fetch only)', () => {
    const s = snap({ hasGit: true, hasRemote: true, hasFeatures: false, hasUpstream: false });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'anchorOnly',
      canFetch: true,
    });
  });

  it('anchorOnly does not hijack the UNCONNECTED zero-feature setup state', () => {
    const s = snap({ hasGit: true, hasRemote: false, hasFeatures: false, remoteExists: true });
    expect(deriveGitMenu({ snapshot: s, githubRepo: 'x' })).toEqual({
      kind: 'setup',
      actions: ['clone'],
      cloneBlockedByFeatures: false,
    });
  });
});

describe('deriveGitBadge', () => {
  it('returns none when no snapshot + no repo declared', () => {
    expect(deriveGitBadge(null, null)).toEqual({ kind: 'none' });
  });

  it('returns notConfigured when repo declared but no disk state', () => {
    expect(deriveGitBadge(null, 'https://github.com/x/y')).toEqual({ kind: 'notConfigured' });
  });

  it('returns configured with branch when disk state present', () => {
    const s = snap({ currentBranch: 'main' });
    expect(deriveGitBadge(s, null)).toEqual({ kind: 'configured', branch: 'main' });
  });

  it('returns notConfigured when snapshot shows no git but repo is declared', () => {
    const s = snap({ hasGit: false });
    expect(deriveGitBadge(s, 'https://github.com/x/y')).toEqual({ kind: 'notConfigured' });
  });
});

describe('deriveGitSetupCta', () => {
  it('returns ambiguous when snapshot is null', () => {
    expect(deriveGitSetupCta(null)).toEqual({ kind: 'ambiguous' });
  });

  it('returns clone when remoteExists is true', () => {
    expect(deriveGitSetupCta(snap({ remoteExists: true }))).toEqual({ kind: 'clone' });
  });

  it('returns publish when remoteExists is explicitly false', () => {
    expect(deriveGitSetupCta(snap({ remoteExists: false }))).toEqual({ kind: 'publish' });
  });

  it('returns ambiguous when remoteExists is unknown (null/undefined)', () => {
    const s = { ...snap({}), remoteExists: null } as unknown as GitSnapshot;
    expect(deriveGitSetupCta(s)).toEqual({ kind: 'ambiguous' });
  });
});
