import * as fs from 'fs';
import * as path from 'path';

/**
 * ProjectService
 * 
 * Manages project and feature CRUD operations.
 * Handles file system operations for project directories, configs, and features.
 */
export class ProjectService {
  private readonly workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * List all projects
   */
  async listProjects(): Promise<string[]> {
    try {
      const projects = await fs.promises.readdir(this.workspaceRoot);
      
      // Filter out hidden files and get only directories
      const projectDirs = await Promise.all(
        projects
          .filter(p => !p.startsWith('.'))
          .map(async (p) => {
            const stat = await fs.promises.stat(path.join(this.workspaceRoot, p));
            return stat.isDirectory() ? p : null;
          })
      );
      
      return projectDirs.filter(Boolean) as string[];
    } catch (error: any) {
      throw new Error(`Failed to list projects: ${error.message}`);
    }
  }
  
  /**
   * Sanitize project ID to valid project name (alphanumeric + hyphens)
   */
  private sanitizeProjectName(projectId: string): string {
    return projectId
      .toLowerCase()
      .replace(/\s+/g, '-')           // spaces → hyphens
      .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric except hyphens
      .replace(/-+/g, '-')            // multiple hyphens → single hyphen
      .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
  }

  /**
   * Create a new project
   */
  async createProject(id: string): Promise<void> {
    // Validate project ID (no special characters except hyphens and underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Project ID can only contain letters, numbers, hyphens, and underscores');
    }
    
    const projectPath = path.join(this.workspaceRoot, id);
    
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
    
    const defaultConfig = {
      projectName: sanitizedName,
      repoType: 'local',
      localPath: `~/dev/${sanitizedName}`,
      branchBase: 'main',
      autoLearn: true,
      llmProvider,  // ✅ Add LLM provider from env
      llmModel      // ✅ Add LLM model from env
    };
    
    await fs.promises.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  }
  
  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<void> {
    const projectPath = path.join(this.workspaceRoot, id);
    
    // Check if project exists
    try {
      await fs.promises.access(projectPath);
    } catch (error: any) {
      throw new Error('Project not found');
    }
    
    // Delete project directory recursively
    await fs.promises.rm(projectPath, { recursive: true, force: true });
  }
  
  /**
   * Get project config
   */
  async getProjectConfig(projectId: string): Promise<any> {
    const configPath = path.join(this.workspaceRoot, projectId, 'config.json');
    
    // Check if config exists
    try {
      await fs.promises.access(configPath);
    } catch (error: any) {
      throw new Error('Config file not found');
    }
    
    const configData = await fs.promises.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);
    
    // ✅ Add default LLM settings if missing (for backward compatibility)
    if (!config.llmProvider || !config.llmModel) {
      const llmProvider = process.env.AI_MODEL_PROVIDER || process.env.MODEL_PROVIDER || 'openai';
      const llmModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
      
      return {
        ...config,
        llmProvider: config.llmProvider || llmProvider,
        llmModel: config.llmModel || llmModel
      };
    }
    
    return config;
  }
  
  /**
   * Update project config
   */
  async updateProjectConfig(projectId: string, config: any): Promise<void> {
    const configPath = path.join(this.workspaceRoot, projectId, 'config.json');
    
    // Validate required fields
    if (!config.projectName || !config.branchBase) {
      throw new Error('Missing required fields: projectName, branchBase');
    }
    
    // Write config file
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
  
  /**
   * Get session data for a project
   */
  async getSession(projectId: string, featureName: string = 'skeleton', job: 'design' | 'code' | 'learn' = 'code'): Promise<any> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`
    );
    
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
  async resetJobState(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code'): Promise<void> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`
    );
    
    // Check if session file exists
    const exists = await fs.promises.access(sessionPath)
      .then(() => true)
      .catch(() => false);
    
    if (!exists) {
      console.log(`[ProjectService] No session file to reset: ${sessionPath}`);
      return;
    }
    
    // Read existing session
    const sessionData = await fs.promises.readFile(sessionPath, 'utf-8');
    const session = JSON.parse(sessionData);
    
    // Remove ALL job-related data (jobId, timing, tasks)
    if (session.state) {
      delete session.state.jobId;
      delete session.state.jobTiming;
      delete session.state.taskQueue;
      delete session.state.currentTask;
      delete session.state.completedTasks;
      delete session.state.completedTasksDetails;
      delete session.state.interruption;
      delete session.state.retries;
      delete session.state.recursionCount;
      delete session.state.recursionLimit;
      
      console.log(`[ProjectService] Reset job state: ${sessionPath}`);
      console.log(`   Removed: jobId, jobTiming, taskQueue, currentTask, completedTasks, completedTasksDetails, interruption, retries, recursionCount, recursionLimit`);
      
      // Write back to file
      await fs.promises.writeFile(
        sessionPath, 
        JSON.stringify(session, null, 2), 
        'utf-8'
      );
    }
  }
  
  /**
   * Get file tree for a project
   */
  async getFileTree(projectId: string, featureName: string = 'skeleton'): Promise<any> {
    const featurePath = path.join(this.workspaceRoot, projectId, featureName);
    
    const buildTree = async (currentPath: string, relativePath: string = ''): Promise<any> => {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      
      const tree = await Promise.all(
        entries
          .filter(entry => !entry.name.startsWith('.'))
          .map(async (entry) => {
            const fullPath = path.join(currentPath, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory',
                path: relPath,
                children: await buildTree(fullPath, relPath)
              };
            } else {
              const stats = await fs.promises.stat(fullPath);
              return {
                name: entry.name,
                type: 'file',
                path: relPath,
                size: stats.size
              };
            }
          })
      );
      
      return tree;
    };
    
    try {
      return await buildTree(featurePath);
    } catch (error: any) {
      throw new Error(`Failed to build file tree: ${error.message}`);
    }
  }
  
  /**
   * Read a file
   */
  async readFile(projectId: string, featureName: string, filePath: string): Promise<string> {
    const fullPath = path.join(this.workspaceRoot, projectId, featureName, filePath);
    
    try {
      await fs.promises.access(fullPath);
    } catch (error: any) {
      throw new Error('File not found');
    }
    
    return await fs.promises.readFile(fullPath, 'utf-8');
  }
  
  /**
   * Write a file
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.workspaceRoot, projectId, featureName, filePath);
    
    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }
  
  /**
   * List features for a project
   */
  async listFeatures(projectId: string): Promise<string[]> {
    const projectPath = path.join(this.workspaceRoot, projectId);
    
    try {
      const entries = await fs.promises.readdir(projectPath, { withFileTypes: true });
      
      // Return all directories except common ones
      return entries
        .filter(entry => 
          entry.isDirectory() && 
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules'
        )
        .map(entry => entry.name);
    } catch (error: any) {
      throw new Error(`Failed to list features: ${error.message}`);
    }
  }
  
  /**
   * Create a feature directory structure
   */
  async createFeature(projectId: string, featureName: string): Promise<void> {
    const featurePath = path.join(this.workspaceRoot, projectId, featureName);
    
    // Check if feature already exists
    try {
      await fs.promises.access(featurePath);
      throw new Error('Feature already exists');
    } catch (error: any) {
      if (error.message === 'Feature already exists') {
        throw error;
      }
      // Feature doesn't exist, which is what we want
    }
    
    // Create feature directory structure
    await fs.promises.mkdir(path.join(featurePath, 'inputs/directives'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'inputs/sources'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/design'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/reports'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions'), { recursive: true });  // ✅ Add sessions directory
  }
  
  /**
   * Resolve local path (handles ~/ expansion)
   */
  resolveLocalPath(localPath: string): string {
    if (localPath.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(homeDir, localPath.slice(2));
    }
    return localPath;
  }
}

