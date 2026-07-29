/**
 * Silver-bullet regression guards for the commit pathspec fatal
 * (`fatal: pathspec '<path>' did not match any files`).
 *
 * `git add <list>` aborts ATOMICALLY on the first path that matches neither
 * the worktree nor the index — one stale path (an untracked file deleted
 * after the FE snapshot) used to kill the whole commit, and the failure
 * self-perpetuated because no fresh snapshot ever reached the FE.
 *
 * The fix: live `git status` is the single pathspec authority — every add
 * site reconciles the caller list through `reconcileStagePaths` first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { StatusResult } from 'simple-git';
import { reconcileStagePaths } from '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/reconcileStagePaths';
import { GitOperationError } from '../../src/periphery/adapters/http/services/GitService/errors';
import type { UserContext } from '../../src/core/types/user';

// ── ant plan stub — lets the ant path run without an LLM. Tests can override
//    the implementation per-case (e.g. delete a file mid-"round-trip").
const authorAntCommitPlanMock = vi.fn();
vi.mock(
  '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/authorAntCommit',
  () => ({
    authorAntCommitPlan: (...args: unknown[]) => authorAntCommitPlanMock(...args),
  }),
);

// Imported AFTER the mock so CommitOperation picks up the stubbed planner.
import { CommitOperation } from '../../src/periphery/adapters/http/services/GitService/remote/operations/CommitOperation';

function fakeStatus(partial: Partial<StatusResult>): StatusResult {
  return {
    files: [],
    modified: [],
    deleted: [],
    not_added: [],
    ...partial,
  } as unknown as StatusResult;
}

describe('reconcileStagePaths — live status is the sole pathspec authority', () => {
  it('drops paths absent from the live status (the pathspec-fatal class)', () => {
    const status = fakeStatus({
      files: [{ path: 'a.ts' }, { path: 'b.ts' }] as StatusResult['files'],
    });
    const r = reconcileStagePaths(status, ['a.ts', 'ghost/deleted-after-snapshot.test.ts', 'b.ts']);
    expect(r.stageable).toEqual(['a.ts', 'b.ts']);
    expect(r.dropped).toEqual(['ghost/deleted-after-snapshot.test.ts']);
  });

  it('keeps tracked-deleted paths — `git add` stages the deletion', () => {
    const status = fakeStatus({
      files: [{ path: 'removed.ts' }] as StatusResult['files'],
      deleted: ['removed.ts'],
    });
    const r = reconcileStagePaths(status, ['removed.ts']);
    expect(r.stageable).toEqual(['removed.ts']);
    expect(r.tracked).toEqual(['removed.ts']);
  });

  it('keeps untracked paths and classifies them for discard', () => {
    const status = fakeStatus({
      files: [{ path: 'new.ts' }, { path: 'mod.ts' }] as StatusResult['files'],
      modified: ['mod.ts'],
      not_added: ['new.ts'],
    });
    const r = reconcileStagePaths(status, ['new.ts', 'mod.ts']);
    expect(r.stageable).toEqual(['new.ts', 'mod.ts']);
    expect(r.untracked).toEqual(['new.ts']);
    expect(r.tracked).toEqual(['mod.ts']);
  });

  it('dedupes while preserving first-seen order', () => {
    const status = fakeStatus({
      files: [{ path: 'a.ts' }, { path: 'b.ts' }] as StatusResult['files'],
    });
    const r = reconcileStagePaths(status, ['b.ts', 'a.ts', 'b.ts', 'a.ts']);
    expect(r.stageable).toEqual(['b.ts', 'a.ts']);
    expect(r.dropped).toEqual([]);
  });
});

// ── CommitOperation against a real temp repository ─────────────────────────

const userContext: UserContext = {
  organizationId: 'local',
  userId: 'local',
} as UserContext;

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
}

describe('CommitOperation — stale pathspecs cannot abort the commit', () => {
  let repo: string;
  let op: CommitOperation;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-commit-reconcile-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@test');
    git(repo, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, 'base.ts'), 'base\n');
    git(repo, 'add', 'base.ts');
    git(repo, 'commit', '-q', '-m', 'init');

    const workspaceResolver = {
      getCodebasePath: () => repo,
      getProjectPath: () => repo,
      getGitAnchorPath: () => repo,
    } as never;
    op = new CommitOperation(workspaceResolver, {} as never, undefined);
    authorAntCommitPlanMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('user path: drops the ghost path and commits the survivors', async () => {
    fs.writeFileSync(path.join(repo, 'real.ts'), 'real\n');
    const result = await op.execute(
      'proj',
      userContext,
      'feat: survivors',
      'feat',
      ['real.ts', 'src/domain/__tests__/gate-hp-tier-scale.test.ts'], // ghost never existed
      'user',
    );
    expect(result.success).toBe(true);
    expect(git(repo, 'log', '-1', '--pretty=%s')).toContain('feat: survivors');
    expect(git(repo, 'show', '--stat', '--name-only', 'HEAD')).toContain('real.ts');
  });

  it('user path: every selected file gone → retryable error, never a silent full commit', async () => {
    fs.writeFileSync(path.join(repo, 'unpicked.ts'), 'x\n'); // change the user did NOT select
    await expect(
      op.execute('proj', userContext, 'msg', 'feat', ['ghost-only.ts'], 'user'),
    ).rejects.toMatchObject({ retryable: true });
    // The unpicked change must NOT have been committed behind the user's back.
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    await expect(async () => new GitOperationError('x', 'unknown', {})).not.toThrow();
  });

  it('ant path: respects the user file selection instead of committing everything', async () => {
    fs.writeFileSync(path.join(repo, 'picked.ts'), 'p\n');
    fs.writeFileSync(path.join(repo, 'unpicked.ts'), 'u\n');
    authorAntCommitPlanMock.mockImplementation(async (_g, _r, _p, _u, allFiles: string[]) => [
      { message: 'ant: subset', files: allFiles },
    ]);

    const result = await op.execute('proj', userContext, undefined, 'feat', ['picked.ts'], 'ant');
    expect(result.success).toBe(true);
    // Planner only ever saw the selection…
    expect(authorAntCommitPlanMock.mock.calls[0][4]).toEqual(['picked.ts']);
    // …and only the selection landed in the commit.
    const committed = git(repo, 'show', '--name-only', '--pretty=format:', 'HEAD').trim();
    expect(committed).toBe('picked.ts');
    expect(git(repo, 'status', '--porcelain')).toContain('unpicked.ts');
  });

  it('ant path: file deleted during the LLM round-trip is dropped, not fatal', async () => {
    fs.writeFileSync(path.join(repo, 'stays.ts'), 's\n');
    fs.writeFileSync(path.join(repo, 'vanishes.ts'), 'v\n');
    authorAntCommitPlanMock.mockImplementation(async (_g, _r, _p, _u, allFiles: string[]) => {
      // Simulate a running job deleting an untracked file while the LLM plans.
      fs.rmSync(path.join(repo, 'vanishes.ts'));
      return [{ message: 'ant: raced', files: allFiles }];
    });

    const result = await op.execute('proj', userContext, undefined, 'feat', undefined, 'ant');
    expect(result.success).toBe(true);
    expect(result.commits).toHaveLength(1);
    const committed = git(repo, 'show', '--name-only', '--pretty=format:', 'HEAD').trim();
    expect(committed).toBe('stays.ts');
  });

  it('ant path: whole plan gone stale → clean no-op success, no fatal', async () => {
    fs.writeFileSync(path.join(repo, 'only.ts'), 'o\n');
    authorAntCommitPlanMock.mockImplementation(async () => {
      fs.rmSync(path.join(repo, 'only.ts'));
      return [{ message: 'ant: all gone', files: ['only.ts'] }];
    });

    const result = await op.execute('proj', userContext, undefined, 'feat', undefined, 'ant');
    expect(result.success).toBe(true);
    expect(result.commits).toEqual([]);
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });
});

describe('CommitOperation — index-resident ghosts (status lists, add rejects)', () => {
  // Production RCA (2026-07-29, polyhedron): an intent-to-add leftover from
  // `git add -N .` whose file was later deleted stays visible in `git status`
  // yet can make `git add <path>` abort the whole list. Disk existence — not
  // status membership — must decide how a path is staged.
  let repo: string;
  let op: CommitOperation;

  function makeItaGhost(name: string) {
    fs.writeFileSync(path.join(repo, name), 'ghost\n');
    git(repo, 'add', '-N', name);
    fs.rmSync(path.join(repo, name));
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-commit-ghost-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@test');
    git(repo, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, 'base.ts'), 'base\n');
    git(repo, 'add', 'base.ts');
    git(repo, 'commit', '-q', '-m', 'init');

    const workspaceResolver = {
      getCodebasePath: () => repo,
      getProjectPath: () => repo,
      getGitAnchorPath: () => repo,
    } as never;
    op = new CommitOperation(workspaceResolver, {} as never, undefined);
    authorAntCommitPlanMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('user path: ghost in selection is healed, survivors commit, index is clean after', async () => {
    makeItaGhost('phantom.test.ts');
    fs.writeFileSync(path.join(repo, 'real.ts'), 'real\n');
    // Sanity: the ghost IS visible in status (this is what defeated
    // status-based reconciliation alone).
    expect(git(repo, 'status', '--porcelain')).toContain('phantom.test.ts');

    const result = await op.execute('proj', userContext, 'feat: heal', 'feat', ['phantom.test.ts', 'real.ts'], 'user');
    expect(result.success).toBe(true);
    const committed = git(repo, 'show', '--name-only', '--pretty=format:', 'HEAD').trim();
    expect(committed).toBe('real.ts');
    // Ghost fully evicted — gone from index and from status.
    expect(git(repo, 'ls-files')).not.toContain('phantom.test.ts');
    expect(git(repo, 'status', '--porcelain')).not.toContain('phantom.test.ts');
  });

  it('user path: ghost-only selection → no-op success that self-heals the index', async () => {
    makeItaGhost('phantom.test.ts');
    const result = await op.execute('proj', userContext, 'msg', 'feat', ['phantom.test.ts'], 'user');
    expect(result.success).toBe(true);
    expect(result.commits).toBeUndefined();
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(git(repo, 'status', '--porcelain')).not.toContain('phantom.test.ts');
  });

  it('user path: tracked-deleted file still commits as a deletion (rm --cached route)', async () => {
    fs.rmSync(path.join(repo, 'base.ts'));
    const result = await op.execute('proj', userContext, 'feat: delete base', 'feat', ['base.ts'], 'user');
    expect(result.success).toBe(true);
    expect(git(repo, 'show', '--name-status', '--pretty=format:', 'HEAD')).toContain('D\tbase.ts');
    expect(git(repo, 'ls-files')).not.toContain('base.ts');
  });

  it('ant path: pre-existing ghost inside the plan group cannot abort the commit', async () => {
    makeItaGhost('phantom.test.ts');
    fs.writeFileSync(path.join(repo, 'stays.ts'), 's\n');
    authorAntCommitPlanMock.mockImplementation(async (_g, _r, _p, _u, allFiles: string[]) => [
      { message: 'ant: with ghost', files: allFiles },
    ]);

    const result = await op.execute('proj', userContext, undefined, 'feat', undefined, 'ant');
    expect(result.success).toBe(true);
    expect(result.commits).toHaveLength(1);
    const committed = git(repo, 'show', '--name-only', '--pretty=format:', 'HEAD').trim();
    expect(committed).toBe('stays.ts');
    expect(git(repo, 'status', '--porcelain')).not.toContain('phantom.test.ts');
  });

  it('ant path: ghost-only workspace → success without a commit, index healed', async () => {
    makeItaGhost('phantom.test.ts');
    authorAntCommitPlanMock.mockImplementation(async (_g, _r, _p, _u, allFiles: string[]) => [
      { message: 'ant: ghost only', files: allFiles },
    ]);

    const result = await op.execute('proj', userContext, undefined, 'feat', undefined, 'ant');
    expect(result.success).toBe(true);
    expect(result.commits).toEqual([]);
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(git(repo, 'status', '--porcelain')).not.toContain('phantom.test.ts');
  });
});
