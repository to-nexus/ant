import * as fs from 'fs';
import * as path from 'path';
import type { SimpleGit } from 'simple-git';
import type { GitInitResult } from '@ant/shared';
import { WorkspaceResolver, resolveLocalPath } from '../../../../../../../core/config/WorkspacePathResolver';
import { isVectorDbEnabled } from '../../../../../../../core/config/vectorDbCapability';
import { UserContext } from '../../../../../../../core/types/user';
import { readBranchBase } from '../../../../../../../core/utils/branchUtils';
import { GitHubAuthService, GitHubRepoCreateError } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { resolveCommitIdentity } from '../../helper/resolveCommitIdentity';
import { gitAnchor } from '../../anchor/GitAnchorSSOT';
import { WorktreeService } from '../../worktree';
import { RemoteChecker } from '../helpers/RemoteChecker';
import { ensureBaseFeature } from './helpers/ensureBaseFeature';
import {
  GitAuthError,
  GitConfigError,
  GitConflictError,
  GitNetworkError,
  GitNotFoundError,
  GitOperationError,
} from '../../errors';

/**
 * InitOperation ("publish" init variant)
 *
 * Creates the GitHub repository and connects the project's existing local
 * git to it. Under the bare-anchor model the repository already exists
 * locally (created by the first feature), so init is purely:
 *
 *   create GitHub repo → add origin → push branchBase (-u) → set remote HEAD
 *
 * The user-chosen `branchBase` (a feature's branch) becomes the repository
 * default branch. A project with NO features has no branch to push, so init
 * materializes one named after `branchBase` first (`ensureBaseFeature`) —
 * the mirror of Clone's auto-create from the remote HEAD. Only `branchBase`
 * is pushed; other features publish individually afterwards. After init the
 * branchBase pointer is locked (origin remote present).
 */
export class InitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService,
    private readonly onIndexingTrigger?: (projectId: string, codebasePath: string, userContext: UserContext, feedbackFeature?: string) => void
  ) {}

  private get operationName(): string {
    return 'InitOperation';
  }

  async execute(projectId: string, userContext: UserContext): Promise<GitInitResult> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new GitNotFoundError('Project config not found');
    }
    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    if (!config.githubRepo) {
      throw new GitOperationError('GitHub repository not configured in project config');
    }

    // repoType:'local' — user-owned repository at localPath; connect it as-is.
    if (config.repoType === 'local' && config.localPath) {
      return this.executeLocalRepo(projectId, userContext, config);
    }

    const branchBase = readBranchBase(projectPath);
    const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);

    // Validations run BEFORE the base feature is materialized, and the base
    // feature is materialized BEFORE the GitHub repo is created. Both halves
    // of that ordering are load-bearing:
    //   - materializing first would let the "use Clone instead" conflict below
    //     fire after a feature exists — and a feature makes Clone permanently
    //     unavailable (CloneOperation's zero-feature hard guard), so the error
    //     would contradict the state it just created. RemoteChecker also
    //     throws GitAuthError on 401/403, surfacing a bad PAT with nothing
    //     written yet.
    //   - materializing after createGitHubRepo would leave an orphan remote
    //     repo when feature creation fails, and every retry would then die on
    //     the same conflict.
    // hasOriginRemote is safe here: it returns false when the anchor is absent
    // (a featureless project has no anchor yet).
    if (await gitAnchor.hasOriginRemote(anchorPath)) {
      throw new GitConflictError('Git repository already initialized. Use push/pull instead.');
    }
    console.log(`[${this.operationName}] Checking if remote repository already exists...`);
    const repoExists = await RemoteChecker.exists(config.githubRepo, userContext, this.githubAuthService);
    if (repoExists) {
      throw new GitConflictError(`Remote repository already exists at ${config.githubRepo}. Please use Clone instead to download the existing repository.`);
    }

    const base = await ensureBaseFeature({
      projectId,
      projectPath,
      anchorPath,
      userContext,
      branchBase,
      worktreeService: this.worktreeService,
    });

    const git = GitHelper.getBareGitInstance(anchorPath);
    if (!git || !(await gitAnchor.branchExists(anchorPath, branchBase))) {
      // Structurally impossible now that a feature is guaranteed (the first
      // feature always creates the anchor + an initial commit) — fail loud
      // instead of half-initializing.
      throw new GitConfigError(
        `Local repository is not ready (anchor or base branch '${branchBase}' missing). ` +
          'Recreate a feature to self-heal, then retry.',
        { retryable: false }
      );
    }

    await this.createGitHubRepo(config.githubRepo, projectId, userContext);

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    let remoteAdded = false;
    try {
      await git.addRemote('origin', authenticatedUrl);
      remoteAdded = true;
      await git.raw(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
      console.log(`[${this.operationName}] ✅ Remote added`);

      console.log(`[${this.operationName}] Pushing base branch '${branchBase}' to remote...`);
      await git.push(['-u', 'origin', branchBase]);
      try {
        await git.raw(['remote', 'set-head', 'origin', branchBase]);
      } catch { /* best-effort */ }
      console.log(`[${this.operationName}] ✅ Pushed to remote: ${branchBase}`);
    } catch (error) {
      // Never delete repo.git — it holds the user's commits. Undo only the
      // remote linkage so a retry starts from a clean unlocked state.
      if (remoteAdded) {
        try {
          await git.raw(['remote', 'remove', 'origin']);
          console.log(`[${this.operationName}] 🔄 Rolled back: origin remote removed`);
        } catch (rollbackErr: any) {
          console.error(`[${this.operationName}] ⚠️ Rollback failed:`, rollbackErr?.message);
        }
      }
      throw error;
    }

    const baseCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, branchBase);
    await this.triggerIndexing(projectId, baseCodebasePath, userContext, branchBase);
    return { defaultBranch: branchBase, feature: base.feature };
  }

  /**
   * repoType:'local' — the user's own working repository. Reuse its git
   * (never init/commit on the user's behalf) and push the current branch.
   */
  private async executeLocalRepo(
    projectId: string,
    userContext: UserContext,
    config: any
  ): Promise<GitInitResult> {
    const codebasePath = resolveLocalPath(config.localPath);
    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new GitConfigError(
        `Local repository not found at ${codebasePath} — initialize git there first.`,
        { retryable: false }
      );
    }

    const remotes = await git.getRemotes();
    if (remotes.some(r => r.name === 'origin')) {
      throw new GitConflictError('Git repository already initialized. Use push/pull instead.');
    }
    const repoExists = await RemoteChecker.exists(config.githubRepo, userContext, this.githubAuthService!);
    if (repoExists) {
      throw new GitConflictError(`Remote repository already exists at ${config.githubRepo}. Please use Clone instead to download the existing repository.`);
    }

    await this.createGitHubRepo(config.githubRepo, projectId, userContext);

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService!.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    await GitHelper.ensureSafeDirectory(codebasePath);
    await GitHelper.ensureUserConfig(git, userContext, await resolveCommitIdentity(this.githubAuthService, userContext));
    await this.addRemoteAndPushCurrent(git, userContext, authenticatedUrl);
    const branchBase = readBranchBase(this.workspaceResolver.getProjectPath(userContext, projectId));
    await this.triggerIndexing(projectId, codebasePath, userContext, branchBase);
    return { defaultBranch: branchBase };
  }

  private async addRemoteAndPushCurrent(
    git: SimpleGit,
    _userContext: UserContext,
    authenticatedUrl: string
  ): Promise<void> {
    await git.addRemote('origin', authenticatedUrl);
    const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    await git.push(['-u', 'origin', currentBranch]);
    console.log(`[${this.operationName}] ✅ Pushed to remote: ${currentBranch}`);
  }

  private async createGitHubRepo(githubRepo: string, projectId: string, userContext: UserContext): Promise<void> {
    console.log(`[${this.operationName}] Creating GitHub repository at ${githubRepo}...`);

    try {
      await this.githubAuthService!.createRepo(
        userContext,
        githubRepo,
        {
          description: `${projectId} - Generated by ANT`,
          private: true
        }
      );
      console.log(`[${this.operationName}] ✅ GitHub repository created`);
    } catch (error: any) {
      if (error instanceof GitHubRepoCreateError && error.isAlreadyExistsError()) {
        console.log(`[${this.operationName}] GitHub repo already exists, continuing...`);
        return;
      }
      if (error instanceof GitHubRepoCreateError) {
        const requestIdSuffix = error.requestId ? ` (request_id=${error.requestId})` : '';
        if (error.statusCode === 401 || error.statusCode === 403) {
          throw new GitAuthError(
            `GitHub authentication failed while creating ${githubRepo}: ${error.apiMessage}${requestIdSuffix}`,
            { retryable: false }
          );
        }
        if (error.statusCode === 409) {
          throw new GitConflictError(
            `GitHub repository conflict for ${githubRepo}: ${error.apiMessage}${requestIdSuffix}`,
            { retryable: false, suggestedAction: 'reconfigureRepo' }
          );
        }
        if (error.statusCode === 422) {
          throw new GitConfigError(
            `GitHub rejected repository settings for ${githubRepo}: ${error.apiMessage}${requestIdSuffix}`,
            { retryable: false, suggestedAction: 'reconfigureRepo' }
          );
        }
        if (error.statusCode >= 500) {
          throw new GitNetworkError(
            `GitHub server error while creating ${githubRepo}: ${error.apiMessage}${requestIdSuffix}`,
            { retryable: true }
          );
        }
        throw new GitOperationError(
          `Failed to create GitHub repository ${githubRepo}: ${error.apiMessage}${requestIdSuffix}`,
          error.statusCode
        );
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      // AbortSignal.timeout(...) on the fetch rejects with DOMException name 'TimeoutError'.
      // Map to GitNetworkError so the FE marks it retryable rather than generic-unknown.
      if (error?.name === 'TimeoutError') {
        throw new GitNetworkError(`GitHub request timed out while creating ${githubRepo}: ${errorMsg}`, { retryable: true });
      }
      throw new GitOperationError(`Failed to create GitHub repository ${githubRepo}: ${errorMsg}`, 'unknown');
    }
  }

  private async triggerIndexing(
    projectId: string,
    codebasePath: string,
    userContext: UserContext,
    feedbackFeature: string
  ): Promise<void> {
    if (!isVectorDbEnabled()) {
      console.log(`[${this.operationName}] ℹ️  Vector DB disabled (ANT_VECTOR_DB_ENABLED=false) — skipping clear + indexing.`);
      return;
    }

    console.log(`[${this.operationName}] 🗑️  Clearing Vector DB for fresh start...`);
    try {
      const { AdapterFactory } = await import('../../../../../../../infrastructure/adapters/AdapterFactory');
      const vectorDB = AdapterFactory.createMemoryAdapter(userContext);
      await vectorDB.clear(projectId);
      console.log(`[${this.operationName}] ✅ Vector DB cleared`);
    } catch (error) {
      console.warn(`[${this.operationName}] ⚠️  Could not clear Vector DB:`, error);
    }

    if (this.onIndexingTrigger) {
      console.log(`[${this.operationName}] 🔍 Starting codebase indexing...`);
      setImmediate(() => {
        this.onIndexingTrigger!(projectId, codebasePath, userContext, feedbackFeature);
      });
      console.log(`[${this.operationName}] ✅ Complete, indexing started in background`);
    }
  }
}
