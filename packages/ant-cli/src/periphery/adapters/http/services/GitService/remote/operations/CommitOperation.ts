import { WorkspaceResolver } from '../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { GitHelper } from '../../helper/GitHelper';
import { resolveCommitIdentity } from '../../helper/resolveCommitIdentity';
import { WorktreeService } from '../../worktree';
import { ensureGitRepository } from './helpers/ensureGitRepository';
import { authorAntCommitPlan } from './helpers/authorAntCommit';
import { withAntCoAuthor } from './helpers/antAttribution';

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

    const identity = await resolveCommitIdentity(this.githubAuthService, userContext);
    await GitHelper.ensureUserConfig(git, userContext, identity);

    const status = await git.status();

    if (status.files.length === 0) {
      console.log('[CommitOperation] No changes to commit');
      return { success: true };
    }

    if (authorMode === 'ant') {
      const allFiles = status.files.map((f) => f.path);
      const groups = await authorAntCommitPlan(
        git,
        this.workspaceResolver,
        projectId,
        userContext,
        allFiles,
      );
      const commits: Array<{ message: string; hash?: string }> = [];
      for (const group of groups) {
        if (group.files.length === 0) continue;
        await git.add(group.files);
        // ANT is credited as co-author; the human stays the primary author.
        // Keep the undecorated subject in `commits[]` so the chat notice stays
        // clean — only the git commit carries the trailer.
        const r = await git.commit(withAntCoAuthor(group.message));
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
