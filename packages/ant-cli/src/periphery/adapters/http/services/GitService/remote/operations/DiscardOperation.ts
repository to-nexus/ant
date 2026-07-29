import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { WorktreeService } from '../../worktree';
import { ensureGitRepository } from './helpers/ensureGitRepository';
import { reconcileStagePaths } from './helpers/reconcileStagePaths';

/**
 * DiscardOperation
 *
 * Discards uncommitted changes. Supports full discard or per-file discard.
 * Handles tracked (modified/deleted) and untracked (new) files differently.
 */
export class DiscardOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    files?: string[]
  ): Promise<{ success: boolean; discardedFiles: number }> {
    const { git } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'DiscardOperation',
      worktreeService: this.worktreeService,
    });

    // Unstage all staged changes first
    await git.reset(['HEAD']);

    const status = await git.status();

    if (files && files.length > 0) {
      // Per-file discard — live status is the pathspec authority (shared
      // with CommitOperation via reconcileStagePaths).
      const { tracked, untracked } = reconcileStagePaths(status, files);

      if (tracked.length > 0) {
        await git.checkout(['--', ...tracked]);
      }
      if (untracked.length > 0) {
        await git.raw(['clean', '-f', '--', ...untracked]);
      }

      const total = tracked.length + untracked.length;
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
