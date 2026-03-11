import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { getSessionFilePathByJob, getInitFeatureDirs } from '../../../../../core/utils/sessionPaths';
import { isBaseBranch, readBranchBaseFromConfig, RESERVED_FEATURE_NAME } from '../../../../../core/utils/branchUtils';
import { WorktreeService } from '../GitService/worktree';

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
   * Reset job state (remove jobId, timing, and all task data from session)
   */
  async resetJobState(
    projectId: string,
    featureName: string,
    jobType: 'design' | 'code' | 'learn',
    userContext: UserContext
  ): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);
    
    try {
      // Read existing session
      const sessionData = JSON.parse(await fs.promises.readFile(sessionPath, 'utf-8'));
      
      // Reset state
      const resetSession = {
        ...sessionData,
        state: {
          taskQueue: [],
          completedTasks: [],
          completedTasksDetails: [],
          currentTask: null,
          jobTiming: null,
          interruption: null
        }
      };
      
      // Write back
      await fs.promises.writeFile(sessionPath, JSON.stringify(resetSession, null, 2), 'utf-8');
      console.log(`✅ [FeatureCrudService] Reset ${jobType} job state for ${projectId}/${featureName}`);
    } catch (error) {
      console.error(`❌ [FeatureCrudService] Failed to reset ${jobType} job state:`, error);
      throw error;
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
  async createFeature(projectId: string, featureName: string, userContext: UserContext, language?: string): Promise<void> {
    if (featureName === RESERVED_FEATURE_NAME) {
      throw new Error(`"${RESERVED_FEATURE_NAME}" is a reserved name and cannot be used as a feature name`);
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    // Create all canonical directories (single source of truth: CANONICAL_FEATURE_DIRS)
    for (const dir of getInitFeatureDirs(featurePath)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Create inputs/sources templates (so users know what to fill)
    const sourcesDir = path.join(featurePath, 'inputs/sources');

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
    await fs.promises.writeFile(path.join(sourcesDir, 'prd.md'), prdTemplate, 'utf-8');

    // NOTE: UI documents (ui-spec.json, ui-tokens.json, ui-assets.json) are auto-generated
    // by Design Job into outputs/design/. No placeholders needed.

    await fs.promises.mkdir(path.join(featurePath, 'inputs/assets'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/references'), { recursive: true });
    // NOTE: icons are treated as runtime assets by default → place under inputs/assets/** (e.g. inputs/assets/icons/*)

    // ✅ Create Git worktree for feature (if WorktreeService is available)
    if (this.worktreeService) {
      try {
        await this.worktreeService.createWorktree(projectId, featureName, userContext);
      } catch (error: any) {
        // If Git not initialized, silently skip (not an error for feature creation)
        if (error.message?.includes('not initialized')) {
          // Silently skip
        } else {
          console.error(`[FeatureCrudService] Failed to create worktree for ${featureName}:`, error);
          // Don't throw - feature directories are created successfully
        }
      }
    }
  }
  
  /**
   * Delete a feature (removes worktree, branch, and feature directory)
   */
  async deleteFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    try {
      await fs.promises.access(featurePath);
    } catch {
      throw new Error('Feature not found');
    }
    
    // Remove Git worktree and branch first
    if (this.worktreeService) {
      try {
        await this.worktreeService.removeWorktree(projectId, featureName, userContext);
      } catch (error: any) {
        console.warn(`[FeatureCrudService] Worktree removal failed (non-critical): ${error.message}`);
      }
    }
    
    // Remove the entire feature directory
    await fs.promises.rm(featurePath, { recursive: true, force: true });
  }
}

