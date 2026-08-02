/**
 * Bare-anchor first-feature bootstrap — real git integration.
 *
 * - createWorktree on a fresh project materializes `repo.git` (bare) via
 *   plumbing (mktree/commit-tree, no `worktree add --orphan` dependency),
 *   attaches a worktree whose branch == feature name, and seeds
 *   .gitignore/README with a normal commit.
 * - a second feature forks from the branchBase feature's branch.
 * - a feature named after an existing local branch attaches to it.
 * - clone/init preconditions: the clone zero-feature hard guard rejects a
 *   project with features; init's `ensureBaseFeature` does the mirror image —
 *   it materializes the base-branch feature when there is none.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';
import { CloneOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/CloneOperation';
import { ensureBaseFeature } from '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/ensureBaseFeature';
import { readBranchBase } from '../../src/core/utils/branchUtils';

const uc = { userId: 'u', organizationId: 'o' };
const PROJECT = 'proj';

let base: string;
let resolver: UnifiedWorkspaceResolver;
let worktrees: WorktreeService;
let projectPath: string;
let anchorPath: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

/** Bare-anchor git — explicit --git-dir keeps `safe.bareRepository=explicit` environments working. */
function anchorGit(...args: string[]): string {
  return execFileSync('git', ['--git-dir', anchorPath, ...args], { encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-anchor-'));
  resolver = new UnifiedWorkspaceResolver(base);
  worktrees = new WorktreeService(resolver);
  projectPath = resolver.getProjectPath(uc, PROJECT);
  anchorPath = resolver.getGitAnchorPath(uc, PROJECT);
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ repoType: 'cloud' }), 'utf-8');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('bare anchor first-feature bootstrap', () => {
  it('fresh project has no anchor and no codebase dir', () => {
    expect(fs.existsSync(anchorPath)).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'codebase'))).toBe(false);
  });

  it('first createWorktree creates the bare anchor + worktree with branch == feature name', async () => {
    const info = await worktrees.createWorktree(PROJECT, 'login', uc);

    expect(GitHelper.isBareAnchorReady(anchorPath)).toBe(true);
    expect(anchorGit('rev-parse', '--is-bare-repository')).toBe('true');

    const wt = resolver.getCodebasePath(uc, PROJECT, 'login');
    expect(info.path).toBe(wt);
    expect(info.branch).toBe('login');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('login');

    // seeded commit present (initial commit + seed commit history is non-empty)
    const log = git(wt, 'log', '--oneline');
    expect(log.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(wt, '.gitignore'))).toBe(true);

    // stage-4 valid worktree
    expect(GitHelper.isWorktreeStructureValid(wt)).toEqual({ valid: true });
  });

  it('rejects invalid feature names before touching disk', async () => {
    // `feat/login` is now VALID (git-style nesting); use a genuinely-illegal name.
    await expect(worktrees.createWorktree(PROJECT, 'a//b', uc)).rejects.toThrow(/invalid feature name/i);
    expect(fs.existsSync(anchorPath)).toBe(false);
  });

  it('slash feature name → slug worktree dir, verbatim branch name', async () => {
    const info = await worktrees.createWorktree(PROJECT, 'release/1.0', uc);

    // worktree dir uses the `/`-free slug…
    const wt = resolver.getCodebasePath(uc, PROJECT, 'release/1.0');
    expect(wt.endsWith(path.join('features', 'release~1.0', 'codebase'))).toBe(true);
    expect(info.path).toBe(wt);
    // …but the git branch is the raw name, verbatim.
    expect(info.branch).toBe('release/1.0');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/1.0');
    expect(GitHelper.isWorktreeStructureValid(wt)).toEqual({ valid: true });
  });

  it('second feature forks from the branchBase branch', async () => {
    await worktrees.createWorktree(PROJECT, 'login', uc);
    fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify({ repoType: 'cloud', branchBase: 'login' }), 'utf-8');

    // put a marker commit on the base branch so lineage is observable
    const baseWt = resolver.getCodebasePath(uc, PROJECT, 'login');
    fs.writeFileSync(path.join(baseWt, 'marker.txt'), 'x', 'utf-8');
    git(baseWt, 'add', '.');
    git(baseWt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'marker');

    await worktrees.createWorktree(PROJECT, 'checkout', uc);
    const wt2 = resolver.getCodebasePath(uc, PROJECT, 'checkout');
    expect(git(wt2, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('checkout');
    expect(fs.existsSync(path.join(wt2, 'marker.txt'))).toBe(true);
  });

  it('a feature named after an existing local branch attaches to it', async () => {
    await worktrees.createWorktree(PROJECT, 'login', uc);
    anchorGit('branch', 'hotfix', 'login');

    const info = await worktrees.createWorktree(PROJECT, 'hotfix', uc);
    expect(info.branch).toBe('hotfix');
    const wt = resolver.getCodebasePath(uc, PROJECT, 'hotfix');
    expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('hotfix');
  });

  it('removeWorktree deletes the worktree and its branch', async () => {
    await worktrees.createWorktree(PROJECT, 'login', uc);
    await worktrees.createWorktree(PROJECT, 'temp', uc);

    await worktrees.removeWorktree(PROJECT, 'temp', uc);
    const wt = resolver.getCodebasePath(uc, PROJECT, 'temp');
    expect(fs.existsSync(wt)).toBe(false);
    expect(() => anchorGit('show-ref', '--verify', 'refs/heads/temp')).toThrow();
  });

  it('clone hard-guard: rejects a project that already has features', async () => {
    fs.mkdirSync(path.join(projectPath, 'features', 'login', 'codebase'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ repoType: 'cloud', githubRepo: 'https://github.com/x/y' }),
      'utf-8',
    );
    const clone = new CloneOperation(resolver, worktrees, {} as any);
    await expect(clone.execute(PROJECT, uc)).rejects.toThrow(/no features/i);
  });

  describe('ensureBaseFeature (init precondition)', () => {
    const ctx = () => ({
      projectId: PROJECT,
      projectPath,
      anchorPath,
      userContext: uc,
      branchBase: readBranchBase(projectPath),
      worktreeService: worktrees,
    });

    it('zero features → materializes the base-branch feature + pointer', async () => {
      const res = await ensureBaseFeature(ctx());

      expect(res).toEqual({ created: true, feature: 'main' });
      const wt = resolver.getCodebasePath(uc, PROJECT, 'main');
      expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
      expect(GitHelper.isWorktreeStructureValid(wt)).toEqual({ valid: true });
      expect(readBranchBase(projectPath)).toBe('main');
      expect(anchorGit('symbolic-ref', '--short', 'HEAD')).toBe('main');
    });

    it('honours a configured base branch', async () => {
      fs.writeFileSync(
        path.join(projectPath, 'config.json'),
        JSON.stringify({ repoType: 'cloud', branchBase: 'dev' }),
        'utf-8',
      );
      const res = await ensureBaseFeature(ctx());

      expect(res).toEqual({ created: true, feature: 'dev' });
      const wt = resolver.getCodebasePath(uc, PROJECT, 'dev');
      expect(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev');
    });

    it('no-op when a feature already exists', async () => {
      await worktrees.createWorktree(PROJECT, 'login', uc);
      const before = fs.readdirSync(path.join(projectPath, 'features'));

      expect(await ensureBaseFeature(ctx())).toEqual({ created: false });
      expect(fs.readdirSync(path.join(projectPath, 'features'))).toEqual(before);
    });

    it('rejects an unusable base branch name', async () => {
      fs.writeFileSync(
        path.join(projectPath, 'config.json'),
        JSON.stringify({ repoType: 'cloud', branchBase: 'a//b' }),
        'utf-8',
      );
      await expect(ensureBaseFeature(ctx())).rejects.toThrow(/not a usable branch name/i);
      expect(fs.existsSync(anchorPath)).toBe(false);
    });
  });
});
