import * as fs from 'fs';
import * as path from 'path';
import { validateFeatureName } from '@ant/shared';
import { UserContext } from '../../../../../../core/types/user';
import { readBranchBase } from '../../../../../../core/utils/branchUtils';
import { GitHelper } from '../helper/GitHelper';
import { gitAnchor } from './GitAnchorSSOT';
import { GitConfigError, GitConflictError } from '../errors';
import { logger } from '../../../../../../utils/logger';

export { readBranchBase };

/**
 * branchBase lifecycle SSOT
 *
 * `branchBase` is a pure pointer into the project's feature set (branch name
 * == feature name), persisted in `config.json` and mirrored into the bare
 * anchor's HEAD symbolic-ref. This module is the ONLY writer:
 *
 * - fresh project (no features, no remote) → 'main' (ant default, unset in config)
 * - feature count 0→1                      → auto-set to that feature name
 * - base feature deleted                   → reassign to oldest remaining feature
 *                                            (creation order), or 'main' if none
 * - manual selection (ConfigEditor)        → must be an existing feature; only
 *                                            while no remote is connected
 * - remote connected (clone/init)          → LOCKED (clone writes remote HEAD once)
 *
 * Callers serialize mutations with `REDIS_KEYS.LOCK.FEATURE_LIFECYCLE`.
 */

export interface BranchBaseContext {
  projectId: string;
  projectPath: string;
  anchorPath: string;
  userContext: UserContext;
}

const COMPONENT = 'BranchBaseLifecycle';

/** Locked ⇔ the anchor has an origin remote (clone or init completed). */
export async function isBranchBaseLocked(anchorPath: string): Promise<boolean> {
  return gitAnchor.hasOriginRemote(anchorPath);
}

/**
 * List feature directory names in creation order (oldest first).
 * Creation order uses dir birthtime with mtime fallback; ties break by name
 * so reassignment stays deterministic.
 */
export async function listFeatureDirsByCreation(
  projectPath: string
): Promise<Array<{ name: string; createdAt: Date }>> {
  const featuresPath = path.join(projectPath, 'features');
  let items: string[];
  try {
    items = await fs.promises.readdir(featuresPath);
  } catch {
    return [];
  }

  const entries: Array<{ name: string; createdAt: Date }> = [];
  for (const item of items) {
    if (item.startsWith('.')) continue;
    try {
      const stat = await fs.promises.stat(path.join(featuresPath, item));
      if (!stat.isDirectory()) continue;
      const birth = stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
      entries.push({ name: item, createdAt: birth });
    } catch {
      // dir vanished mid-scan — skip
    }
  }

  entries.sort((a, b) => {
    const dt = a.createdAt.getTime() - b.createdAt.getTime();
    return dt !== 0 ? dt : a.name.localeCompare(b.name);
  });
  return entries;
}

function writeBranchBaseToConfig(projectPath: string, branchBase: string): void {
  const configPath = path.join(projectPath, 'config.json');
  let config: any = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // corrupt config — rewrite with just the pointer rather than losing the write
  }
  config.branchBase = branchBase;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

async function setPointer(ctx: BranchBaseContext, branchBase: string): Promise<void> {
  writeBranchBaseToConfig(ctx.projectPath, branchBase);
  if (GitHelper.isBareAnchorReady(ctx.anchorPath)) {
    try {
      await gitAnchor.setHeadBranch(ctx.anchorPath, branchBase);
    } catch (error) {
      logger.warn('Failed to update anchor HEAD for branchBase', { component: COMPONENT }, {
        projectId: ctx.projectId,
        branchBase,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * After a feature is created: when the pointer is unlocked and this is the
 * ONLY feature (0→1 transition), branchBase becomes the feature name.
 */
export async function applyAfterFeatureCreate(
  ctx: BranchBaseContext,
  featureName: string
): Promise<void> {
  if (await isBranchBaseLocked(ctx.anchorPath)) return;

  const features = await listFeatureDirsByCreation(ctx.projectPath);
  if (features.length !== 1 || features[0].name !== featureName) return;

  await setPointer(ctx, featureName);
  logger.info('branchBase auto-set to first feature', { component: COMPONENT }, {
    projectId: ctx.projectId,
    branchBase: featureName,
  });
}

/**
 * Before the feature whose name == branchBase is deleted:
 * - locked  → keep branchBase (remote HEAD symmetry; recreating a feature
 *             with that name re-tracks origin/{branchBase})
 * - unlocked → reassign to the oldest remaining feature, or 'main' if this
 *              was the last one. HEAD is repointed BEFORE `branch -D` so the
 *              anchor HEAD never blocks deletion.
 *
 * Returns the effective branchBase after the delete.
 */
export async function applyBeforeBaseFeatureDelete(
  ctx: BranchBaseContext,
  featureName: string
): Promise<string> {
  const current = readBranchBase(ctx.projectPath);
  if (current !== featureName) return current;

  if (await isBranchBaseLocked(ctx.anchorPath)) return current;

  const remaining = (await listFeatureDirsByCreation(ctx.projectPath))
    .filter((f) => f.name !== featureName);
  const next = remaining[0]?.name ?? 'main';

  await setPointer(ctx, next);
  logger.info('branchBase reassigned on base feature delete', { component: COMPONENT }, {
    projectId: ctx.projectId,
    deleted: featureName,
    branchBase: next,
  });
  return next;
}

/**
 * Manual selection from the ConfigEditor dropdown. Rejected when the remote
 * lock is on or the value is not an existing feature.
 */
export async function setBranchBaseManual(
  ctx: BranchBaseContext,
  value: string
): Promise<void> {
  if (await isBranchBaseLocked(ctx.anchorPath)) {
    throw new GitConflictError(
      'Base branch is locked — it is determined by the connected GitHub repository',
      { retryable: false }
    );
  }

  const check = validateFeatureName(value);
  if (!check.ok) {
    throw new GitConfigError(
      `Invalid base branch "${value}" (${check.violation})`,
      { retryable: false }
    );
  }

  const features = await listFeatureDirsByCreation(ctx.projectPath);
  if (!features.some((f) => f.name === value)) {
    throw new GitConfigError(
      `Base branch must be an existing feature — "${value}" not found`,
      { retryable: false }
    );
  }

  await setPointer(ctx, value);
  logger.info('branchBase set manually', { component: COMPONENT }, {
    projectId: ctx.projectId,
    branchBase: value,
  });
}
