import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { getSessionFilePathByJob, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import { isBaseBranch, readBranchBaseFromConfig, RESERVED_FEATURE_NAME } from '../../../../../core/utils/branchUtils';
import { WorktreeService } from '../GitService/worktree';
import { DeletionVerificationError } from './errors';
import { logger } from '../../../../../utils/logger';

/**
 * FeatureCrudService
 * 
 * Handles feature CRUD operations and session management.
 * Uses WorktreeService for Git worktree-based feature isolation.
 */
export class FeatureCrudService {
  private readonly workspaceResolver: WorkspaceResolver;
  private worktreeService?: WorktreeService;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Set the WorktreeService (injected after construction to avoid circular deps)
   */
  setWorktreeService(service: WorktreeService) {
    this.worktreeService = service;
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
   * List all features for a project
   */
  async listFeatures(projectId: string, userContext: UserContext): Promise<string[]> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const featuresPath = path.join(projectPath, 'features');
    
    try {
      await fs.promises.access(featuresPath);
    } catch {
      // features directory doesn't exist yet
      return [];
    }
    
    const branchBase = readBranchBaseFromConfig(projectPath);
    
    const items = await fs.promises.readdir(featuresPath);
    const features = await Promise.all(
      items
        .filter(item => !item.startsWith('.'))
        .map(async (item) => {
          const itemPath = path.join(featuresPath, item);
          try {
            const stat = await fs.promises.stat(itemPath);
            return stat.isDirectory() ? item : null;
          } catch {
            return null;
          }
        })
    );
    
    // Filter out base branch and null values
    return features.filter(f => f && !isBaseBranch(f, branchBase)) as string[];
  }
  
  /**
   * Create a new feature
   */
  async createFeature(projectId: string, featureName: string, userContext: UserContext, language?: string, options?: { skipPrdTemplate?: boolean }): Promise<void> {
    if (featureName === RESERVED_FEATURE_NAME) {
      throw new Error(`"${RESERVED_FEATURE_NAME}" is a reserved name and cannot be used as a feature name`);
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    if (fs.existsSync(featurePath)) {
      throw new Error('Feature already exists');
    }
    
    // 'codebase' is managed separately (WorktreeService may replace it with a git worktree).
    // Must be created BEFORE ensureCanonicalStructure — its mkdir -p also creates featurePath.
    await fs.promises.mkdir(path.join(featurePath, 'codebase'), { recursive: true });

    // Canonical directories + files (CANONICAL_FEATURE_DIRS + CANONICAL_FEATURE_FILES)
    await ensureCanonicalStructure(featurePath);

    // Create `plan/` templates (so users know what to fill)
    // Skip when wizard will upload source files (prd skeleton would be redundant)
    if (!options?.skipPrdTemplate) {
      const planDir = path.join(featurePath, 'plan');

      const locale = (language === 'ko' || language === 'en') ? language : 'en';
      const msg = locale === 'ko'
        ? {
            markerGuide: '작성 후 위의 ant:template 줄을 삭제하세요. 이 마커가 남아있으면 시스템은 비어있는 입력으로 취급합니다.',
            prdGuide: '여기에 PRD를 작성하거나, 플래너 모드로 대화형 생성을 이용하세요.',
          }
        : {
            markerGuide: 'Remove the ant:template line above after writing. The system treats this file as empty while the marker remains.',
            prdGuide: 'Write your PRD here, or use Planner mode for interactive generation.',
          };
      const prdTemplate = `<!-- ant:template -->
<!-- ${msg.markerGuide} -->
# ${featureName} - PRD

<!-- ${msg.prdGuide} -->
`;
      await fs.promises.writeFile(path.join(planDir, 'prd.md'), prdTemplate, 'utf-8');
    }

    if (!this.worktreeService) {
      throw new Error('Worktree service is not configured');
    }
    await this.worktreeService.createWorktree(projectId, featureName, userContext);

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

    // Remove Git worktree and branch first.
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
  }
}

