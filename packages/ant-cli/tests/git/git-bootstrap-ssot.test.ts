/**
 * GitAnchorSSOT — the project's ONLY repository is the hidden bare anchor at
 * `{project}/repo.git`, created lazily by the first feature. These tests lock
 * the anchor primitives the worktree lifecycle is built on:
 *   - ensureAnchor: idempotent bare init + HEAD aligned to branchBase
 *   - createInitialCommitOnBranch: plumbing empty-tree commit on an empty anchor
 *   - readHeadBranch / setHeadBranch round-trip
 *   - hasOriginRemote: false for a fresh anchor (branchBase unlock signal)
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { UserContext } from '../../src/core/types/user';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';

const userContext: UserContext = {
  organizationId: 'test-org',
  userId: 'test-user',
};

const tmpRoots: string[] = [];

/**
 * Test-side reader for the bare anchor. Explicit GIT_DIR keeps bare usage
 * legal even under `safe.bareRepository=explicit`, and the env whitelist
 * avoids simple-git's unsafe-env guard (PAGER / GIT_EDITOR / GIT_CONFIG_*).
 */
function bareGit(anchorPath: string) {
  return simpleGit(anchorPath).env({
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    GIT_DIR: anchorPath,
  });
}

async function mkAnchorPath(prefix: string): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpRoots.push(root);
  return path.join(root, 'repo.git');
}

describe('GitAnchorSSOT', () => {
  afterEach(async () => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('ensureAnchor 는 bare anchor 를 생성하고 HEAD 를 branchBase 로 정렬한다', async () => {
    const anchorPath = await mkAnchorPath('ant-git-anchor-fresh-');

    const result = await gitAnchor.ensureAnchor({
      projectId: 'proj-fresh',
      anchorPath,
      branchBase: 'feat-first',
      userContext,
    });

    expect(result.created).toBe(true);
    // Bare repo validity — HEAD + objects exist directly under the anchor
    // (no `.git/` subdirectory; see GitHelper.isBareAnchorReady).
    expect(fs.existsSync(path.join(anchorPath, 'HEAD'))).toBe(true);
    expect(fs.existsSync(path.join(anchorPath, 'objects'))).toBe(true);
    expect(GitHelper.isBareAnchorReady(anchorPath)).toBe(true);
    // No working tree is ever materialized by the anchor itself.
    expect(fs.existsSync(path.join(anchorPath, '..', 'codebase'))).toBe(false);

    expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('feat-first');
  });

  it('ensureAnchor 는 멱등이다 — 두 번째 호출은 created:false', async () => {
    const anchorPath = await mkAnchorPath('ant-git-anchor-idem-');

    const first = await gitAnchor.ensureAnchor({
      projectId: 'proj-idem',
      anchorPath,
      branchBase: 'main',
      userContext,
    });
    const second = await gitAnchor.ensureAnchor({
      projectId: 'proj-idem',
      anchorPath,
      branchBase: 'main',
      userContext,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(GitHelper.isBareAnchorReady(anchorPath)).toBe(true);
  });

  it('createInitialCommitOnBranch 는 빈 anchor 에 plumbing empty-tree commit 을 만든다', async () => {
    const anchorPath = await mkAnchorPath('ant-git-anchor-initial-');
    await gitAnchor.ensureAnchor({
      projectId: 'proj-initial',
      anchorPath,
      branchBase: 'feat-1',
      userContext,
    });

    // Fresh anchor: branch does not exist yet.
    expect(await gitAnchor.branchExists(anchorPath, 'feat-1')).toBe(false);

    const commit = await gitAnchor.createInitialCommitOnBranch(anchorPath, 'feat-1', userContext);

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitAnchor.branchExists(anchorPath, 'feat-1')).toBe(true);

    const git = bareGit(anchorPath);
    const resolved = (await git.raw(['rev-parse', 'refs/heads/feat-1'])).trim();
    expect(resolved).toBe(commit);
    // Empty-tree commit — no parents, no files.
    const tree = (await git.raw(['ls-tree', commit])).trim();
    expect(tree).toBe('');
  });

  it('setHeadBranch / readHeadBranch 라운드트립', async () => {
    const anchorPath = await mkAnchorPath('ant-git-anchor-head-');
    await gitAnchor.ensureAnchor({
      projectId: 'proj-head',
      anchorPath,
      branchBase: 'main',
      userContext,
    });

    expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('main');
    await gitAnchor.setHeadBranch(anchorPath, 'feat-next');
    expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('feat-next');
  });

  it('fresh anchor 는 origin remote 가 없다 (branchBase unlock 신호)', async () => {
    const anchorPath = await mkAnchorPath('ant-git-anchor-remote-');

    // Not materialized yet → false (no throw).
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(false);

    await gitAnchor.ensureAnchor({
      projectId: 'proj-remote',
      anchorPath,
      branchBase: 'main',
      userContext,
    });
    expect(await gitAnchor.hasOriginRemote(anchorPath)).toBe(false);
  });
});
