import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';

/**
 * PullOperation
 * 
 * Handles pulling changes from GitHub.
 */
export class PullOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);

    await GitHelper.ensureSafeDirectory(codebasePath);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new GitOperationError('Repository not initialized. Please clone or initialize first.');
    }

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

    const status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new GitOperationError('No branch to pull');
    }

    // Fetch first so behind count is accurate
    console.log(`[PullOperation] Fetching from origin...`);
    await git.fetch('origin');
    const freshStatus = await git.status();

    if (freshStatus.behind === 0) {
      console.log('[PullOperation] Already up to date');
      return;
    }

    console.log(`[PullOperation] Pulling from origin/${currentBranch} (${freshStatus.behind} behind)...`);
    await git.pull('origin', currentBranch);
    console.log('[PullOperation] Pull completed');
  }

}

