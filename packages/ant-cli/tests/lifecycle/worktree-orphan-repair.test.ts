/**
 * Phase 5 F6 — `WorktreeService.pruneCorruptWorktreeMeta` SSOT (anchor model).
 *
 * The helper takes the project's BARE ANCHOR PATH (`{project}/repo.git`);
 * worktree metadata lives at `{anchorPath}/worktrees` (there is no
 * `codebase/.git` — the anchor is the only repository).
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
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';
import type { UserContext } from '../../src/core/types/user';

const userContext: UserContext = {
  organizationId: 'org-test',
  userId: 'user-test',
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ant-worktree-prune-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function listMetaDirs(anchorPath: string): string[] {
  const metaRoot = path.join(anchorPath, 'worktrees');
  if (!existsSync(metaRoot)) return [];
  return readdirSync(metaRoot);
}

/** Bare anchor with an initial commit on `branch` (plumbing empty-tree commit). */
async function initAnchor(anchorPath: string, branch: string) {
  await gitAnchor.ensureAnchor({
    projectId: 'proj-prune',
    anchorPath,
    branchBase: branch,
    userContext,
  });
  await gitAnchor.createInitialCommitOnBranch(anchorPath, branch, userContext);
  // Explicit GIT_DIR keeps bare usage legal under `safe.bareRepository=explicit`;
  // env whitelist avoids simple-git's unsafe-env guard (PAGER / GIT_EDITOR / ...).
  return simpleGit(anchorPath).env({
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    GIT_DIR: anchorPath,
  });
}

describe('WorktreeService.pruneCorruptWorktreeMeta', () => {
  it('removes orphan worktree metadata when the worktree dir is gone', async () => {
    const anchor = path.join(tmp, 'repo.git');
    const git = await initAnchor(anchor, 'orphanfeature');

    const orphanWorktreePath = path.join(tmp, 'features', 'orphanfeature', 'codebase');
    mkdirSync(path.dirname(orphanWorktreePath), { recursive: true });
    await git.raw(['worktree', 'add', orphanWorktreePath, 'orphanfeature']);

    const metaBefore = listMetaDirs(anchor);
    expect(metaBefore.length).toBeGreaterThan(0);

    // Corrupt: delete the worktree directory while leaving the meta in place
    rmSync(orphanWorktreePath, { recursive: true, force: true });

    await WorktreeService.pruneCorruptWorktreeMeta(anchor);

    const metaAfter = listMetaDirs(anchor);
    expect(metaAfter.length).toBe(0);
  }, 15_000);

  it('preserves valid worktrees', async () => {
    const anchor = path.join(tmp, 'repo.git');
    const git = await initAnchor(anchor, 'realfeature');

    const valid = path.join(tmp, 'features', 'realfeature', 'codebase');
    mkdirSync(path.dirname(valid), { recursive: true });
    await git.raw(['worktree', 'add', valid, 'realfeature']);

    const metaBefore = listMetaDirs(anchor);
    expect(metaBefore.length).toBe(1);

    await WorktreeService.pruneCorruptWorktreeMeta(anchor);

    expect(existsSync(valid)).toBe(true);
    const metaAfter = listMetaDirs(anchor);
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
