/**
 * Phase 5 F6 — `WorktreeService.pruneCorruptWorktreeMeta` SSOT.
 *
 * Locks:
 *   1. corrupt worktree-meta entry whose `worktree` path is gone
 *      → metadata directory removed.
 *   2. valid worktree → preserved.
 *   3. final `git worktree prune --expire=now` (NOT bare prune) is what
 *      the helper invokes — important because bare prune honours the
 *      1h `safe.expire` window.
 *
 * Note on meta directory naming: git names the meta directory after the
 * worktree path's basename (NOT the branch name) when the basenames are
 * unique. We discover the actual name via `readdir` after `worktree add`
 * so the test stays robust to git's internal naming.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ant-worktree-prune-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function listMetaDirs(mainCodebase: string): string[] {
  const metaRoot = path.join(mainCodebase, '.git', 'worktrees');
  if (!existsSync(metaRoot)) return [];
  return readdirSync(metaRoot);
}

async function initRepo(mainCodebase: string) {
  mkdirSync(mainCodebase, { recursive: true });
  const git = simpleGit(mainCodebase);
  await git.init();
  await git.raw(['config', 'user.email', 'test@example.com']);
  await git.raw(['config', 'user.name', 'test']);
  writeFileSync(path.join(mainCodebase, 'README.md'), 'init');
  await git.add('.');
  await git.commit('init');
  return git;
}

describe('WorktreeService.pruneCorruptWorktreeMeta', () => {
  it('removes orphan worktree metadata when the worktree dir is gone', async () => {
    const main = path.join(tmp, 'codebase');
    const git = await initRepo(main);

    const orphanBranch = 'orphanfeature';
    const orphanWorktreePath = path.join(tmp, 'features', 'orphanfeature', 'codebase');
    mkdirSync(path.dirname(orphanWorktreePath), { recursive: true });
    await git.raw(['worktree', 'add', '-b', orphanBranch, orphanWorktreePath]);

    const metaBefore = listMetaDirs(main);
    expect(metaBefore.length).toBeGreaterThan(0);

    // Corrupt: delete the worktree directory while leaving the meta in place
    rmSync(orphanWorktreePath, { recursive: true, force: true });

    await WorktreeService.pruneCorruptWorktreeMeta(main);

    const metaAfter = listMetaDirs(main);
    expect(metaAfter.length).toBe(0);
  }, 15_000);

  it('preserves valid worktrees', async () => {
    const main = path.join(tmp, 'codebase');
    const git = await initRepo(main);

    const valid = path.join(tmp, 'features', 'realfeature', 'codebase');
    mkdirSync(path.dirname(valid), { recursive: true });
    await git.raw(['worktree', 'add', '-b', 'realfeature', valid]);

    const metaBefore = listMetaDirs(main);
    expect(metaBefore.length).toBe(1);

    await WorktreeService.pruneCorruptWorktreeMeta(main);

    expect(existsSync(valid)).toBe(true);
    const metaAfter = listMetaDirs(main);
    expect(metaAfter).toEqual(metaBefore);
  }, 15_000);

  it('uses --expire=now (regression — bare prune honours 1h safe.expire)', async () => {
    // Source-level lock: the helper string contains the literal flag.
    // (Behavioural verification is impractical without a per-second
    // mtime-based test, so we lock the call shape.)
    const fs = await import('fs/promises');
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'src/periphery/adapters/http/services/GitService/worktree/index.ts',
    );
    const src = await fs.readFile(file, 'utf-8');
    expect(src).toMatch(/worktree['",\s]+prune['",\s]+--expire=now/);
  });
});
