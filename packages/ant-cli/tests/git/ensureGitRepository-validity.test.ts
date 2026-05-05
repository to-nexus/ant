/**
 * `ensureGitRepository` Stage-4 self-heal regression.
 *
 * Verifies that a feature codebase whose `.git` marker exists but references a
 * partial gitdir (HEAD/commondir missing — the user's "Initialize Repository"
 * symptom on EFS NFS partial writes) is detected and self-healed via the
 * existing backup → removeWorktree → createWorktree → restore flow. Without
 * this Stage-4 hook, `getGitInstanceSafe` returns a usable git instance and
 * downstream ops fail with "fatal: not a git repository: <gitdir>".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';

import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { ensureGitRepository } from '../../src/periphery/adapters/http/services/GitService/remote/operations/helpers/ensureGitRepository';
import { GitBootstrapSSOT } from '../../src/periphery/adapters/http/services/GitService/remote/operations/BaseGitSetupOperation';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { FeatureCodebaseBackup } from '../../src/periphery/adapters/http/services/GitService/worktree/FeatureCodebaseBackup';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';

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
    JSON.stringify({ repoType: 'cloud', repositoryName: projectId, branchBase: 'main' }, null, 2),
    'utf-8',
  );
  return { resolver, projectId };
}

describe('ensureGitRepository — Stage-4 worktree validity self-heal', () => {
  afterEach(() => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('valid feature worktree → returns git instance, no recreate', async () => {
    const { resolver, projectId } = await mkProject();
    const featureCrudPath = resolver.getFeaturePath(userContext, projectId, 'feat-1');
    mkdirSync(path.join(featureCrudPath, 'codebase'), { recursive: true });

    const worktreeService = new WorktreeService(resolver);
    const gitBootstrap = new GitBootstrapSSOT(resolver, 'TestEnsureGitRepo');
    const featureBackup = new FeatureCodebaseBackup(resolver);

    // First call → bootstraps + creates valid worktree
    const result1 = await ensureGitRepository({
      workspaceResolver: resolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName: 'feat-1',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
      featureBackup,
    });
    expect(result1.git).toBeDefined();

    const featureCodebase = resolver.getCodebasePath(userContext, projectId, 'feat-1');
    const validity = GitHelper.isWorktreeStructureValid(featureCodebase);
    expect(validity).toEqual({ valid: true });

    // Capture meta dir mtime so we can prove no recreate happened.
    const abs = GitHelper.resolveWorktreeAbsPaths(featureCodebase)!;
    const headBefore = readFileSync(path.join(abs.mainGitDir, 'worktrees', path.basename(featureCodebase), 'HEAD'), 'utf-8');

    // Second call should be a no-op self-heal-wise (worktree already valid).
    await ensureGitRepository({
      workspaceResolver: resolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName: 'feat-1',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
      featureBackup,
    });

    const headAfter = readFileSync(path.join(abs.mainGitDir, 'worktrees', path.basename(featureCodebase), 'HEAD'), 'utf-8');
    expect(headAfter).toBe(headBefore);
  });

  it('partial worktree (HEAD missing) → Stage-4 detects + self-heals to valid', async () => {
    const { resolver, projectId } = await mkProject();
    const featureCrudPath = resolver.getFeaturePath(userContext, projectId, 'feat-broken');
    mkdirSync(path.join(featureCrudPath, 'codebase'), { recursive: true });

    const worktreeService = new WorktreeService(resolver);
    const gitBootstrap = new GitBootstrapSSOT(resolver, 'TestEnsureGitRepo');
    const featureBackup = new FeatureCodebaseBackup(resolver);

    // Bootstrap a valid worktree first (so we have a real meta dir to corrupt).
    await ensureGitRepository({
      workspaceResolver: resolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName: 'feat-broken',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
      featureBackup,
    });

    // Simulate NFS partial write: delete HEAD from the meta dir while leaving
    // the worktree marker pointing at it (Stage-4 reason='head-missing').
    const featureCodebase = resolver.getCodebasePath(userContext, projectId, 'feat-broken');
    const abs = GitHelper.resolveWorktreeAbsPaths(featureCodebase)!;
    const metaDir = path.join(abs.mainGitDir, 'worktrees', path.basename(featureCodebase));
    rmSync(path.join(metaDir, 'HEAD'));

    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({
      valid: false,
      reason: 'head-missing',
    });

    // Re-run ensureGitRepository → Stage-4 should detect the partial state
    // and self-heal via backup → removeWorktree → createWorktree → restore.
    const recovered = await ensureGitRepository({
      workspaceResolver: resolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName: 'feat-broken',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
      featureBackup,
    });
    expect(recovered.git).toBeDefined();
    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({ valid: true });
  });

  it('RESERVED feature (_base) → Stage-4 skipped (main repo path)', async () => {
    const { resolver, projectId } = await mkProject();
    const worktreeService = new WorktreeService(resolver);
    const gitBootstrap = new GitBootstrapSSOT(resolver, 'TestEnsureGitRepo');
    const featureBackup = new FeatureCodebaseBackup(resolver);

    const result = await ensureGitRepository({
      workspaceResolver: resolver,
      gitBootstrap,
      projectId,
      userContext,
      featureName: '_base',
      operationName: 'TestEnsureGitRepo',
      worktreeService,
      featureBackup,
    });
    expect(result.git).toBeDefined();
    // main repo .git is a directory → not a worktree (validity skipped, treated as valid)
    const mainCodebase = resolver.getCodebasePath(userContext, projectId);
    expect(existsSync(path.join(mainCodebase, '.git'))).toBe(true);
    const log = await simpleGit(mainCodebase).log({ maxCount: 1 });
    expect(log.latest).toBeDefined();
  });
});
