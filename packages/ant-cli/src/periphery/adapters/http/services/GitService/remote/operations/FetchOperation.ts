import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { WorktreeService } from '../../worktree';
import { logger } from '../../../../../../../utils/logger';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * FetchOperation
 *
 * Handles fetching from GitHub (without merging). With no feature selected
 * the fetch runs against the bare anchor (`allowAnchor`).
 *
 * NOTE: `branchBase` is NOT re-synced from the remote HEAD here — the
 * pointer is locked once a remote is connected (clone writes it exactly
 * once). Remote default-branch drift is intentionally not mirrored.
 */
export class FetchOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);
    const { git, codebasePath } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'FetchOperation',
      worktreeService: this.worktreeService,
      allowAnchor: true,
    });

    // Update remote URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    await ensureRemote(git, authenticatedUrl);

    logger.info(`[FetchOperation] Fetching from origin...`, {
      component: 'FetchOperation',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
      featureName
    }, {
      githubRepo: config.githubRepo,
      codebasePath
    });
    await git.fetch('origin');
    logger.info('[FetchOperation] ✅ Fetch completed', {
      component: 'FetchOperation',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
      featureName
    }, {
      githubRepo: config.githubRepo
    });
  }
}
