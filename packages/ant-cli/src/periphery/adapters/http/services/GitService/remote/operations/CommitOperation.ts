import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';

/**
 * CommitOperation
 * 
 * Handles committing changes to Git.
 */
export class CommitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

    // ✅ Ensure safe.directory is set (prevents "dubious ownership" error in cloud environments)
    await GitHelper.ensureSafeDirectory(codebasePath);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Ensure git user config is set (essential for cloud environments)
    await GitHelper.ensureUserConfig(git, userContext);

    // Check if there are changes to commit
    const status = await git.status();
    
    if (status.files.length === 0) {
      console.log('[CommitOperation] No changes to commit');
      return { success: true };
    }

    // Stage all changes
    await git.add('.');
    
    // Commit with provided message or default
    const commitMessage = message || `Update: ${new Date().toISOString()}`;
    const result = await git.commit(commitMessage);
    
    console.log(`[CommitOperation] ✅ Committed: ${commitMessage}`);
    
    return {
      success: true,
      commitHash: result.commit
    };
  }
}

