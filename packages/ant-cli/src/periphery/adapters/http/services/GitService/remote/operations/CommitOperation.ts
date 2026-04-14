import * as fs from 'fs';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitOperationError } from '../../errors';

/**
 * CommitOperation
 * 
 * Handles committing changes to Git.
 * Supports selective file staging and lazy worktree creation.
 */
export class CommitOperation {
  private readonly featureBackup: FeatureCodebaseBackup;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
  }

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; commitHash?: string }> {
    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

    await GitHelper.ensureSafeDirectory(codebasePath);

    let git = GitHelper.getGitInstanceSafe(codebasePath);

    if (!git && featureName) {
      console.log(`[CommitOperation] No git found for feature ${featureName}, creating worktree lazily...`);
      const backups = await this.featureBackup.backup(projectId, [featureName], userContext);
      try {
        await this.worktreeService.createWorktree(projectId, featureName, userContext);
        const backupPath = backups.get(featureName);
        if (backupPath && fs.existsSync(backupPath)) {
          await this.featureBackup.restoreToWorktree(backupPath, codebasePath);
        }
      } finally {
        await this.featureBackup.cleanup(backups);
      }
      await GitHelper.ensureSafeDirectory(codebasePath);
      git = GitHelper.getGitInstanceSafe(codebasePath);
    }

    if (!git) {
      throw new GitOperationError('Repository not initialized. Please clone or initialize first.');
    }

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
