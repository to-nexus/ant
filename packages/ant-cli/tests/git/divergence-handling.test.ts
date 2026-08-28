/**
 * Divergent-branch handling across push / pull / sync — real git integration.
 *
 * Two production failures, one state (`ahead>0 && behind>0`):
 *
 *  - `git pull` with no strategy is REFUSED outright by git >= 2.34
 *    ("fatal: Need to specify how to reconcile divergent branches"), which
 *    took Sync down with it — the only recovery from the second failure.
 *  - `push` decided from `ahead`/`behind` that no fetch had refreshed since
 *    the clone, so GitHub rejected it non-fast-forward and the raw stderr
 *    became the user-facing error.
 *
 * The host's own `pull.rebase` would mask the first one entirely, so the
 * suite pins GIT_CONFIG_GLOBAL/SYSTEM to a scratch file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import simpleGit from 'simple-git';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { PushOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/PushOperation';
import { PullOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/PullOperation';
import { SyncOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/SyncOperation';
import { pullArgs } from '../../src/periphery/adapters/http/services/GitService/remote/helpers/pullStrategy';
import {
  asPushRejection,
  GitOperationError,
} from '../../src/periphery/adapters/http/services/GitService/errors';
import type { GitHubAuthService } from '../../src/periphery/adapters/auth/GitHubAuthService';

const uc = { userId: 'u', organizationId: 'o' };
const PROJECT = 'proj';
const FEATURE = 'main';

let base: string;
let resolver: UnifiedWorkspaceResolver;
let worktrees: WorktreeService;
let anchorPath: string;
let remoteBare: string;
let collaborator: string;
let worktreePath: string;
let envBackup: Record<string, string | undefined>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

function commit(cwd: string, file: string, content: string, message: string): string {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** `buildAuthenticatedUrl` is the only method these operations call. */
let authUrlOverride: string | null = null;
const authStub = {
  buildAuthenticatedUrl: async () => authUrlOverride ?? remoteBare,
} as unknown as GitHubAuthService;

const push = () => new PushOperation(resolver, worktrees, authStub).execute(PROJECT, uc, FEATURE);
const pull = (strategy?: unknown) =>
  new PullOperation(resolver, worktrees, authStub).execute(PROJECT, uc, FEATURE, strategy);
const sync = (strategy?: unknown) =>
  new SyncOperation(resolver, worktrees, authStub).execute(PROJECT, uc, FEATURE, strategy);

/** Advance origin/main from a second clone — the "other machine". */
function advanceRemote(file: string, content: string, message: string): string {
  const head = commit(collaborator, file, content, message);
  git(collaborator, 'push', 'origin', 'main');
  return head;
}

function remoteTip(): string {
  return git(collaborator, 'ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
}

function statusOf() {
  return simpleGit({ baseDir: worktreePath }).status();
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-git-diverge-'));
  envBackup = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
  };
  // A developer machine with `pull.rebase=true` silently reconciles the very
  // divergence this suite is about — isolate, but keep the file writable so
  // `safe.directory` writes still land somewhere.
  process.env.GIT_CONFIG_GLOBAL = path.join(base, 'gitconfig');
  process.env.GIT_CONFIG_SYSTEM = path.join(base, 'gitconfig-system');
});

/**
 * Materialize anchor + worktree + a seeded remote. Called explicitly (not in
 * `beforeEach`) so the pure-unit rows don't pay ~2s of git subprocesses each.
 */
async function materializeWorkspace(): Promise<void> {
  resolver = new UnifiedWorkspaceResolver(base);
  worktrees = new WorktreeService(resolver, authStub);
  anchorPath = resolver.getGitAnchorPath(uc, PROJECT);
  const projectPath = resolver.getProjectPath(uc, PROJECT);
  fs.mkdirSync(projectPath, { recursive: true });

  remoteBare = path.join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoteBare]);
  fs.writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify({ repoType: 'cloud', githubRepo: remoteBare, branchBase: 'main' }),
    'utf-8',
  );

  // Seed the remote through a collaborator clone; it doubles as the "other
  // machine" that pushes while the workspace is not looking.
  collaborator = path.join(base, 'collaborator');
  execFileSync('git', ['clone', '-q', remoteBare, collaborator]);
  git(collaborator, 'config', 'user.email', 'c@c');
  git(collaborator, 'config', 'user.name', 'c');
  commit(collaborator, 'shared.txt', 'base', 'base');
  git(collaborator, 'push', '-q', '-u', 'origin', 'main');

  execFileSync('git', ['clone', '-q', '--bare', remoteBare, anchorPath]);
  execFileSync('git', [
    '--git-dir', anchorPath, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*',
  ]);

  const info = await worktrees.createWorktree(PROJECT, FEATURE, uc);
  worktreePath = info.path;
  git(worktreePath, 'config', 'user.email', 'w@w');
  git(worktreePath, 'config', 'user.name', 'w');
}

afterEach(() => {
  authUrlOverride = null;
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(base, { recursive: true, force: true });
});

describe('pullArgs — strategy whitelist', () => {
  // The value arrives unvalidated from the HTTP body; anything but the exact
  // literal must fold to merge rather than reach git's argv as a flag.
  it.each([
    [undefined, ['--no-rebase', '--no-edit']],
    ['merge', ['--no-rebase', '--no-edit']],
    ['rebase', ['--rebase']],
    ['REBASE', ['--no-rebase', '--no-edit']],
    ['--exec=touch /tmp/pwned', ['--no-rebase', '--no-edit']],
  ])('%o → %o', (input, expected) => {
    expect(pullArgs(input)).toEqual(expected);
  });

  it('folds a non-string that merely stringifies to "rebase"', () => {
    expect(pullArgs({ toString: () => 'rebase' })).toEqual(['--no-rebase', '--no-edit']);
  });
});

describe('pull — divergent branches', () => {
  it('reconciles with a merge when no strategy is given (a bare git pull is refused)', async () => {
    await materializeWorkspace();
    advanceRemote('theirs.txt', 'r', 'remote-1');
    commit(worktreePath, 'mine.txt', 'l', 'local-1');

    await pull();

    expect(git(worktreePath, 'log', '--oneline', '--merges')).not.toBe('');
    expect(fs.existsSync(path.join(worktreePath, 'theirs.txt'))).toBe(true);
  });

  it('replays local commits on top with strategy=rebase (no merge commit)', async () => {
    await materializeWorkspace();
    advanceRemote('theirs.txt', 'r', 'remote-1');
    commit(worktreePath, 'mine.txt', 'l', 'local-1');

    await pull('rebase');

    expect(git(worktreePath, 'log', '--oneline', '--merges')).toBe('');
    expect(fs.existsSync(path.join(worktreePath, 'theirs.txt'))).toBe(true);
    const status = await statusOf();
    expect(status.behind).toBe(0);
    expect(status.ahead).toBe(1);
  });

  it('rolls a conflicted rebase back and asks for merge instead', async () => {
    await materializeWorkspace();
    advanceRemote('shared.txt', 'remote-side', 'remote-1');
    commit(worktreePath, 'shared.txt', 'local-side', 'local-1');

    await expect(pull('rebase')).rejects.toMatchObject({
      kind: 'conflict',
      suggestedAction: 'retryWithMerge',
      retryable: false,
    });

    // GitSnapshot has no "rebase in progress" channel — a stopped rebase would
    // make every later read lie about the worktree.
    const gitDir = git(worktreePath, 'rev-parse', '--absolute-git-dir');
    expect(fs.existsSync(path.join(gitDir, 'rebase-merge'))).toBe(false);
    const status = await statusOf();
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.isClean()).toBe(true);
  });

  it('refuses before touching the tree when the worktree is dirty', async () => {
    await materializeWorkspace();
    advanceRemote('theirs.txt', 'r', 'remote-1');
    fs.writeFileSync(path.join(worktreePath, 'shared.txt'), 'work in progress');

    await expect(pull()).rejects.toMatchObject({
      kind: 'conflict',
      suggestedAction: 'commitFirst',
    });

    // Untouched: no merge happened, the edit is intact.
    expect(fs.readFileSync(path.join(worktreePath, 'shared.txt'), 'utf-8')).toBe('work in progress');
    expect(fs.existsSync(path.join(worktreePath, 'theirs.txt'))).toBe(false);
  });

  it('classifies unrelated histories instead of surfacing the raw fatal', async () => {
    await materializeWorkspace();
    const g = simpleGit({ baseDir: worktreePath });
    await g.raw(['checkout', '--orphan', 'tmp-orphan']);
    await g.raw(['rm', '-rf', '--cached', '.']);
    fs.rmSync(path.join(worktreePath, 'shared.txt'), { force: true });
    fs.writeFileSync(path.join(worktreePath, 'alone.txt'), 'x');
    await g.add('.');
    await g.commit('unrelated root');
    await g.raw(['branch', '-f', 'main', 'HEAD']);
    await g.raw(['checkout', 'main']);
    advanceRemote('theirs.txt', 'r', 'remote-1');

    await expect(pull()).rejects.toThrow(/no common history/i);
  });
});

describe('push — preflight against the real remote', () => {
  it('refuses a diverged push before contacting the remote', async () => {
    await materializeWorkspace();
    const tipBefore = advanceRemote('theirs.txt', 'r', 'remote-1');
    commit(worktreePath, 'mine.txt', 'l', 'local-1');

    await expect(push()).rejects.toMatchObject({
      kind: 'conflict',
      suggestedAction: 'syncFirst',
      retryable: false,
      params: { branch: 'main', count: 1 },
    });

    // The remote was never written to — this is the whole point of preflight.
    expect(remoteTip()).toBe(tipBefore);
  });

  it('pushes when only the local side is ahead', async () => {
    await materializeWorkspace();
    const head = commit(worktreePath, 'mine.txt', 'l', 'local-1');
    await push();
    expect(remoteTip()).toBe(head);
  });

  it('still pushes when the preflight fetch cannot run', async () => {
    await materializeWorkspace();
    // Fetch and push resolve different URLs: the fetch URL is a dead path, the
    // pushurl is the real remote. A preflight that cannot run must never block
    // a push that would otherwise succeed.
    git(worktreePath, 'config', 'remote.origin.pushurl', remoteBare);
    authUrlOverride = path.join(base, 'no-such-remote.git');
    const head = commit(worktreePath, 'mine.txt', 'l', 'local-1');

    await push();

    expect(remoteTip()).toBe(head);
  });

  it('classifies a rejection that slips past the preflight', async () => {
    await materializeWorkspace();
    let raw: unknown;
    try {
      // Diverge and push with git directly — the exact stderr production sees.
      advanceRemote('theirs.txt', 'r', 'remote-1');
      commit(worktreePath, 'mine.txt', 'l', 'local-1');
      git(worktreePath, 'push', 'origin', 'main');
    } catch (error) {
      raw = error;
    }
    expect(raw).toBeDefined();
    const promoted = asPushRejection(raw);
    expect(promoted).toBeInstanceOf(GitOperationError);
    expect(promoted?.kind).toBe('conflict');
    expect(promoted?.suggestedAction).toBe('syncFirst');
    expect(asPushRejection(new Error('something else entirely'))).toBeNull();
  });
});

describe('sync — the recovery the push error points at', () => {
  it('completes pull + push from a diverged state', async () => {
    await materializeWorkspace();
    advanceRemote('theirs.txt', 'r', 'remote-1');
    const mine = commit(worktreePath, 'mine.txt', 'l', 'local-1');

    const result = await sync();

    expect(result).toMatchObject({ success: true, pulledChanges: true, pushedChanges: true });
    expect(fs.existsSync(path.join(worktreePath, 'theirs.txt'))).toBe(true);
    expect(remoteTip()).toBe(git(worktreePath, 'rev-parse', 'HEAD'));
    expect(git(worktreePath, 'rev-parse', 'HEAD')).not.toBe(mine);
  });
});
