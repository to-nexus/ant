import { validateFeatureName } from '@ant/shared';
import { UserContext } from '../../../../../../../../core/types/user';
import { logger } from '../../../../../../../../utils/logger';
import { GitConfigError } from '../../../errors';
import { applyAfterFeatureCreate, listFeatureDirsByCreation } from '../../../anchor/branchBaseLifecycle';
import { WorktreeService } from '../../../worktree';

interface EnsureBaseFeatureInput {
  projectId: string;
  projectPath: string;
  anchorPath: string;
  userContext: UserContext;
  branchBase: string;
  worktreeService: WorktreeService;
}

interface EnsureBaseFeatureResult {
  created: boolean;
  feature?: string;
}

/**
 * Materialize the base-branch feature when a project has none.
 *
 * Mirror of the auto-create Clone already performs for the remote default
 * branch: a project without features has no codebase and no branch, so
 * Publish(init) would have nothing to push. Here the branch name comes from
 * `branchBase` instead of the remote HEAD.
 *
 * No-op when any feature already exists — the caller's `branchBase` is then
 * a pointer into the existing feature set.
 */
export async function ensureBaseFeature(input: EnsureBaseFeatureInput): Promise<EnsureBaseFeatureResult> {
  const { projectId, projectPath, anchorPath, userContext, branchBase, worktreeService } = input;

  const features = await listFeatureDirsByCreation(projectPath);
  if (features.length > 0) return { created: false };

  const check = validateFeatureName(branchBase);
  if (!check.ok) {
    throw new GitConfigError(
      `Base branch '${branchBase}' is not a usable branch name (${check.violation}). ` +
        'Change the base branch in project settings, then retry.',
      { retryable: false }
    );
  }

  logger.info('No features — materializing the base-branch feature before publish', {
    component: 'ensureBaseFeature',
    projectId,
  }, { branchBase });

  // createWorktree owns the whole bootstrap: feature dir + canonical
  // structure + lazy bare anchor + branch ladder. With `githubRepo` declared
  // but the repo not yet created, its origin probe fails with "repository not
  // found" and it falls through to the empty-anchor rung (plumbing initial
  // commit + seed) — the documented Publish(init) path.
  await worktreeService.createWorktree(projectId, branchBase, userContext);

  // Pointer writes stay inside the lifecycle SSOT. Idempotent here (the
  // feature is named after branchBase), but it makes the config value
  // explicit instead of leaving it to the read-time 'main' default.
  await applyAfterFeatureCreate({ projectId, projectPath, anchorPath, userContext }, branchBase);

  return { created: true, feature: branchBase };
}
