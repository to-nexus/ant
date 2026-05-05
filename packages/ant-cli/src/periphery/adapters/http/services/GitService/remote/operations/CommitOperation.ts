import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitBootstrapSSOT } from './BaseGitSetupOperation';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * CommitOperation
 * 
 * Handles committing changes to Git.
 * Supports selective file staging and lazy worktree creation.
 */
export class CommitOperation {
  private readonly featureBackup: FeatureCodebaseBackup;
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'CommitOperation');
  }

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; commitHash?: string }> {
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      gitBootstrap: this.gitBootstrap,
      projectId,
      userContext,
      featureName,
      operationName: 'CommitOperation',
      worktreeService: this.worktreeService,
      featureBackup: this.featureBackup,
    });

    await GitHelper.ensureUserConfig(git, userContext);

    const status = await git.status();
    
    if (status.files.length === 0) {
      console.log('[CommitOperation] No changes to commit');
      return { success: true };
    }

    // Selective or full staging
    if (files && files.length > 0) {
      await git.add(files);
    } else {
      await git.add('.');
    }
    
    const commitMessage = message || `Update: ${new Date().toISOString()}`;
    const result = await git.commit(commitMessage);
    
    console.log(`[CommitOperation] Committed: ${commitMessage}`);
    
    return {
      success: true,
      commitHash: result.commit
    };
  }
}
