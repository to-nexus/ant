import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { WorktreeService } from '../../worktree';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';
import { pullWithStrategy } from '../helpers/pullStrategy';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * PullOperation
 *
 * Handles pulling changes from GitHub. The reconciliation strategy is always
 * explicit (see `pullWithStrategy`) — a bare `git pull` is refused outright by
 * git once the branches diverge.
 */
export class PullOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    strategy?: unknown
  ): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'PullOperation',
      worktreeService: this.worktreeService,
    });

    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    await ensureRemote(git, authenticatedUrl);

    const status = await git.status();
    const currentBranch = status.current;

    if (!currentBranch) {
      throw new GitOperationError('No branch to pull');
    }

    console.log(`[PullOperation] Fetching from origin...`);
    await git.fetch('origin');
    const freshStatus = await git.status();

    if (freshStatus.behind === 0) {
      console.log('[PullOperation] Already up to date');
      return;
    }

    console.log(`[PullOperation] Pulling from origin/${currentBranch} (${freshStatus.behind} behind)...`);
    await pullWithStrategy(git, currentBranch, strategy, freshStatus);
    console.log('[PullOperation] Pull completed');
  }

}
