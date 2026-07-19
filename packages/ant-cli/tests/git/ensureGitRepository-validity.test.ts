/**
 * `ensureGitRepository` — anchor-model resolution + Stage-4 self-heal.
 *
 * - feature present → the feature worktree; a `.git` marker referencing a
 *   partial gitdir (HEAD/commondir missing — EFS NFS partial writes) is
 *   detected at Stage-4 and self-healed via `worktreeService.createWorktree`
 *   (NEVER removeWorktree — that would `branch -D` the feature branch).
 * - feature absent + `allowAnchor` → the bare anchor (`repo.git`).
 * - feature absent otherwise → GitConfigError (a project without a selected
 *   feature has no working tree).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { ensureGitRepository } from '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/ensureGitRepository';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';
import { GitConfigError } from '../../src/periphery/adapters/http/services/GitService/errors';

const userContext: UserContext = {
  organizationId: 'org-test',
  userId: 'user-test',
};

const tmpRoots: string[] = [];

async function mkProject(): Promise<{ resolver: UnifiedWorkspaceResolver; projectId: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ant-ensure-validity-'));
  tmpRoots.push(root);
  const resolver = new UnifiedWorkspaceResolver(root);
  const projectId = 'proj-x';
  const projectPath = resolver.getProjectPath(userContext, projectId);
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(
    path.join(projectPath, 'config.json'),
    JSON.stringify({ repoType: 'cloud', repositoryName: projectId }, null, 2),
    'utf-8',
  );
  return { resolver, projectId };
}

/** Meta gitdir referenced by the worktree's `.git` marker. */
function metaDirOf(featureCodebase: string): string {
  const marker = readFileSync(path.join(featureCodebase, '.git'), 'utf-8').trim();
  const match = marker.match(/^gitdir:\s*(.+)$/);
  if (!match) throw new Error(`unexpected .git marker: ${marker}`);
  return match[1].trim();
}

describe('ensureGitRepository — anchor model + Stage-4 worktree validity self-heal', () => {
  afterEach(() => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('missing worktree → self-heal creates it; valid worktree → no recreate', async () => {
    const { resolver, projectId } = await mkProject();
    const worktreeService = new WorktreeService(resolver);

    // First call — no worktree yet. Self-heal lazily bootstraps the bare
    // anchor + creates the worktree (branch == feature name).
    const result1 = await ensureGitRepository({
      workspaceResolver: resolver,
      projectId,
      userContext,
      featureName: 'feat-1',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
    });
    expect(result1.git).toBeDefined();

    const featureCodebase = resolver.getCodebasePath(userContext, projectId, 'feat-1');
    expect(result1.codebasePath).toBe(featureCodebase);
    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({ valid: true });

    // Meta dir lives under the bare anchor's `worktrees/` (compare via
    // realpath — git records resolved paths, e.g. /private/var vs /var on macOS).
    const anchorPath = resolver.getGitAnchorPath(userContext, projectId);
    const metaDir = metaDirOf(featureCodebase);
    expect(realpathSync(metaDir).startsWith(path.join(realpathSync(anchorPath), 'worktrees'))).toBe(true);

    // Capture meta HEAD so we can prove no recreate happened.
    const headBefore = readFileSync(path.join(metaDir, 'HEAD'), 'utf-8');

    // Second call should be a no-op self-heal-wise (worktree already valid).
    await ensureGitRepository({
      workspaceResolver: resolver,
      projectId,
      userContext,
      featureName: 'feat-1',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
    });

    const headAfter = readFileSync(path.join(metaDir, 'HEAD'), 'utf-8');
    expect(headAfter).toBe(headBefore);
  });

  it('partial worktree (HEAD missing) → Stage-4 detects + self-heals to valid', async () => {
    const { resolver, projectId } = await mkProject();
    const worktreeService = new WorktreeService(resolver);

    // Bootstrap a valid worktree first (so we have a real meta dir to corrupt).
    await ensureGitRepository({
      workspaceResolver: resolver,
      projectId,
      userContext,
      featureName: 'feat-broken',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
    });

    // Simulate NFS partial write: delete HEAD from the meta dir while leaving
    // the worktree marker pointing at it (Stage-4 reason='head-missing').
    const featureCodebase = resolver.getCodebasePath(userContext, projectId, 'feat-broken');
    const metaDir = metaDirOf(featureCodebase);
    rmSync(path.join(metaDir, 'HEAD'));

    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({
      valid: false,
      reason: 'head-missing',
    });

    // Re-run ensureGitRepository → Stage-4 should detect the partial state and
    // self-heal via createWorktree re-attach (the branch lives in the anchor,
    // so committed state survives).
    const recovered = await ensureGitRepository({
      workspaceResolver: resolver,
      projectId,
      userContext,
      featureName: 'feat-broken',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
    });
    expect(recovered.git).toBeDefined();
    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({ valid: true });
  });

  it('featureName 없음 + allowAnchor → bare anchor git 반환', async () => {
    const { resolver, projectId } = await mkProject();
    const worktreeService = new WorktreeService(resolver);

    // Anchor not materialized yet (no features) → allowAnchor still fails
    // loudly rather than fabricating a repo.
    await expect(
      ensureGitRepository({
        workspaceResolver: resolver,
        projectId,
        userContext,
        operationName: 'TestEnsureGitRepo',
        allowAnchor: true,
      }),
    ).rejects.toBeInstanceOf(GitConfigError);

    // Materialize the anchor via the first feature worktree.
    await worktreeService.createWorktree(projectId, 'feat-1', userContext);

    const result = await ensureGitRepository({
      workspaceResolver: resolver,
      projectId,
      userContext,
      operationName: 'TestEnsureGitRepo',
      allowAnchor: true,
    });
    expect(result.git).toBeDefined();
    expect(result.codebasePath).toBe(resolver.getGitAnchorPath(userContext, projectId));

    // The anchor holds the feature branch (branch name == feature name) with
    // the bootstrap initial commit. (`log` on the anchor HEAD would hit the
    // unborn branchBase ref — the anchor HEAD is a pure pointer.)
    const tip = (await result.git.raw(['rev-parse', '--verify', 'refs/heads/feat-1'])).trim();
    expect(tip).toMatch(/^[0-9a-f]{40}$/);
  });

  it('featureName 없음 + allowAnchor 아님 → GitConfigError (feature 없는 프로젝트는 working tree 없음)', async () => {
    const { resolver, projectId } = await mkProject();

    await expect(
      ensureGitRepository({
        workspaceResolver: resolver,
        projectId,
        userContext,
        operationName: 'TestEnsureGitRepo',
      }),
    ).rejects.toBeInstanceOf(GitConfigError);
  });
});
