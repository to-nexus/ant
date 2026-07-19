/**
 * Project/feature git bootstrap invariant — anchor model.
 *
 * NEW architecture: the ONLY repository is the hidden bare anchor at
 * `{project}/repo.git`, created lazily by the FIRST feature. Every feature is
 * a worktree at `features/{name}/codebase/` whose branch name is EXACTLY the
 * feature name. A fresh project (createProject) creates NO git and NO
 * codebase — `{project}/codebase/` no longer exists.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { UnifiedWorkspaceResolver, GIT_ANCHOR_DIR } from '../../src/core/config/WorkspacePathResolver';
import type { UserContext } from '../../src/core/types/user';
import { ProjectCrudService } from '../../src/periphery/adapters/http/services/ProjectService/ProjectCrudService';
import { FeatureCrudService } from '../../src/periphery/adapters/http/services/ProjectService/FeatureCrudService';
import { WorktreeService } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';
import { readBranchBase } from '../../src/core/utils/branchUtils';

const userContext: UserContext = {
  organizationId: 'org-test',
  userId: 'user-test',
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

async function mkWorkspace(): Promise<{ workspaceRoot: string; resolver: UnifiedWorkspaceResolver }> {
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-workspace-'));
  tmpRoots.push(workspaceRoot);
  return {
    workspaceRoot,
    resolver: new UnifiedWorkspaceResolver(workspaceRoot),
  };
}

async function currentBranch(codebasePath: string): Promise<string> {
  const git = simpleGit(codebasePath);
  return (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
}

async function hasCommit(codebasePath: string): Promise<boolean> {
  const git = simpleGit(codebasePath);
  const log = await git.log({ maxCount: 1 });
  return Boolean(log.latest);
}

describe('project/feature git bootstrap invariant', () => {
  afterEach(async () => {
    while (tmpRoots.length > 0) {
      const root = tmpRoots.pop()!;
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it('createProject 는 git 도 codebase 도 만들지 않는다 (anchor 는 첫 feature 가 lazy 생성)', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-no-bootstrap';

    await projectCrud.createProject(projectId, userContext);

    const projectPath = resolver.getProjectPath(userContext, projectId);
    expect(fs.existsSync(projectPath)).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'config.json'))).toBe(true);

    // NO bare anchor, NO main codebase — the old `{project}/codebase/` is gone.
    expect(fs.existsSync(resolver.getGitAnchorPath(userContext, projectId))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, GIT_ANCHOR_DIR))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'codebase'))).toBe(false);
  });

  it('첫 createFeature 가 bare anchor + worktree(branch == feature name) + initial commit 을 만든다', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-first-feature';
    await projectCrud.createProject(projectId, userContext);

    const featureCrud = new FeatureCrudService(resolver); // no stateStore → lifecycle lock skipped (test path)
    featureCrud.setWorktreeService(new WorktreeService(resolver));

    await featureCrud.createFeature(projectId, 'feat-1', userContext);

    // Bare anchor materialized at {project}/repo.git (HEAD + objects, no .git/).
    const anchorPath = resolver.getGitAnchorPath(userContext, projectId);
    expect(GitHelper.isBareAnchorReady(anchorPath)).toBe(true);

    // Feature worktree is valid, on the branch named EXACTLY the feature name,
    // with an initial commit.
    const featureCodebase = resolver.getCodebasePath(userContext, projectId, 'feat-1');
    expect(GitHelper.isWorktreeStructureValid(featureCodebase)).toEqual({ valid: true });
    expect(await currentBranch(featureCodebase)).toBe('feat-1');
    expect(await hasCommit(featureCodebase)).toBe(true);
    expect(fs.existsSync(path.join(featureCodebase, '.gitignore'))).toBe(true);

    // 0→1 transition auto-sets branchBase to the first feature and repoints
    // the anchor HEAD.
    const projectPath = resolver.getProjectPath(userContext, projectId);
    expect(readBranchBase(projectPath)).toBe('feat-1');
    const anchorHead = (await bareGit(anchorPath).raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(anchorHead).toBe('feat-1');
  });

  it('두 번째 feature 는 branchBase 에서 fork 한다', async () => {
    const { resolver } = await mkWorkspace();
    const projectCrud = new ProjectCrudService(resolver);
    const projectId = 'proj-second-feature';
    await projectCrud.createProject(projectId, userContext);

    const featureCrud = new FeatureCrudService(resolver);
    featureCrud.setWorktreeService(new WorktreeService(resolver));

    await featureCrud.createFeature(projectId, 'feat-1', userContext);
    await featureCrud.createFeature(projectId, 'feat-2', userContext);

    const anchorPath = resolver.getGitAnchorPath(userContext, projectId);
    const anchorGit = bareGit(anchorPath);

    // Both branches live in the anchor; feat-2 forked from branchBase (feat-1),
    // so at creation the two tips are identical.
    const feat1Tip = (await anchorGit.raw(['rev-parse', 'refs/heads/feat-1'])).trim();
    const feat2Tip = (await anchorGit.raw(['rev-parse', 'refs/heads/feat-2'])).trim();
    expect(feat2Tip).toBe(feat1Tip);

    const feature2Codebase = resolver.getCodebasePath(userContext, projectId, 'feat-2');
    expect(GitHelper.isWorktreeStructureValid(feature2Codebase)).toEqual({ valid: true });
    expect(await currentBranch(feature2Codebase)).toBe('feat-2');

    // branchBase stays pinned to the first feature (only the 0→1 transition
    // auto-applies).
    expect(readBranchBase(resolver.getProjectPath(userContext, projectId))).toBe('feat-1');
  });
});
