/**
 * Remote-branch tracking precedence — real git integration.
 *
 * Reproduces the "feature named after an existing remote branch is treated as a
 * brand-new (publishable) branch" defect. `git clone --bare` imports every remote
 * branch as a local head (refs/heads/*). When a feature is later created with the
 * same name, the branch-selection ladder must let the remote branch win: drop the
 * shadowing (stale) local head and create the worktree TRACKING origin/{name} at
 * its current tip — so `hasUpstream` is true and the UI offers fetch/pull, not
 * "Publish new branch".
 *
 * Guards the ordering fix in WorktreeService.createWorktree (remoteExists before
 * localExists). The greenfield case (no remote counterpart → new local branch,
 * no upstream) is asserted too, so the fix does not regress publish.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import type { GitHubAuthService } from '../../src/periphery/adapters/http/auth/GitHubAuthService';

const uc = { userId: 'u', organizationId: 'o' };
const PROJECT = 'proj';

let base: string;
let resolver: UnifiedWorkspaceResolver;
let worktrees: WorktreeService;
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

// updateRemoteUrl early-returns when config.githubRepo is unset (our config), so a
// truthy stub is enough to open the `githubAuthService && hasOriginRemote` gate.
const authStub = {} as unknown as GitHubAuthService;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-wt-remote-'));
  resolver = new UnifiedWorkspaceResolver(base);
  worktrees = new WorktreeService(resolver, authStub);
  projectPath = resolver.getProjectPath(uc, PROJECT);
  anchorPath = resolver.getGitAnchorPath(uc, PROJECT);
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ repoType: 'cloud' }), 'utf-8');

  // Real "remote": default branch `main` + a `feature/base` branch.
  remoteDir = path.join(base, 'remote-src');
  fs.mkdirSync(remoteDir, { recursive: true });
  git(remoteDir, 'init', '-b', 'main');
  git(remoteDir, 'config', 'user.email', 't@t');
  git(remoteDir, 'config', 'user.name', 't');
  commit(remoteDir, 'main.txt', 'm', 'main-1');
  git(remoteDir, 'checkout', '-b', 'feature/base');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('createWorktree — remote branch tracking precedence', () => {
  it('feature named after an existing remote branch tracks origin at its current tip', async () => {
    // feature/base = c1 at clone time.
    const c1 = commit(remoteDir, 'f.txt', '1', 'feature-1');

    // Bare clone: imports feature/base + main as local heads, no fetch refspec.
    git(base, 'clone', '--bare', remoteDir, anchorPath);
    // clone --bare omits the fetch refspec — production adds it (CloneOperation.ts).
    execFileSync('git', ['--git-dir', anchorPath, 'config', 'remote.origin.fetch',
      '+refs/heads/*:refs/remotes/origin/*'], { encoding: 'utf-8' });

    // Origin advances AFTER clone → local head feature/base (c1) is now stale.
    const c2 = commit(remoteDir, 'f.txt', '2', 'feature-2');
    expect(c2).not.toBe(c1);

    const info = await worktrees.createWorktree(PROJECT, 'feature/base', uc);
    const wt = info.path;

    // Tracks origin/feature/base ...
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'feature/base@{upstream}')).toBe('origin/feature/base');
    // ... at the current remote tip, NOT the stale clone-time commit.
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(c2);
    expect(git(wt, 'rev-parse', 'HEAD')).not.toBe(c1);
  });

  it('greenfield: feature with no remote counterpart is a new local branch with no upstream', async () => {
    commit(remoteDir, 'f.txt', '1', 'feature-1');
    git(base, 'clone', '--bare', remoteDir, anchorPath);
    execFileSync('git', ['--git-dir', anchorPath, 'config', 'remote.origin.fetch',
      '+refs/heads/*:refs/remotes/origin/*'], { encoding: 'utf-8' });

    const info = await worktrees.createWorktree(PROJECT, 'brand-new-feature', uc);
    const wt = info.path;

    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('brand-new-feature');
    // No upstream → BE reports hasUpstream=false → FE renders "Publish new branch".
    expect(() => git(wt, 'rev-parse', '--abbrev-ref', 'brand-new-feature@{upstream}')).toThrow();
  });
});
