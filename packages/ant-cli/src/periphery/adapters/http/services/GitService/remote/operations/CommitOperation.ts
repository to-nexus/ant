import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';
import { WorktreeService } from '../../worktree';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * CommitOperation
 *
 * Handles committing changes to Git.
 * Supports selective file staging and lazy worktree creation.
 */
export class CommitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; commitHash?: string }> {
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'CommitOperation',
      worktreeService: this.worktreeService,
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
