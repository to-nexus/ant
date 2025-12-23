import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';

/**
 * ProjectCrudService
 * 
 * Handles project CRUD operations (Create, Read, Update, Delete)
 */
export class ProjectCrudService {
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
      console.error('[ProjectCrudService] Error listing projects:', error);
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
    const defaultModel = process.env.AI_MODEL_NAME || 'claude-sonnet-4-5-20250929';  // ✅ Latest default
    
    // ✅ Determine if Cloud Mode
    const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
    
    console.log('[ProjectCrudService] Creating project config:');
    console.log('  - userContext:', userContext);
    console.log('  - isCloudMode:', isCloudMode);
    console.log('  - defaultModel:', defaultModel);
    
    // ✅ Create config based on mode
    const config = {
      repositoryName: sanitizedName,  // ✅ Repository/codebase name
      repoType: isCloudMode ? 'cloud' : 'local',
      // ✅ Only include localPath for local mode
      ...(isCloudMode ? {} : { localPath: `../${sanitizedName}` }),
      branchBase: 'main',
      autoLearn: true,
      llmModels: {
        designDecompose: defaultModel,
        designDefault: defaultModel,
        codeDecompose: defaultModel,
        codeError: defaultModel,
        codeFinal: defaultModel,
        codeSetup: defaultModel,  // ✅ Setup tasks
        codeDefault: defaultModel,
      }
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
    
    // Get environment variable defaults for LLM
    const defaultLLMProvider = process.env.AI_MODEL_PROVIDER || process.env.MODEL_PROVIDER || 'openai';
    const defaultLLMModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // ✅ Apply environment variable defaults if not set in config
      if (!config.llmProvider) {
        config.llmProvider = defaultLLMProvider;
      }
      if (!config.llmModels) {
        config.llmModels = {};
      }
      // Apply default model to any missing model configurations
      for (const key of ['designDecompose', 'designDefault', 'codeDecompose', 'codeError', 'codeFinal', 'codeSetup', 'codeDefault']) {
        if (!config.llmModels[key] && defaultLLMModel) {
          config.llmModels[key] = defaultLLMModel;
        }
      }
      
      return config;
    } catch (error) {
      // If config doesn't exist, return minimal default config
      console.warn('[ProjectCrudService] Config not found, returning defaults');
      return {
        repositoryName: this.sanitizeProjectName(id),
        branchBase: 'main',
        autoLearn: true,
        llmProvider: defaultLLMProvider,
        llmModels: {
          designDecompose: defaultLLMModel,
          designDefault: defaultLLMModel,
          codeDecompose: defaultLLMModel,
          codeError: defaultLLMModel,
          codeFinal: defaultLLMModel,
          codeSetup: defaultLLMModel,
          codeDefault: defaultLLMModel,
        }
      };
    }
  }
  
  /**
   * Update project configuration
   */
  async updateProjectConfig(projectId: string, config: any, userContext: UserContext): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    // Ensure project directory exists
    await fs.promises.mkdir(projectPath, { recursive: true });
    
    // Write config
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
}

