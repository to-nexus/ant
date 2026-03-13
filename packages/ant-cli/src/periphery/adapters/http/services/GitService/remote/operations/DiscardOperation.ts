import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';
import { GitOperationError } from '../../errors';

/**
 * DiscardOperation
 * 
 * Discards uncommitted changes. Supports full discard or per-file discard.
 * Handles tracked (modified/deleted) and untracked (new) files differently.
 */
export class DiscardOperation {
  constructor(private readonly workspaceResolver: WorkspaceResolver) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; discardedFiles: number }> {
    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);

    await GitHelper.ensureSafeDirectory(codebasePath);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new GitOperationError('Repository not initialized. Please clone or initialize first.');
    }

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
        await git.clean('f', untrackedFiles);
      }

      const total = trackedFiles.length + untrackedFiles.length;
      console.log(`[DiscardOperation] Discarded ${total} file(s)`);
      return { success: true, discardedFiles: total };
    } else {
      // Discard all changes
      const totalBefore = status.files.length;
      await git.checkout(['--', '.']);
      await git.clean('f', ['-d']);

      console.log(`[DiscardOperation] Discarded all changes (${totalBefore} files)`);
      return { success: true, discardedFiles: totalBefore };
    }
  }
}
