import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../../core/types/user';
import { logger } from '../../../../../../../../utils/logger';
import { GitConfigError, GitOperationError } from '../../../errors';
import { GitHelper } from '../../../helper/GitHelper';
import { WorktreeService, emitWorktreeValidityFailure } from '../../../worktree';

interface EnsureGitRepositoryInput {
  workspaceResolver: WorkspaceResolver;
  projectId: string;
  userContext: UserContext;
  featureName?: string;
  operationName: string;
  worktreeService?: WorktreeService;
  /**
   * `true` only for operations that can run against the bare anchor with no
   * working tree (fetch). Everything else requires a feature.
   */
  allowAnchor?: boolean;
}

interface EnsureGitRepositoryResult {
  git: SimpleGit;
  codebasePath: string;
}

/**
 * Resolve a ready SimpleGit for a user git operation.
 *
 * - feature present → the feature worktree (stage-4 validity check with
 *   self-heal: removeWorktree remnants + createWorktree re-attach — the
 *   branch lives in the anchor so committed state survives; UNCOMMITTED
 *   changes in a corrupt worktree are discarded, logged as a warn).
 * - feature absent + `allowAnchor` → the bare anchor (`repo.git`).
 * - feature absent otherwise → GitConfigError (a project without a selected
 *   feature has no working tree).
 */
export async function ensureGitRepository(input: EnsureGitRepositoryInput): Promise<EnsureGitRepositoryResult> {
  const {
    workspaceResolver,
    projectId,
    userContext,
    featureName,
    operationName,
    worktreeService,
    allowAnchor,
  } = input;

  if (!featureName) {
    if (!allowAnchor) {
      throw new GitConfigError(
        'This git operation requires a feature — a project without features has no codebase',
        { retryable: false }
      );
    }
    const anchorPath = workspaceResolver.getGitAnchorPath(userContext, projectId);
    await GitHelper.ensureSafeDirectory(anchorPath);
    const anchorGit = GitHelper.getBareGitInstance(anchorPath);
    if (!anchorGit) {
      throw new GitConfigError(
        'Git is not set up for this project yet — create a feature first',
        { retryable: false }
      );
    }
    return { git: anchorGit, codebasePath: anchorPath };
  }

  const codebasePath = workspaceResolver.getCodebasePath(userContext, projectId, featureName);
  await GitHelper.ensureSafeDirectory(codebasePath);

  let git = GitHelper.getGitInstanceSafe(codebasePath);

  // Stage-4 validity check — `getGitInstanceSafe` only verifies `.git` exists
  // (stage 1). For feature worktrees, the marker may point at a partial
  // gitdir (HEAD/commondir missing) on EFS. Drop the git instance so the
  // self-heal below triggers removeWorktree → createWorktree (which runs its
  // own post-create probe). The feature branch lives in the anchor, so the
  // committed state is preserved across the heal.
  if (git) {
    const validity = GitHelper.isWorktreeStructureValid(codebasePath);
    if (!validity.valid) {
      emitWorktreeValidityFailure({
        callSite: 'ensureGitRepository.stage4',
        projectId,
        featureName,
        workspacePath: codebasePath,
        validity,
      });
      logger.warn(
        `Worktree validity check failed (${validity.reason}), self-healing — uncommitted changes in the corrupt worktree are discarded`,
        { component: operationName, projectId, featureName },
      );
      git = null;
    }
  }

  if (!git && worktreeService) {
    // Missing or corrupt worktree — re-materialize it. `createWorktree`
    // lazily bootstraps the bare anchor, cleans up invalid remnants itself
    // (worktree remove --force + prune + rm), and re-attaches the existing
    // branch — never `removeWorktree` here, which would `branch -D` the
    // feature branch and destroy the committed state.
    await worktreeService.createWorktree(projectId, featureName, userContext);
    await GitHelper.ensureSafeDirectory(codebasePath);
    git = GitHelper.getGitInstanceSafe(codebasePath);

    logger.info(
      'gitWorktreeRecovered',
      {
        component: operationName,
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        projectId,
      },
      {
        featureName,
        codebasePath,
        via: 'remote-user-op',
      }
    );
  }

  if (!git) {
    throw new GitOperationError('Feature worktree is not ready after self-heal', 'config', {
      retryable: false,
    });
  }

  return { git, codebasePath };
}
