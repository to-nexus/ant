import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { WorktreeService } from '../../worktree';
import { FeatureCodebaseBackup } from '../../worktree/FeatureCodebaseBackup';
import { GitBootstrapSSOT } from './BaseGitSetupOperation';
import { ensureGitRepository } from './helpers/ensureGitRepository';

/**
 * DiscardOperation
 * 
 * Discards uncommitted changes. Supports full discard or per-file discard.
 * Handles tracked (modified/deleted) and untracked (new) files differently.
 */
export class DiscardOperation {
  private readonly featureBackup: FeatureCodebaseBackup;
  private readonly gitBootstrap: GitBootstrapSSOT;

  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService
  ) {
    this.featureBackup = new FeatureCodebaseBackup(workspaceResolver);
    this.gitBootstrap = new GitBootstrapSSOT(workspaceResolver, 'DiscardOperation');
  }

  async execute(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; discardedFiles: number }> {
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      gitBootstrap: this.gitBootstrap,
      projectId,
      userContext,
      featureName,
      operationName: 'DiscardOperation',
      worktreeService: this.worktreeService,
      featureBackup: this.featureBackup,
    });

    // Unstage all staged changes first
    await git.reset(['HEAD']);

    const status = await git.status();

    if (files && files.length > 0) {
      // Per-file discard
      const trackedFiles = files.filter(f =>
        status.modified.includes(f) || status.deleted.includes(f)
      );
      const untrackedFiles = files.filter(f =>
        status.not_added.includes(f)
      );

      if (trackedFiles.length > 0) {
        await git.checkout(['--', ...trackedFiles]);
      }
      if (untrackedFiles.length > 0) {
        await git.raw(['clean', '-f', '--', ...untrackedFiles]);
      }

      const total = trackedFiles.length + untrackedFiles.length;
      console.log(`[DiscardOperation] Discarded ${total} file(s)`);
      return { success: true, discardedFiles: total };
    } else {
      // Discard all changes
      const totalBefore = status.files.length;
      await git.checkout(['--', '.']);
      await git.raw(['clean', '-fd']);

      console.log(`[DiscardOperation] Discarded all changes (${totalBefore} files)`);
      return { success: true, discardedFiles: totalBefore };
    }
  }
}
