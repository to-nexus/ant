import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';

/**
 * ProjectService
 * 
 * Manages project and feature CRUD operations.
 * Handles file system operations for project directories, configs, and features.
 * 
 * ✅ Refactored to use WorkspaceResolver (no more state-based workspace path)
 */
export class ProjectService {
  private readonly workspaceResolver: WorkspaceResolver;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * List all projects for a user
   */
  async listProjects(userContext: UserContext): Promise<string[]> {
    try {
      const workspacePath = this.workspaceResolver.getWorkspacePath(userContext);
      
      // Check if workspace exists
      try {
        await fs.promises.access(workspacePath);
      } catch {
        // Workspace doesn't exist, return empty array
        return [];
      }
      
      const projects = await fs.promises.readdir(workspacePath);
      
      // Filter out hidden files and get only directories
      const projectDirs = await Promise.all(
        projects
          .filter(p => !p.startsWith('.'))
          .map(async (p) => {
            const stat = await fs.promises.stat(path.join(workspacePath, p));
            return stat.isDirectory() ? p : null;
          })
      );
      
      return projectDirs.filter(Boolean) as string[];
    } catch (error) {
      console.error('[ProjectService] Error listing projects:', error);
      return [];
    }
  }
  
  /**
   * Sanitize project name for use in file paths
   * Removes special characters except hyphens and underscores
   */
  private sanitizeProjectName(projectId: string): string {
    return projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')  // replace invalid chars with hyphen
      .replace(/-+/g, '-')           // collapse multiple hyphens
      .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
  }

  /**
   * Create a new project
   * 
   * @param id - Project ID
   * @param userContext - User context for workspace path
   */
  async createProject(id: string, userContext: UserContext): Promise<void> {
    // Validate project ID (no special characters except hyphens and underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Project ID can only contain letters, numbers, hyphens, and underscores');
    }
    
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);
    
    // Check if project already exists
    try {
      await fs.promises.access(projectPath);
      throw new Error('Project already exists');
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        throw error;
      }
      // Project doesn't exist, which is what we want
    }
    
    // Create project directory structure
    await fs.promises.mkdir(projectPath, { recursive: true });
    
    // Sanitize project name for repo path
    const sanitizedName = this.sanitizeProjectName(id);
    
    // Create config with proper defaults
    const configPath = path.join(projectPath, 'config.json');
    
    // ✅ Get LLM config from environment variables
    const llmProvider = process.env.AI_MODEL_PROVIDER || process.env.MODEL_PROVIDER || 'openai';
    const llmModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
    
    // ✅ Determine if Cloud Mode
    const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
    
    console.log('[ProjectService] Creating project config:');
    console.log('  - userContext:', userContext);
    console.log('  - isCloudMode:', isCloudMode);
    
    // ✅ Create config based on mode
    const config = {
      repositoryName: sanitizedName,  // ✅ Repository/codebase name
      repoType: isCloudMode ? 'cloud' : 'local',
      localPath: isCloudMode 
        ? path.join(projectPath, 'codebase')  // Cloud: workspaces/{org}/{user}/{project}/codebase
        : `../${sanitizedName}`,               // Local: relative path (~/dev/{sanitizedName})
      branchBase: 'main',
      autoLearn: true,
      llmProvider,
      ...(llmModel && { llmModel })
    };
    
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
  
  /**
   * Delete a project
   */
  async deleteProject(id: string, userContext: UserContext): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);
    
    // Check if project exists
    try {
      await fs.promises.access(projectPath);
    } catch {
      throw new Error('Project not found');
    }
    
    // Delete project directory
    await fs.promises.rm(projectPath, { recursive: true, force: true });
  }
  
  /**
   * Get project configuration
   */
  async getProjectConfig(id: string, userContext: UserContext): Promise<any> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, id);
    const configPath = path.join(projectPath, 'config.json');
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      // Return default config if file doesn't exist
      return {
        repoType: 'local',
        localPath: `../${id}`
      };
    }
  }
  
  /**
   * Update project configuration
   * 
   * ⚠️ Security: In Cloud mode, localPath is immutable (always {projectPath}/codebase)
   */
  async updateProjectConfig(projectId: string, config: any, userContext: UserContext): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    // ✅ Cloud Mode: Validate and enforce localPath
    const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
    
    if (isCloudMode && config.repoType === 'cloud') {
      // ✅ CRITICAL: In Cloud mode, localPath is always fixed to {projectPath}/codebase
      // Users cannot modify this for security reasons
      const expectedLocalPath = path.join(projectPath, 'codebase');
      
      if (config.localPath && config.localPath !== expectedLocalPath) {
        console.warn(`[ProjectService] ⚠️  Attempted to modify localPath in Cloud mode`);
        console.warn(`   Provided: ${config.localPath}`);
        console.warn(`   Expected: ${expectedLocalPath}`);
        console.warn(`   Enforcing correct localPath for security`);
      }
      
      // ✅ Force correct localPath
      config.localPath = expectedLocalPath;
    }
    
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
  
  /**
   * Get session data for a project
   */
  async getSession(projectId: string, featureName: string = 'skeleton', job: 'design' | 'code' | 'learn' = 'code', userContext: UserContext): Promise<any> {
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
      console.log(`✅ [ProjectService] Reset ${jobType} job state for ${projectId}/${featureName}`);
    } catch (error) {
      console.error(`❌ [ProjectService] Failed to reset ${jobType} job state:`, error);
      throw error;
    }
  }
  
  // =====================================
  // Feature Management
  // =====================================
  
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
    
    return features.filter(Boolean) as string[];
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
    await fs.promises.mkdir(path.join(featurePath, 'outputs'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
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
  
  // =====================================
  // File Operations
  // =====================================
  
  /**
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<any> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    const buildTree = async (dirPath: string, relativePath: string = ''): Promise<any> => {
      let items: string[] = [];
      try {
        items = await fs.promises.readdir(dirPath);
      } catch (err) {
        // 폴더가 없으면 빈 children 반환
        return [];
      }
      const tree: any[] = [];

      // 폴더가 비어있어도 반드시 반환
      if (items.length === 0) {
        return [{
          name: path.basename(dirPath),
          path: relativePath || path.basename(dirPath),
          type: 'directory',
          children: []
        }];
      }

      for (const item of items) {
        if (item.startsWith('.')) continue;

        const fullPath = path.join(dirPath, item);
        const itemRelativePath = relativePath ? `${relativePath}/${item}` : item;
        const stat = await fs.promises.stat(fullPath);

        if (stat.isDirectory()) {
          const children = await buildTree(fullPath, itemRelativePath);
          tree.push({
            name: item,
            path: itemRelativePath,
            type: 'directory',
            children
          });
        } else {
          tree.push({
            name: item,
            path: itemRelativePath,
            type: 'file'
          });
        }
      }

      return tree;
    };

    try {
      const tree = await buildTree(featurePath);
      // 최상위 featurePath가 비어있으면 빈 폴더 반환
      if (tree.length === 0) {
        return [{
          name: path.basename(featurePath),
          path: '',
          type: 'directory',
          children: []
        }];
      }
      return tree;
    } catch (error) {
      console.error('[ProjectService] Error building file tree:', error);
      return [{
        name: path.basename(featurePath),
        path: '',
        type: 'directory',
        children: []
      }];
    }
  }
  
  /**
   * Read file content
   */
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<string> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
    return await fs.promises.readFile(fullPath, 'utf-8');
  }
  
  /**
   * Write file content
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }
  
  /**
   * Delete a file
   */
  async deleteFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
    await fs.promises.unlink(fullPath);
  }
  
  /**
   * Upload multiple files
   */
  async uploadFiles(
    projectId: string,
    featureName: string,
    files: Array<{ path: string; content: Buffer }>,
    userContext: UserContext
  ): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    for (const file of files) {
      const fullPath = path.join(featurePath, file.path);
      
      // Security: prevent path traversal
      if (!fullPath.startsWith(featurePath)) {
        throw new Error(`Invalid file path: ${file.path}`);
      }
      
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      await fs.promises.writeFile(fullPath, file.content);
    }
  }
}
