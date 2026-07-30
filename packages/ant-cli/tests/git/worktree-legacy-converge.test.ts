/**
 * Lazy origin convergence — real git integration.
 *
 * Legacy projects (pre-bare-anchor) are connected via `config.githubRepo` but
 * have no `repo.git`. The first feature creation used to `init --bare` an
 * EMPTY anchor with no origin, so a feature named after an existing remote
 * branch bootstrapped an orphan history with no upstream ("Publish new
 * branch" in the UI instead of tracking origin/{name}).
 *
 * WorktreeService.syncOriginState now converges the anchor transactionally:
 * origin (+ fetch refspec) is attached from config.githubRepo, probed with a
 * fetch, and KEPT only when the remote is live with ≥1 branch — otherwise it
 * is rolled back so the Publish(init) flow and the branchBase lock
 * (= origin presence) keep their meaning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';
import { isBranchBaseLocked, readBranchBase } from '../../src/periphery/adapters/http/services/GitService/anchor/branchBaseLifecycle';
import type { GitHubAuthService } from '../../src/periphery/adapters/auth/GitHubAuthService';

const uc = { userId: 'u', organizationId: 'o' };
const PROJECT = 'proj';

let base: string;
let resolver: UnifiedWorkspaceResolver;
let projectPath: string;
let anchorPath: string;
let remoteDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

function commit(cwd: string, file: string, content: string, message: string): string {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** WorktreeService whose auth stub resolves the "GitHub repo" to `url`. */
function serviceWithRemoteUrl(url: string): WorktreeService {
  const authStub = {
    buildAuthenticatedUrl: async () => url,
  } as unknown as GitHubAuthService;
  return new WorktreeService(resolver, authStub);
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify(config), 'utf-8');
}

function anchorGitRaw(...args: string[]): string {
  return execFileSync('git', ['--git-dir', anchorPath, ...args], { encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-wt-converge-'));
  resolver = new UnifiedWorkspaceResolver(base);
  projectPath = resolver.getProjectPath(uc, PROJECT);
  anchorPath = resolver.getGitAnchorPath(uc, PROJECT);
  fs.mkdirSync(projectPath, { recursive: true });
  writeConfig({ repoType: 'cloud', githubRepo: 'legacy/proj' });

  // Real "remote": default branch `main` + a `feature/base` branch — the
  // exact shape of a legacy connected project's GitHub repo.
  remoteDir = path.join(base, 'remote-src');
  fs.mkdirSync(remoteDir, { recursive: true });
  git(remoteDir, 'init', '-b', 'main');
  git(remoteDir, 'config', 'user.email', 't@t');
  git(remoteDir, 'config', 'user.name', 't');
  commit(remoteDir, 'main.txt', 'm', 'main-1');
  git(remoteDir, 'checkout', '-b', 'feature/base');
  commit(remoteDir, 'f.txt', '1', 'feature-1');
  git(remoteDir, 'checkout', 'main');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('createWorktree — lazy origin convergence (legacy project, no anchor)', () => {
  it('feature named after the remote default branch tracks origin/main and locks branchBase', async () => {
    const mainTip = git(remoteDir, 'rev-parse', 'main');
    const worktrees = serviceWithRemoteUrl(remoteDir);

    const info = await worktrees.createWorktree(PROJECT, 'main', uc);

    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main');
    expect(git(info.path, 'rev-parse', 'HEAD')).toBe(mainTip);
    expect(anchorGitRaw('config', '--get', 'remote.origin.fetch'))
      .toBe('+refs/heads/*:refs/remotes/origin/*');
    expect(await isBranchBaseLocked(anchorPath)).toBe(true);
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('feature named after a non-default remote branch tracks it without materializing the base head', async () => {
    const featureTip = git(remoteDir, 'rev-parse', 'feature/base');
    const worktrees = serviceWithRemoteUrl(remoteDir);

    const info = await worktrees.createWorktree(PROJECT, 'feature/base', uc);

    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'feature/base@{upstream}')).toBe('origin/feature/base');
    expect(git(info.path, 'rev-parse', 'HEAD')).toBe(featureTip);
    // Deliberate non-materialization: only feature branches become local heads.
    expect(() => anchorGitRaw('show-ref', '--verify', 'refs/heads/main')).toThrow();
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('feature with no remote counterpart forks from origin/{branchBase} with NO upstream', async () => {
    const mainTip = git(remoteDir, 'rev-parse', 'main');
    const worktrees = serviceWithRemoteUrl(remoteDir);

    const info = await worktrees.createWorktree(PROJECT, 'brand-new', uc);

    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('brand-new');
    // Forked from the remote base tip, not an orphan initial commit.
    expect(git(info.path, 'rev-parse', 'HEAD')).toBe(mainTip);
    // No upstream → BE reports hasUpstream=false → FE renders "Publish new branch".
    expect(() => git(info.path, 'rev-parse', '--abbrev-ref', 'brand-new@{upstream}')).toThrow();
  });

  it('remote HEAD ≠ default: converge records the remote HEAD as branchBase', async () => {
    // Separate remote whose default branch is `master`.
    const masterRemote = path.join(base, 'remote-master');
    fs.mkdirSync(masterRemote, { recursive: true });
    git(masterRemote, 'init', '-b', 'master');
    git(masterRemote, 'config', 'user.email', 't@t');
    git(masterRemote, 'config', 'user.name', 't');
    const masterTip = commit(masterRemote, 'a.txt', 'a', 'master-1');

    const worktrees = serviceWithRemoteUrl(masterRemote);
    const info = await worktrees.createWorktree(PROJECT, 'foo', uc);

    expect(readBranchBase(projectPath)).toBe('master');
    expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('master');
    // The ladder used the converged base for the remote-base fork.
    expect(git(info.path, 'rev-parse', 'HEAD')).toBe(masterTip);
    expect(() => git(info.path, 'rev-parse', '--abbrev-ref', 'foo@{upstream}')).toThrow();
  });
});

describe('createWorktree — refspec backfill on a pre-refspec bare-clone anchor', () => {
  it('backfills remote.origin.fetch and tracks the CURRENT remote tip', async () => {
    // Anchor bare-cloned by an old build: origin exists, refspec does NOT.
    git(base, 'clone', '--bare', remoteDir, anchorPath);
    expect(() => anchorGitRaw('config', '--get', 'remote.origin.fetch')).toThrow();

    // Remote advances after the clone.
    git(remoteDir, 'checkout', 'feature/base');
    const c2 = commit(remoteDir, 'f.txt', '2', 'feature-2');
    git(remoteDir, 'checkout', 'main');

    const worktrees = serviceWithRemoteUrl(remoteDir);
    const info = await worktrees.createWorktree(PROJECT, 'feature/base', uc);

    expect(anchorGitRaw('config', '--get', 'remote.origin.fetch'))
      .toBe('+refs/heads/*:refs/remotes/origin/*');
    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'feature/base@{upstream}')).toBe('origin/feature/base');
    expect(git(info.path, 'rev-parse', 'HEAD')).toBe(c2);
  });
});

describe('createWorktree — transactional rollback keeps unconnected anchors unlocked', () => {
  it('declared-but-nonexistent repo: falls back to the local ladder, origin rolled back', async () => {
    const worktrees = serviceWithRemoteUrl(path.join(base, 'no-such-remote'));

    const info = await worktrees.createWorktree(PROJECT, 'first', uc);

    // Orphan bootstrap succeeded (Publish/init flow preserved).
    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('first');
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(false);
    expect(await isBranchBaseLocked(anchorPath)).toBe(false);
  });

  it('empty remote (failed-init leftover): origin rolled back, anchor stays unlocked', async () => {
    const emptyRemote = path.join(base, 'remote-empty');
    fs.mkdirSync(emptyRemote, { recursive: true });
    git(emptyRemote, 'init', '-b', 'main');

    const worktrees = serviceWithRemoteUrl(emptyRemote);
    const info = await worktrees.createWorktree(PROJECT, 'first', uc);

    expect(git(info.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('first');
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(false);
    expect(await isBranchBaseLocked(anchorPath)).toBe(false);
  });

  it('unreachable remote on an EMPTY anchor: fails loud (retryable) instead of orphaning', async () => {
    const worktrees = serviceWithRemoteUrl('http://127.0.0.1:1/x.git');

    await expect(worktrees.createWorktree(PROJECT, 'first', uc)).rejects.toMatchObject({
      retryable: true,
    });
    // Rollback left no origin — a retry re-attempts convergence from scratch.
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(false);
    expect(await isBranchBaseLocked(anchorPath)).toBe(false);
  });
});
