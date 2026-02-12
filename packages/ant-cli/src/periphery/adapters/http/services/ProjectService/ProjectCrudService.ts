import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { OrgConfig, buildDefaultGitHubRepoUrl } from '../../../../../core/types/orgConfig';
import { logger } from '../../../../../utils/logger';

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
    
    // ✅ Read effective GitHub owner: user override > org config
    const effectiveOwner = await this.resolveEffectiveGitHubOwner(userContext);
    const defaultGithubRepo = effectiveOwner
      ? buildDefaultGitHubRepoUrl({ github: { owner: effectiveOwner } }, sanitizedName)
      : undefined;
    
    logger.debug('Creating project config', { component: 'ProjectCrudService', organizationId: userContext.organizationId, userId: userContext.userId, projectId: id }, {
      isCloudMode,
      defaultModel,
      defaultGithubRepo,
    });
    
    // ✅ Create config based on mode
    const config = {
      repositoryName: sanitizedName,  // ✅ Repository/codebase name
      repoType: isCloudMode ? 'cloud' : 'local',
      // ✅ Only include localPath for local mode
      ...(isCloudMode ? {} : { localPath: `../${sanitizedName}` }),
      // ✅ Auto-set githubRepo from org config (if GitHub owner is configured)
      ...(defaultGithubRepo ? { githubRepo: defaultGithubRepo } : {}),
      branchBase: 'main',
      autoLearn: true,
      llmModels: {
        design: {
          default: defaultModel,
        },
        code: {
          default: defaultModel,
        },
        learn: {
          default: defaultModel,
        }
      }
    };
    
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }
  
  /**
   * Resolve effective GitHub owner: user override > org config
   */
  private async resolveEffectiveGitHubOwner(userContext: UserContext): Promise<string | undefined> {
    const workspacesPath = this.workspaceResolver.getPhysicalWorkspacesPath();

    // 1. Check user-level override first
    try {
      const userConfigPath = path.join(workspacesPath, userContext.organizationId, userContext.userId, '.ant', 'user-config.json');
      const userData = await fs.promises.readFile(userConfigPath, 'utf-8');
      const userConfig = JSON.parse(userData);
      if (userConfig.github?.ownerOverride) {
        return userConfig.github.ownerOverride;
      }
    } catch {
      // No user config or parse error — fall through to org config
    }

    // 2. Fallback to org config
    try {
      const orgConfigPath = path.join(workspacesPath, userContext.organizationId, '.ant', 'org-config.json');
      const orgData = await fs.promises.readFile(orgConfigPath, 'utf-8');
      const orgConfig = JSON.parse(orgData) as OrgConfig;
      return orgConfig.github?.owner;
    } catch {
      return undefined;
    }
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
    const defaultLLMModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // ✅ Apply environment variable defaults if not set in config
      if (!config.llmModels) {
        config.llmModels = {};
      }
      
      // ✅ Ensure job-level structure exists with defaults
      if (!config.llmModels.design) {
        config.llmModels.design = { default: defaultLLMModel };
      } else if (!config.llmModels.design.default && defaultLLMModel) {
        config.llmModels.design.default = defaultLLMModel;
      }
      
      if (!config.llmModels.code) {
        config.llmModels.code = { default: defaultLLMModel };
      } else if (!config.llmModels.code.default && defaultLLMModel) {
        config.llmModels.code.default = defaultLLMModel;
      }
      
      if (!config.llmModels.learn) {
        config.llmModels.learn = { default: defaultLLMModel };
      } else if (!config.llmModels.learn.default && defaultLLMModel) {
        config.llmModels.learn.default = defaultLLMModel;
      }
      
      return config;
    } catch (error) {
      // If config doesn't exist, return minimal default config
      console.warn('[ProjectCrudService] Config not found, returning defaults');
      return {
        repositoryName: this.sanitizeProjectName(id),
        branchBase: 'main',
        autoLearn: true,
        llmModels: {
          design: {
            default: defaultLLMModel,
          },
          code: {
            default: defaultLLMModel,
          },
          learn: {
            default: defaultLLMModel,
          }
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

