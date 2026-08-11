import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { getSessionFilePathByJob, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import { acquireLock } from '../../../../../core/redis/distributedLock';
import { REDIS_KEYS } from '../../../../../core/constants/redis';
import { WorktreeService } from '../GitService/worktree';
import { assertValidFeatureName } from '../GitService/helper/featureNameGuard';
import {
  applyAfterFeatureCreate,
  applyBeforeBaseFeatureDelete,
  listFeatureDirsByCreation,
  readBranchBase,
  BranchBaseContext,
} from '../GitService/anchor/branchBaseLifecycle';
import { GitConflictError } from '../GitService/errors';
import { DeletionVerificationError } from './errors';
import { logger } from '../../../../../utils/logger';

const FEATURE_LIFECYCLE_LOCK_TTL_SEC = 60;

/**
 * FeatureCrudService
 *
 * Handles feature CRUD operations and session management.
 * Uses WorktreeService for Git worktree-based feature isolation.
 * Create/delete run inside the FEATURE_LIFECYCLE distributed lock so the
 * branchBase pointer auto-apply rules never race concurrent mutations.
 */
export class FeatureCrudService {
  private readonly workspaceResolver: WorkspaceResolver;
  private worktreeService?: WorktreeService;
  private stateStore?: StateStorePort;

  constructor(workspaceResolver: WorkspaceResolver, stateStore?: StateStorePort) {
    this.workspaceResolver = workspaceResolver;
    this.stateStore = stateStore;
  }

  /**
   * Set the WorktreeService (injected after construction to avoid circular deps)
   */
  setWorktreeService(service: WorktreeService) {
    this.worktreeService = service;
  }

  private branchBaseContext(projectId: string, userContext: UserContext): BranchBaseContext {
    return {
      projectId,
      projectPath: this.workspaceResolver.getProjectPath(userContext, projectId),
      anchorPath: this.workspaceResolver.getGitAnchorPath(userContext, projectId),
      userContext,
    };
  }

  /**
   * Serialize the feature-lifecycle critical section (worktree mutation +
   * branchBase pointer update) per project. Contention → 409.
   */
  private async withFeatureLifecycleLock<T>(
    projectId: string,
    userContext: UserContext,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.stateStore) {
      // Test-only construction path; production wiring always injects the store.
      logger.debug('[FeatureCrudService] no stateStore — feature lifecycle lock skipped', {
        component: 'FeatureCrudService',
        projectId,
      });
      return fn();
    }
    const key = REDIS_KEYS.LOCK.FEATURE_LIFECYCLE(
      userContext.organizationId,
      userContext.userId,
      projectId
    );
    const lock = await acquireLock(this.stateStore, key, FEATURE_LIFECYCLE_LOCK_TTL_SEC);
    if (!lock) {
      throw new GitConflictError(
        'Another feature operation is in progress for this project — try again shortly',
        { retryable: true, retryAfterMs: 3000 }
      );
    }
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }

  /**
   * NFS-safe file read with retry for ESTALE (errno -116) stale file handles.
   * In multi-pod K8s environments with EFS/NFS, another pod may modify files
   * causing the local kernel to hold a stale inode reference.
   * A short delay + retry forces the NFS client to re-lookup the inode.
   */
  private async readFileWithRetry(filePath: string, retries = 2): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fs.promises.readFile(filePath, 'utf-8');
      } catch (err: any) {
        const isStale = err.errno === -116 || err.code === 'ESTALE' 
          || (err.message && err.message.includes('system error -116'));
        if (isStale && attempt < retries) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed to read file after ${retries} retries: ${filePath}`);
  }
  
  /**
   * Get session data for a feature
   */
  async getSession(
    projectId: string,
    featureName: string = 'skeleton',
    job: 'design' | 'code' | 'learn' = 'code',
    userContext: UserContext
  ): Promise<any> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, job);
    
    try {
      const sessionData = await this.readFileWithRetry(sessionPath);
      return JSON.parse(sessionData);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('Session file not found');
      }
      throw err;
    }
  }
  
  /**
   * List all features for a project, oldest first (creation order — the same
   * ordering the branchBase reassignment rule uses).
   */
  async listFeatures(projectId: string, userContext: UserContext): Promise<string[]> {
    const detailed = await this.listFeaturesDetailed(projectId, userContext);
    return detailed.map((f) => f.name);
  }

  /**
   * Creation-ordered feature list with timestamps (route/API surface).
   */
  async listFeaturesDetailed(
    projectId: string,
    userContext: UserContext
  ): Promise<Array<{ name: string; createdAt: Date }>> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    return listFeatureDirsByCreation(projectPath);
  }

  /**
   * Create a new feature.
   *
   * The whole [mkdir → canonical structure → worktree → branchBase auto-apply]
   * sequence runs inside the FEATURE_LIFECYCLE lock. No PRD skeleton is
   * written — the plan job authors LLM-named doc(s) under `plan/` on demand.
   */
  async createFeature(projectId: string, featureName: string, userContext: UserContext, language?: string): Promise<void> {
    assertValidFeatureName(featureName);

    // Policy flag (D6): universal-type projects have no canonical plane —
    // features (codebase/, worktrees, git anchor) belong to canonical projects.
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configRaw = fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8');
      if (JSON.parse(configRaw)?.projectType === 'universal') {
        throw new Error('Universal-type projects do not support features — run a custom agent job instead');
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('do not support features')) throw e;
      // config unreadable → treat as canonical (default), proceed
    }

    await this.withFeatureLifecycleLock(projectId, userContext, async () => {
      const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      if (fs.existsSync(featurePath)) {
        throw new Error('Feature already exists');
      }

      try {
        await this.createFeatureBody(projectId, featureName, featurePath, userContext, language);
      } catch (error) {
        // The existence guard above proves THIS call created featurePath —
        // remove it so a retry does not hit "Feature already exists" with a
        // half-created feature (e.g. worktree creation failed). Also prune
        // any worktree meta the failed `git worktree add` left in the anchor,
        // otherwise the retry's add fails with "already registered".
        await fs.promises.rm(featurePath, { recursive: true, force: true }).catch((rmErr) => {
          logger.warn('[FeatureCrudService.createFeature] failed-create cleanup could not remove feature dir', {
            component: 'FeatureCrudService',
            projectId,
            featureName,
          }, { featurePath, error: rmErr instanceof Error ? rmErr.message : String(rmErr) });
        });
        const anchorPath = this.workspaceResolver.getGitAnchorPath(userContext, projectId);
        await WorktreeService.pruneCorruptWorktreeMeta(anchorPath).catch(() => undefined);
        throw error;
      }
    });
  }

  private async createFeatureBody(
    projectId: string,
    featureName: string,
    featurePath: string,
    userContext: UserContext,
    language?: string,
  ): Promise<void> {
      // 'codebase' is managed separately (WorktreeService may replace it with a git worktree).
      // Must be created BEFORE ensureCanonicalStructure — its mkdir -p also creates featurePath.
      await fs.promises.mkdir(path.join(featurePath, 'codebase'), { recursive: true });

      // Canonical directories + files (CANONICAL_FEATURE_DIRS + CANONICAL_FEATURE_FILES).
      // `plan/` is created here empty — no PRD skeleton; the plan job authors
      // LLM-named doc(s) into it on demand.
      await ensureCanonicalStructure(featurePath);

      if (!this.worktreeService) {
        throw new Error('Worktree service is not configured');
      }
      await this.worktreeService.createWorktree(projectId, featureName, userContext);

      // branchBase auto-apply: feature count 0→1 sets the pointer to this
      // feature (no-op when locked by a connected remote).
      await applyAfterFeatureCreate(this.branchBaseContext(projectId, userContext), featureName);

      // Post-create canonical invariant probe: if any of the three UiSource
      // sibling dirs is missing after ensureCanonicalStructure + worktree
      // setup, surface a structured ERROR log so future regressions are
      // visible immediately (ties into the access-time backfill observability
      // emitted from ensureCanonicalStructure). Best-effort — never throws.
      try {
        const uiDir = path.join(featurePath, 'visual/ui');
        const present = await fs.promises.readdir(uiDir).catch(() => [] as string[]);
        const requiredSiblings = ['ant', 'figma', 'handoff'] as const;
        const missing = requiredSiblings.filter(sib => !present.includes(sib));
        if (missing.length > 0) {
          logger.error('[FeatureCrudService.createFeature] canonical UI sibling missing post-create', {
            component: 'FeatureCrudService',
            projectId,
            featureName,
          }, { featurePath, missing, present });
        }
      } catch (probeErr: any) {
        logger.warn('[FeatureCrudService.createFeature] canonical invariant probe failed', {
          component: 'FeatureCrudService',
          projectId,
          featureName,
        }, { error: probeErr?.message ?? String(probeErr) });
      }
  }

  /**
   * Delete a feature (removes worktree, branch, and feature directory).
   *
   * Verification loop mirrors `ProjectCrudService.deleteProject` — an IDE
   * pod / job-runner child / preview process holding open file handles
   * causes NFS silly-rename `.nfsXXXX` orphans to survive the initial
   * `fs.rm`. Caller (`ProjectService.deleteFeature`) has already cancelled
   * jobs / stopped IDE / acked preview cleanup before this runs, so this
   * loop is the final guard.
   *
   * On timeout, throws `DeletionVerificationError`; caller wraps it into
   * a `FeatureDeletionError({ stage: 'fsVerify', leftovers })`. `force =
   * true` extends the window 10s → 20s.
   */
  async deleteFeature(
    projectId: string,
    featureName: string,
    userContext: UserContext,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    try {
      await fs.promises.access(featurePath);
    } catch {
      throw new Error('Feature not found');
    }

    await this.withFeatureLifecycleLock(projectId, userContext, async () => {
      // When deleting the base feature, repoint the pointer (config + anchor
      // HEAD) BEFORE `branch -D` — deleting the anchor HEAD branch is refused
      // by git. Locked (remote-connected) projects keep branchBase unchanged.
      const ctx = this.branchBaseContext(projectId, userContext);
      if (readBranchBase(ctx.projectPath) === featureName) {
        await applyBeforeBaseFeatureDelete(ctx, featureName);
      }

      // Remove Git worktree and branch.
      if (this.worktreeService) {
        try {
          await this.worktreeService.removeWorktree(projectId, featureName, userContext);
        } catch (error: any) {
          logger.warn(`[FeatureCrudService] Worktree removal failed (non-critical)`, { component: 'FeatureCrudService' }, {
            projectId,
            featureName,
            error: error?.message ?? String(error),
          });
        }
      }

      // Initial recursive remove. Errors tolerated; verification loop is SSOT.
      await fs.promises.rm(featurePath, { recursive: true, force: true });

      // Verify completion. Same NFS silly-rename rationale as deleteProject.
      const POLL_INTERVAL_MS = 200;
      const MAX_POLL_ATTEMPTS = opts.force ? 100 : 50;
      for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        const exists = await fs.promises
          .access(featurePath)
          .then(() => true)
          .catch(() => false);
        if (!exists) return;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Still there → collect diagnostic info for the FE failure banner.
      let leftovers: string[] = [];
      try {
        const all = await fs.promises.readdir(featurePath);
        leftovers = all.slice(0, 20);
      } catch {
        // Path read failed — likely transient; leave leftovers empty.
      }

      throw new DeletionVerificationError(featurePath, leftovers);
    });
  }
}

