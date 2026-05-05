import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { GitHelper } from '../helper/GitHelper';
import { ensureCanonicalStructure } from '../../../../../../core/utils/sessionPaths';
import { readBranchBaseFromConfig, RESERVED_FEATURE_NAME } from '../../../../../../core/utils/branchUtils';
import { logger } from '../../../../../../utils/logger';
import { GitOperationError } from '../errors';
import { GitBootstrapSSOT } from '../remote/operations/BaseGitSetupOperation';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * WorktreeService
 * 
 * Manages Git worktrees for feature-based codebase isolation.
 * Replaces BranchService's checkout/stash logic with worktree-based isolation.
 * 
 * Each feature gets its own worktree directory (features/{name}/codebase/)
 * backed by a feature/{name} branch. The main worktree lives at projectPath/codebase/.
 * 
 * Key operations:
 * - createWorktree: Creates a new worktree + branch for a feature
 * - removeWorktree: Removes worktree and optionally deletes the branch
 * - listWorktrees: Lists all active worktrees
 */
export class WorktreeService {
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'WorktreeService');
  }

  /**
   * Create a worktree for a feature.
   * 
   * This creates a new Git worktree at the feature's codebase path,
   * either from an existing remote branch or as a new branch from base.
   */
  async createWorktree(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<WorktreeInfo> {
    const mainCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);
    const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const branchName = GitHelper.sanitizeBranchName(featureName);

    // Path-collision guard: in `repoType: 'local'` mode (user-mapped external
    // codebase) all features resolve to the same shared codebase path. A real
    // `git worktree add` here would target the main repo itself and corrupt
    // it. Guarantee main-repo bootstrap is done and short-circuit; the feature
    // operates as a logical alias of base. (Three-axis split: repoType=local
    // is intentionally a single shared codebase by design.)
    if (mainCodebasePath === worktreePath) {
      logger.info(`Worktree skipped — main and feature paths are identical (repoType:'local' or RESERVED feature)`, {
        component: 'WorktreeService',
        projectId,
        featureName,
      });
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const baseBranch = readBranchBaseFromConfig(projectPath);
      await this.gitBootstrap.ensureLocalGitReadyOrThrow({
        projectId,
        codebasePath: mainCodebasePath,
        baseBranch,
        userContext,
      });
      return { path: worktreePath, branch: baseBranch || 'HEAD', isMain: true };
    }

    logger.info(`Creating worktree for feature: ${featureName}`, {
      component: 'WorktreeService',
      projectId,
      featureName
    });

    // Ensure canonical feature structure (visual/ui/{ant,figma,handoff}, sessions/*, etc).
    // Critical for Git-remote operations (Clone/Init/Sync/Pull/Commit/Push) that restore feature
    // branches without routing through FeatureCrudService.createFeature — this is the single
    // guard that keeps canonical directories consistent for every worktree entry point. Idempotent.
    //
    // Must use getFeaturePath (ant feature dir) — NOT path.dirname(worktreePath), which can point
    // to the project root (for `_base` reserved feature) or a local dev dir outside the workspace
    // (local-repo mode returns resolveLocalPath(config.localPath) as codebase).
    if (featureName !== RESERVED_FEATURE_NAME) {
      const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      await fs.promises.mkdir(featurePath, { recursive: true });
      await ensureCanonicalStructure(featurePath);
    }

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const baseBranch = readBranchBaseFromConfig(projectPath);
    await this.gitBootstrap.ensureLocalGitReadyOrThrow({
      projectId,
      codebasePath: mainCodebasePath,
      baseBranch,
      userContext,
    });

    const git = GitHelper.getGitInstanceSafe(mainCodebasePath);
    if (!git) {
      throw new GitOperationError('Main repository is not ready after bootstrap');
    }

    await GitHelper.ensureSafeDirectory(mainCodebasePath);
    await GitHelper.ensureUserConfig(git, userContext);

    // Ensure worktree parent directory exists
    await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true });

    // Handle existing directory at worktree path
    if (fs.existsSync(worktreePath)) {
      const gitFile = path.join(worktreePath, '.git');
      if (fs.existsSync(gitFile)) {
        // Validate .git file points to a real gitdir
        try {
          const content = await fs.promises.readFile(gitFile, 'utf-8');
          const gitdirRel = content.replace('gitdir:', '').trim();
          const gitdirAbs = path.resolve(worktreePath, gitdirRel);
          if (fs.existsSync(gitdirAbs)) {
            logger.info(`Valid worktree already exists, skipping creation`, {
              component: 'WorktreeService', projectId, featureName
            });
            return { path: worktreePath, branch: branchName, isMain: false };
          }
        } catch { /* corrupted .git file - fall through to cleanup */ }
      }
      // Directory exists without valid .git - clean up properly
      try { await git.raw(['worktree', 'remove', worktreePath, '--force']); } catch { /* may not be registered */ }
      try { await git.raw(['worktree', 'prune']); } catch { /* non-critical */ }
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
    }

    // Check if remote branch exists
    let remoteExists = false;
    if (this.githubAuthService) {
      try {
        await this.updateRemoteUrl(git, projectId, userContext);
        await git.fetch(['origin']);
        const remoteBranches = await git.branch(['-r']);
        remoteExists = remoteBranches.all.includes(`origin/${branchName}`);
        logger.info(`Remote branch check: ${branchName} ${remoteExists ? 'EXISTS' : 'NOT FOUND'}`, {
          component: 'WorktreeService',
          projectId,
          featureName
        });
      } catch (err) {
        logger.info(`Could not check remote (non-critical)`, {
          component: 'WorktreeService',
          projectId,
          featureName
        });
      }
    }

    // Check if branch already exists locally
    const localBranches = await git.branchLocal();
    const localExists = localBranches.all.includes(branchName);

    if (localExists) {
      // Branch exists locally - create worktree pointing to it
      await git.raw(['worktree', 'add', worktreePath, branchName]);
      logger.info(`Created worktree from existing local branch: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else if (remoteExists) {
      // Remote branch exists - create worktree tracking it
      await git.raw(['worktree', 'add', '--track', '-b', branchName, worktreePath, `origin/${branchName}`]);
      logger.info(`Created worktree tracking remote branch: origin/${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } else {
      // New branch - create worktree with new branch from current HEAD
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
      logger.info(`Created worktree with new branch: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    }

    // Ensure safe.directory for the worktree
    await GitHelper.ensureSafeDirectory(worktreePath);

    return { path: worktreePath, branch: branchName, isMain: false };
  }

  /**
   * Remove a worktree for a feature.
   * Also deletes the local branch after removal.
   */
  async removeWorktree(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<void> {
    const mainCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);
    const worktreePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const branchName = GitHelper.sanitizeBranchName(featureName);

    // Path-collision guard (mirror of createWorktree): in repoType:'local' the
    // feature path equals the main codebase. Removing a "worktree" here would
    // delete the main repo. Skip directory cleanup; only the local branch is
    // removed (best-effort).
    if (mainCodebasePath === worktreePath) {
      logger.info(`Worktree remove skipped — main and feature paths are identical`, {
        component: 'WorktreeService',
        projectId,
        featureName,
      });
      const git = GitHelper.getGitInstanceSafe(mainCodebasePath);
      if (git) {
        try {
          await git.branch(['-D', branchName]);
        } catch (err: any) {
          logger.info(`Could not delete branch ${branchName} (may not exist): ${err.message}`, {
            component: 'WorktreeService',
            projectId,
            featureName,
          });
        }
      }
      return;
    }

    logger.info(`Removing worktree for feature: ${featureName}`, {
      component: 'WorktreeService',
      projectId,
      featureName
    });

    const git = GitHelper.getGitInstanceSafe(mainCodebasePath);
    if (!git) {
      // No git - just remove the directory
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
      return;
    }

    // Remove the worktree
    try {
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
      logger.info(`Worktree removed: ${worktreePath}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } catch (err: any) {
      // Worktree might not be registered (e.g., if git wasn't initialized when feature was created)
      logger.warn(`Worktree remove failed (cleaning up directory): ${err.message}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
      if (fs.existsSync(worktreePath)) {
        await fs.promises.rm(worktreePath, { recursive: true, force: true });
      }
    }

    // Sweep corrupt `.git/worktrees/{branch}` metadata that bare prune
    // would leave behind for `safe.expire` (1h default).
    await WorktreeService.pruneCorruptWorktreeMeta(mainCodebasePath);

    // Delete the local branch
    try {
      await git.branch(['-D', branchName]);
      logger.info(`Deleted local branch: ${branchName}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    } catch (err: any) {
      logger.warn(`Could not delete branch ${branchName} (may not exist): ${err.message}`, {
        component: 'WorktreeService',
        projectId,
        featureName
      });
    }
  }

  /**
   * Sweep corrupted / orphaned worktree metadata under `.git/worktrees/`.
   *
   * Distinct from `ProjectCrudService.repairGitWorktrees` (which calls
   * `git worktree repair {paths}` to refresh absolute paths after a project
   * rename). This helper covers the opposite case: the worktree on disk is
   * gone but the metadata directory under `.git/worktrees/` lingers.
   *
   * Steps:
   *   1. Walk `.git/worktrees/` directly. Each subdir's `gitdir` file
   *      contains the absolute path to the worktree's `.git` marker —
   *      its dirname is the actual worktree directory.
   *   2. If that directory is missing OR its `.git` marker is gone,
   *      `fs.rm` the meta directory. (Independent of branch name —
   *      git names meta dirs after the worktree path basename, not the
   *      branch.)
   *   3. `git worktree prune --expire=now` — bypass the 1h safe-expire
   *      window that bare `prune` honours.
   *
   * Public + static so cloud-ide.routes.ts can call it (throttled) before
   * pod start without instantiating WorktreeService.
   */
  static async pruneCorruptWorktreeMeta(mainCodebasePath: string): Promise<void> {
    const git = GitHelper.getGitInstanceSafe(mainCodebasePath);
    if (!git) return;

    const worktreesDir = path.join(mainCodebasePath, '.git', 'worktrees');
    let removed = 0;

    try {
      const metaEntries = await fs.promises.readdir(worktreesDir, { withFileTypes: true });
      for (const entry of metaEntries) {
        if (!entry.isDirectory()) continue;
        const metaDir = path.join(worktreesDir, entry.name);
        const gitdirFile = path.join(metaDir, 'gitdir');

        let worktreeMarkerPath: string | null = null;
        try {
          const content = await fs.promises.readFile(gitdirFile, 'utf-8');
          worktreeMarkerPath = content.trim();
        } catch {
          // gitdir file missing → meta is corrupt; remove
        }

        const orphan =
          worktreeMarkerPath === null ||
          !fs.existsSync(worktreeMarkerPath) ||
          !fs.existsSync(path.dirname(worktreeMarkerPath));
        if (!orphan) continue;

        try {
          await fs.promises.rm(metaDir, { recursive: true, force: true });
          removed += 1;
          logger.info(`[WorktreeService] Pruned orphan worktree meta: ${metaDir}`, { component: 'WorktreeService' });
        } catch (err: any) {
          logger.warn(`[WorktreeService] Failed to rm orphan meta ${metaDir}: ${err.message}`, { component: 'WorktreeService' });
        }
      }
    } catch (err: any) {
      // worktrees dir may not exist yet (single-worktree repo) — that's fine
      if (err?.code !== 'ENOENT') {
        logger.warn(`[WorktreeService] readdir worktrees failed: ${err.message}`, { component: 'WorktreeService' });
      }
    }

    // Final prune — bypass the 1-hour safe.expire window so any internal
    // bookkeeping git tracks separately from the meta dirs is also cleared.
    try {
      await git.raw(['worktree', 'prune', '--expire=now']);
    } catch (err: any) {
      logger.warn(`[WorktreeService] worktree prune --expire=now failed: ${err.message}`, { component: 'WorktreeService' });
    }

    if (removed > 0) {
      logger.info(`[WorktreeService] pruneCorruptWorktreeMeta removed ${removed} orphan(s) under ${worktreesDir}`, {
        component: 'WorktreeService',
      });
    }
  }

  /**
   * List all worktrees for a project.
   */
  async listWorktrees(
    projectId: string,
    userContext: UserContext
  ): Promise<WorktreeInfo[]> {
    const mainCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId);

    const git = GitHelper.getGitInstanceSafe(mainCodebasePath);
    if (!git) {
      return [];
    }

    try {
      const output = await git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeInfo[] = [];
      
      const blocks = output.split('\n\n').filter(b => b.trim());
      for (const block of blocks) {
        const lines = block.split('\n');
        let wtPath = '';
        let branch = '';
        
        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            wtPath = line.substring('worktree '.length);
          }
          if (line.startsWith('branch ')) {
            branch = line.substring('branch refs/heads/'.length);
          }
        }
        
        if (wtPath) {
          worktrees.push({
            path: wtPath,
            branch: branch || 'HEAD',
            isMain: wtPath === mainCodebasePath
          });
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  /**
   * Update the remote URL with authenticated credentials.
   */
  private async updateRemoteUrl(
    git: SimpleGit,
    projectId: string,
    userContext: UserContext
  ): Promise<void> {
    if (!this.githubAuthService) return;

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');

    if (!fs.existsSync(configPath)) return;

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    if (!config.githubRepo) return;

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    try {
      const remotes = await git.getRemotes(true);
      if (remotes.some(r => r.name === 'origin')) {
        await git.remote(['set-url', 'origin', authenticatedUrl]);
      }
    } catch {
      // Non-critical
    }
  }
}
