import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { WorktreeService } from '../../worktree';
import { GitConflictError, GitOperationError, asPushRejection } from '../../errors';
import { loadGitHubConfig, ensureRemote } from '../helpers/configLoader';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * PushOperation
 *
 * Handles pushing changes to GitHub.
 * Includes lazy worktree creation and automatic upstream setup ("Publish Branch").
 *
 * A preflight fetch runs first: `ahead`/`behind` are only as fresh as the last
 * fetch, and nothing else in a cloud workspace ever refreshes them — so
 * without it the decision to push is made against a remote the process has
 * not looked at since the clone, and GitHub rejects the result.
 */
export class PushOperation {
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
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'PushOperation',
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

    let status = await git.status();
    const currentBranch = status.current;
    
    if (!currentBranch) {
      throw new GitOperationError('No branch to push');
    }

    // Preflight: refresh the remote refs the ahead/behind decision rests on.
    // Tolerate failure — a fetch that cannot run (transient network, a ref
    // lock held by a concurrent fetch op) must never block a push that would
    // otherwise have succeeded; the push itself then reports the real error.
    try {
      await git.fetch('origin');
      status = await git.status();
    } catch (error: any) {
      console.warn(`[PushOperation] preflight fetch skipped: ${error?.message ?? error}`);
    }

    // Check upstream and push accordingly
    let hasUpstream = true;
    try {
      await git.revparse(['--abbrev-ref', `${currentBranch}@{upstream}`]);
    } catch {
      hasUpstream = false;
    }

    if (hasUpstream && status.behind > 0) {
      throw new GitConflictError(
        `origin/${currentBranch} has ${status.behind} commit(s) this workspace does not have. ` +
          `Sync first, then push.`,
        {
          retryable: false,
          suggestedAction: 'syncFirst',
          params: { branch: currentBranch, count: status.behind },
        }
      );
    }

    try {
      if (!hasUpstream) {
        // "Publish Branch" — first push with upstream setup
        console.log(`[PushOperation] Publishing branch ${currentBranch} to origin...`);
        await git.push(['-u', 'origin', currentBranch]);
        console.log('[PushOperation] Branch published successfully');
      } else {
        if (status.ahead === 0) {
          console.log('[PushOperation] Nothing to push');
          return;
        }
        console.log(`[PushOperation] Pushing ${currentBranch} to origin...`);
        await git.push('origin', currentBranch);
        console.log('[PushOperation] Push completed');
      }
    } catch (error) {
      // Race window between the preflight and the push, and the no-upstream
      // branch the preflight cannot judge.
      throw asPushRejection(error) ?? error;
    }
  }

}
