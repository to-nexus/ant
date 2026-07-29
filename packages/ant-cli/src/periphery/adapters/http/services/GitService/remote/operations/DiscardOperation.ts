import * as fs from 'fs';
import * as path from 'path';
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
    const { git, codebasePath } = await ensureGitRepository({
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
      // with CommitOperation via reconcileStagePaths). A path that is absent
      // on disk AND has no HEAD blob is an index-resident ghost (e.g. an
      // intent-to-add leftover): `checkout --` fatals on it the same way
      // `git add` does, so discarding it = deleting the index entry via
      // `rm --cached --ignore-unmatch` (never fails). A deleted TRACKED file
      // (absent on disk, blob in HEAD) stays on the checkout path — discard
      // must restore it.
      const { tracked, untracked, stageable } = reconcileStagePaths(status, files);
      const absent = stageable.filter((p) => !fs.existsSync(path.join(codebasePath, p)));
      let headPaths = new Set<string>();
      if (absent.length > 0) {
        try {
          const out = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD', '--', ...absent]);
          headPaths = new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
        } catch {
          /* unborn HEAD → nothing restorable, every absent path is a ghost */
        }
      }
      const ghosts = absent.filter((p) => !headPaths.has(p));
      const ghostSet = new Set(ghosts);
      const trackedRestorable = tracked.filter((p) => !ghostSet.has(p));
      const untrackedPresent = untracked.filter((p) => !ghostSet.has(p));

      if (ghosts.length > 0) {
        console.warn(`[DiscardOperation] Healing ${ghosts.length} index-resident ghost(s): ${ghosts.join(', ')}`);
        await git.raw(['rm', '-f', '-q', '--cached', '--ignore-unmatch', '--', ...ghosts]);
      }
      if (trackedRestorable.length > 0) {
        await git.checkout(['--', ...trackedRestorable]);
      }
      if (untrackedPresent.length > 0) {
        await git.raw(['clean', '-f', '--', ...untrackedPresent]);
      }

      const total = trackedRestorable.length + untrackedPresent.length + ghosts.length;
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
