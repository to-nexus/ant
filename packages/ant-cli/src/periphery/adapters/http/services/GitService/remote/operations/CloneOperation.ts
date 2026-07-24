import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import type { GitCloneResult } from '@ant/shared';
import { validateFeatureName } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper, SIMPLE_GIT_DEFAULT_OPTS } from '../../helper/GitHelper';
import { resolveCommitIdentity } from '../../helper/resolveCommitIdentity';
import { gitAnchor } from '../../anchor/GitAnchorSSOT';
import { listFeatureDirsByCreation } from '../../anchor/branchBaseLifecycle';
import { WorktreeService } from '../../worktree';
import {
  GitOperationError,
  GitAuthError,
  GitConfigError,
  GitConflictError,
  GitNotFoundError,
} from '../../errors';

/**
 * CloneOperation
 *
 * Clones an existing repository from GitHub into the project's bare anchor
 * (`{project}/repo.git`).
 *
 * Contract:
 * - Only permitted on a project with ZERO features (hard guard → 409).
 * - `branchBase` is set once from the remote HEAD and locked from then on
 *   (lock predicate = anchor has an origin remote).
 * - A feature named after the remote default branch is auto-created and
 *   attached, so the user immediately has a codebase.
 */
export class CloneOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext): Promise<GitCloneResult> {
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

    // HARD GUARD: clone is only available before any feature exists. Feature
    // worktrees hang off the anchor being replaced — there is no
    // backup/rematerialize path by design.
    const existingFeatures = await listFeatureDirsByCreation(projectPath);
    if (existingFeatures.length > 0) {
      throw new GitConflictError(
        'Clone is only available on a project with no features. This project already has ' +
          `${existingFeatures.length} feature(s) — use Publish to connect it to GitHub instead.`,
        { retryable: false }
      );
    }

    const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);
    if (GitHelper.isBareAnchorReady(anchorPath)) {
      if (await gitAnchor.hasOriginRemote(anchorPath)) {
        throw new GitConflictError('Repository already cloned.');
      }
      // Local-only leftover anchor (all features were deleted) — with zero
      // features there is nothing to preserve; discard before cloning.
      console.log('[CloneOperation] Local-only anchor found, removing before clone...');
      await fs.promises.rm(anchorPath, { recursive: true, force: true });
    }

    console.log(`[CloneOperation] Cloning repository from ${config.githubRepo}...`);

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };

    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    const tempPath = path.join(projectPath, '.repo-clone-tmp');

    if (fs.existsSync(tempPath)) {
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    }

    const git = simpleGit(SIMPLE_GIT_DEFAULT_OPTS);
    try {
      await git.raw(['clone', '--bare', authenticatedUrl, tempPath]);
      console.log(`[CloneOperation] Bare clone completed`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      const lower = errorMsg.toLowerCase();

      if (lower.includes('repository not found') || lower.includes('does not appear to be a git repository')) {
        throw new GitNotFoundError(`Repository not found at ${config.githubRepo}. Please check the URL or use Initialize to create a new repository.`);
      } else if (lower.includes('authentication failed') || lower.includes('could not read from remote repository')) {
        throw new GitAuthError('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new GitOperationError(`Clone failed: ${errorMsg}`);
      }
    }

    try {
      // Atomically claim the anchor location.
      await fs.promises.rename(tempPath, anchorPath);

      await GitHelper.ensureSafeDirectory(anchorPath);
      const anchorGit = GitHelper.getBareGitInstance(anchorPath);
      if (!anchorGit) {
        throw new GitOperationError('Clone completed but the bare anchor is not readable');
      }
      await GitHelper.ensureUserConfig(anchorGit, userContext, await resolveCommitIdentity(this.githubAuthService, userContext));

      // Bare clones do not configure a fetch refspec — set it explicitly so
      // fetch / remote-branch tracking work like a normal clone.
      await anchorGit.raw(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
      try {
        await anchorGit.fetch(['origin']);
      } catch {
        // non-fatal — refs already present from the clone itself
      }

      // Remote default branch → locked branchBase (verbatim; `/` is allowed
      // and becomes feature `release/1.0` tracking `origin/release/1.0`).
      // Empty remotes keep 'main'.
      const defaultBranch =
        (await gitAnchor.detectRemoteHeadBranch(anchorPath)) ?? config.branchBase ?? 'main';

      // Only genuinely git-illegal / ant-reserved names (e.g. `features`,
      // `codebase`) are rejected — a `/` in the branch name is fine.
      const nameCheck = validateFeatureName(defaultBranch);
      if (!nameCheck.ok) {
        throw new GitConfigError(
          `Remote default branch "${defaultBranch}" is reserved and cannot be used as an ant ` +
            `feature name (${nameCheck.violation}). Rename the repository's default branch and retry.`,
          { retryable: false, suggestedAction: 'reconfigureRepo' }
        );
      }

      config.branchBase = defaultBranch;
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      try {
        await gitAnchor.setHeadBranch(anchorPath, defaultBranch);
      } catch { /* HEAD already points there for non-empty remotes */ }

      // Auto-create the base feature so the user immediately sees the cloned
      // code. `createWorktree` materializes the feature dir (canonical
      // structure included) and attaches the existing local branch; for an
      // empty remote it takes the first-feature initial-commit path.
      await this.worktreeService.createWorktree(projectId, defaultBranch, userContext);

      console.log(`[CloneOperation] Repository cloned; base feature '${defaultBranch}' created`);
      return { defaultBranch, feature: defaultBranch };
    } catch (error) {
      console.error('[CloneOperation] Post-clone processing failed, cleaning up...');
      try {
        if (fs.existsSync(anchorPath)) {
          await fs.promises.rm(anchorPath, { recursive: true, force: true });
        }
      } catch (cleanupErr: any) {
        console.error(`[CloneOperation] Cleanup failed: ${cleanupErr.message}`);
      }
      throw error;
    } finally {
      if (fs.existsSync(tempPath)) {
        await fs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
