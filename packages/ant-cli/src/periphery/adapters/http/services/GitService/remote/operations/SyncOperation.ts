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
 * SyncOperation
 * 
 * Handles syncing with GitHub (fetch + pull + push).
 */
export class SyncOperation {
  private readonly featureBackup: FeatureCodebaseBackup;
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'SyncOperation');
  }

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
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
      operationName: 'SyncOperation',
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
      throw new GitOperationError('No branch to sync');
    }

    let hasUpstream = true;
    try {
      await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
    } catch {
      hasUpstream = false;
    }

    if (!hasUpstream) {
      throw new GitOperationError(
        `Branch "${currentBranch}" has no upstream. Use "Publish Branch" to push it to remote first.`
      );
    }

    let pulledChanges = false;
    let pushedChanges = false;

    console.log(`[SyncOperation] Fetching from origin...`);
    await git.fetch('origin');
    const freshStatus = await git.status();

    if (freshStatus.behind > 0) {
      console.log(`[SyncOperation] Pulling from origin/${currentBranch}...`);
      try {
        await git.pull('origin', currentBranch);
      } catch (error: any) {
        const msg = error?.message || String(error);
        if (msg.includes('CONFLICT') || msg.includes('Merge conflict') || msg.includes('merge conflict')) {
          throw new GitConflictError(
            `Merge conflict detected while syncing. Please resolve conflicts in the IDE.`
          );
        }
        throw error;
      }
      pulledChanges = true;
      console.log('[SyncOperation] Pull completed');
    }

    if (freshStatus.ahead > 0) {
      console.log(`[SyncOperation] Pushing ${currentBranch} to origin...`);
      await git.push('origin', currentBranch);
      pushedChanges = true;
      console.log('[SyncOperation] Push completed');
    }

    if (!pulledChanges && !pushedChanges) {
      console.log('[SyncOperation] Already in sync');
    }

    return { success: true, pulledChanges, pushedChanges };
  }

}
