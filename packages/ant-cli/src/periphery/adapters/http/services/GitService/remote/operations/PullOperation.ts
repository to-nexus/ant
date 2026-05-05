import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitOperationError, GitConflictError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';
import { GitBootstrapSSOT } from './BaseGitSetupOperation';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * PullOperation
 * 
 * Handles pulling changes from GitHub.
 */
export class PullOperation {
  private readonly featureBackup: FeatureCodebaseBackup;
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'PullOperation');
  }

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    if (!this.githubAuthService) {
      throw new GitOperationError('GitHub integration not configured');
    }

    const config = await loadGitHubConfig(this.workspaceResolver, projectId, userContext);
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      gitBootstrap: this.gitBootstrap,
      projectId,
      userContext,
      featureName,
      operationName: 'PullOperation',
      worktreeService: this.worktreeService,
      featureBackup: this.featureBackup,
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
    try {
      await git.pull('origin', currentBranch);
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes('CONFLICT') || msg.includes('Merge conflict') || msg.includes('merge conflict')) {
        throw new GitConflictError(
          `Merge conflict detected while pulling. Please resolve conflicts in the IDE.`
        );
      }
      throw error;
    }
    console.log('[PullOperation] Pull completed');
  }

}
