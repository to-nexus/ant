import type { StatusResult } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitOperationError } from '../../errors';
import { GitHelper } from '../../helper/GitHelper';
import { resolveCommitIdentity } from '../../helper/resolveCommitIdentity';
import { WorktreeService } from '../../worktree';
import { ensureGitRepository } from './helpers/ensureGitRepository';
import { authorAntCommitPlan } from './helpers/authorAntCommit';
import { withAntCoAuthor } from './helpers/antAttribution';
import { reconcileStagePaths } from './helpers/reconcileStagePaths';
import { stagePaths, hasStagedChanges } from './helpers/stagePaths';
import { deriveFallbackCommitMessage } from '../../../../../../../core/context/commitMessage';

export interface CommitResult {
  success: boolean;
  /** Last commit hash (BC — single-commit callers). */
  commitHash?: string;
  /** Every commit made this call, in order (ant path may produce several). */
  commits?: Array<{ message: string; hash?: string }>;
}

/**
 * CommitOperation
 *
 * Handles committing changes to Git.
 * Supports selective file staging and lazy worktree creation.
 *
 * `authorMode` picks the message source:
 *   - `'user'` (default): use the caller-provided `message` (or a timestamp
 *     fallback) for a single commit — the pre-existing behavior.
 *   - `'ant'`: an auxiliary LLM authors the message(s) and may split the change
 *     set into multiple logical commits (E6-4).
 */
export class CommitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver,
    private readonly worktreeService: WorktreeService,
    private readonly githubAuthService?: GitHubAuthService
  ) {}

  /** Live status is the sole pathspec authority — drop (and log) dead paths. */
  private reconcile(status: StatusResult, requested: string[]): string[] {
    const { stageable, dropped } = reconcileStagePaths(status, requested);
    if (dropped.length > 0) {
      console.warn(
        `[CommitOperation] Dropping ${dropped.length} stale path(s) no longer in the working tree: ${dropped.join(', ')}`,
      );
    }
    return stageable;
  }

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[],
    authorMode: 'user' | 'ant' = 'user',
  ): Promise<CommitResult> {
    const { git, codebasePath } = await ensureGitRepository({
      workspaceResolver: this.workspaceResolver,
      projectId,
      userContext,
      featureName,
      operationName: 'CommitOperation',
      worktreeService: this.worktreeService,
    });

    const identity = await resolveCommitIdentity(this.githubAuthService, userContext);
    await GitHelper.ensureUserConfig(git, userContext, identity);

    const status = await git.status();

    if (status.files.length === 0) {
      console.log('[CommitOperation] No changes to commit');
      return { success: true };
    }

    if (authorMode === 'ant') {
      // Respect the user's file selection when one was made — the LLM only
      // plans over the selected subset. No selection → the full change set.
      const allFiles = files?.length
        ? this.reconcile(status, files)
        : status.files.map((f) => f.path);
      if (allFiles.length === 0) {
        console.log('[CommitOperation] Selected files no longer present, nothing to commit');
        return { success: true };
      }
      const groups = await authorAntCommitPlan(
        git,
        this.workspaceResolver,
        projectId,
        userContext,
        allFiles,
      );
      const commits: Array<{ message: string; hash?: string }> = [];
      for (const group of groups) {
        // The plan was drawn from a status that is now an LLM round-trip old
        // (a running job may have deleted/renamed files since) — re-read and
        // reconcile per group so one dead path can't abort the whole commit.
        const liveStatus = await git.status();
        const stageable = this.reconcile(liveStatus, group.files);
        if (stageable.length === 0) continue;
        // Disk existence — not status membership — decides HOW each path is
        // staged: an index-resident ghost (e.g. intent-to-add leftover whose
        // file is gone) passes status yet makes `git add` abort the list.
        const { added } = await stagePaths(git, codebasePath, stageable);
        if (!(await hasStagedChanges(git))) continue; // ghost-only group — index healed, nothing to record
        // ANT is credited as co-author; the human stays the primary author.
        // Keep the undecorated subject in `commits[]` so the chat notice stays
        // clean — only the git commit carries the trailer.
        const r = await git.commit(withAntCoAuthor(group.message));
        commits.push({ message: group.message, hash: r.commit });
        console.log(`[CommitOperation] ant-committed (${added.length} files): ${group.message}`);
      }
      return {
        success: true,
        commitHash: commits[commits.length - 1]?.hash,
        commits,
      };
    }

    // User-authored path: selective or full staging, single commit.
    let committedFiles = status.files.map((f) => f.path);
    if (files && files.length > 0) {
      const stageable = this.reconcile(status, files);
      if (stageable.length === 0) {
        // Every selected file vanished between snapshot and commit. Never
        // fall back to staging everything — that would silently commit
        // changes the user did not pick.
        throw new GitOperationError(
          'None of the selected files exist anymore — refresh the change list and retry',
          'unknown',
          { retryable: true },
        );
      }
      const { added } = await stagePaths(git, codebasePath, stageable);
      if (!(await hasStagedChanges(git))) {
        // Ghost-only selection: the index was healed but there is nothing to
        // record. Succeed without a commit — onSuccess broadcasts a fresh
        // snapshot, so the (now clean) change list self-heals in the UI.
        console.log('[CommitOperation] Selection healed to zero staged changes, nothing to commit');
        return { success: true };
      }
      committedFiles = added.length > 0 ? added : stageable;
    } else {
      await git.add('.');
    }

    // When the user submits the "write it myself" path with a blank message,
    // derive a meaningful subject from the staged files — never a bare timestamp.
    const commitMessage = message || deriveFallbackCommitMessage(committedFiles);
    const result = await git.commit(commitMessage);

    console.log(`[CommitOperation] Committed: ${commitMessage}`);

    return {
      success: true,
      commitHash: result.commit,
      commits: [{ message: commitMessage, hash: result.commit }],
    };
  }
}
