import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { GitOperationError } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';

/**
 * SyncOperation
 * 
 * Handles syncing with GitHub (fetch + pull + push).
 */
export class SyncOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  async execute(projectId: string, userContext: UserContext, featureName?: string): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
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
      throw new GitOperationError('No branch to sync');
    }

    // Check upstream — sync is meaningless without one
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
      await git.pull('origin', currentBranch);
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

