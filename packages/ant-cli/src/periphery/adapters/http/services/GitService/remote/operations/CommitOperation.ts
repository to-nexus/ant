import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';
import { WorktreeService } from '../../worktree';
import { ensureGitRepository } from './helpers/ensureGitRepository';
import { authorAntCommitPlan } from './helpers/authorAntCommit';

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
    private readonly worktreeService: WorktreeService
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string,
    featureName?: string,
    files?: string[],
    authorMode: 'user' | 'ant' = 'user',
  ): Promise<CommitResult> {
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

    if (authorMode === 'ant') {
      const allFiles = status.files.map((f) => f.path);
      const groups = await authorAntCommitPlan(git, projectId, userContext, allFiles);
      const commits: Array<{ message: string; hash?: string }> = [];
      for (const group of groups) {
        if (group.files.length === 0) continue;
        await git.add(group.files);
        const r = await git.commit(group.message);
        commits.push({ message: group.message, hash: r.commit });
        console.log(`[CommitOperation] ant-committed (${group.files.length} files): ${group.message}`);
      }
      return {
        success: true,
        commitHash: commits[commits.length - 1]?.hash,
        commits,
      };
    }

    // User-authored path: selective or full staging, single commit.
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
      commitHash: result.commit,
      commits: [{ message: commitMessage, hash: result.commit }],
    };
  }
}
