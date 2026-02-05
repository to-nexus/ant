import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';

/**
 * FeatureCrudService
 * 
 * Handles feature CRUD operations and session management
 */
export class FeatureCrudService {
  private readonly workspaceResolver: WorkspaceResolver;
  private switchToFeatureBranchFn?: (projectId: string, featureName: string, userContext: UserContext) => Promise<{ branchName: string; currentBranch: string }>;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Set the switchToFeatureBranch function (injected from GitBranchService)
   */
  setSwitchToFeatureBranchFn(fn: (projectId: string, featureName: string, userContext: UserContext) => Promise<{ branchName: string; currentBranch: string }>) {
    this.switchToFeatureBranchFn = fn;
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
    const sessionPath = path.join(featurePath, `sessions/${job}.json`);
    
    // Check if session file exists
    const exists = await fs.promises.access(sessionPath)
      .then(() => true)
      .catch(() => false);
    
    if (!exists) {
      throw new Error('Session file not found');
    }
    
    const sessionData = await fs.promises.readFile(sessionPath, 'utf-8');
    return JSON.parse(sessionData);
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
    const sessionPath = path.join(featurePath, `sessions/${jobType}.json`);
    
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
    
    // Base branch names that should not appear as features
    const baseBranchNames = ['main', 'master', 'develop'];
    
    const items = await fs.promises.readdir(featuresPath);
    const features = await Promise.all(
      items
        .filter(item => !item.startsWith('.'))
        .map(async (item) => {
          const itemPath = path.join(featuresPath, item);
          const stat = await fs.promises.stat(itemPath);
          return stat.isDirectory() ? item : null;
        })
    );
    
    // Filter out base branches and null values
    return features.filter(f => f && !baseBranchNames.includes(f.toLowerCase())) as string[];
  }
  
  /**
   * Create a new feature
   */
  async createFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    // Create feature directory structure
    await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/design'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/code'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/learn'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/sources'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/design'), { recursive: true });
    
    // ✅ Evaluations (평가 리포트 - 영구 보존 산출물)
    await fs.promises.mkdir(path.join(featurePath, 'outputs/evals/prd'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/evals/ui-design'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/evals/system-design'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/evals/code'), { recursive: true });
    
    // ✅ Sessions (세션 상태)
    await fs.promises.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
    
    // ✅ Debug (디버깅 자료 - 일시적)
    await fs.promises.mkdir(path.join(featurePath, 'sessions/debug/prompts'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions/debug/plans'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions/debug/logs'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions/debug/asks'), { recursive: true });

    // Create inputs/sources templates (so users know what to fill)
    const sourcesDir = path.join(featurePath, 'inputs/sources');

    const prdTemplate = `<!-- ant:template -->
<!-- 작성 후 이 줄(ant:template)을 삭제하세요. 남아있으면 시스템이 "비어있는 입력"으로 취급합니다. -->

# ${featureName} - PRD

> ✅ 필수: 이 파일은 항상 존재해야 합니다. (단일 입력 파일: \`inputs/sources/prd.md\`)

## 1) 한 줄 요약
- 

## 2) 문제/목표
- **문제**:
- **목표**:
- **비목표(이번에 하지 않는 것)**:

## 3) 사용자 시나리오
- 

## 4) 요구사항 (Functional)
- 

## 5) 비기능 (Non-Functional)
- 성능:
- 접근성:
- 보안/권한:

## 6) 제약/리스크
- 
`;
    await fs.promises.writeFile(path.join(sourcesDir, 'prd.md'), prdTemplate, 'utf-8');

    // NOTE: UI documents (ui-spec.json, ui-tokens.json, ui-assets.json) are auto-generated
    // by Design Job into outputs/design/. No placeholders needed.

    await fs.promises.mkdir(path.join(featurePath, 'inputs/assets'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/references/screens'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/references/components'), { recursive: true });
    // NOTE: icons are treated as runtime assets by default → place under inputs/assets/** (e.g. inputs/assets/icons/*)

    // ✅ Create Git branch for feature (if Git is initialized and function is injected)
    if (this.switchToFeatureBranchFn) {
      try {
        await this.switchToFeatureBranchFn(projectId, featureName, userContext);
      } catch (error: any) {
        // If Git not initialized, silently skip (not an error for feature creation)
        if (error.message?.includes('not initialized')) {
          // Silently skip
        } else {
          console.error(`[FeatureCrudService] Failed to create branch for ${featureName}:`, error);
          // Don't throw - feature directories are created successfully
        }
      }
    }
  }
  
  /**
   * Delete a feature
   */
  async deleteFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    try {
      await fs.promises.access(featurePath);
    } catch {
      throw new Error('Feature not found');
    }
    
    await fs.promises.rm(featurePath, { recursive: true, force: true });
  }
}

