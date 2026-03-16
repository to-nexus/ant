import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { OrgConfig, buildDefaultGitHubRepoUrl } from '../../../../../core/types/orgConfig';
import { logger } from '../../../../../utils/logger';
import { detectGitDefaultBranch } from '../../../../../core/utils/branchUtils';
import { GitHelper } from '../GitService/helper/GitHelper';
import { GitignoreGenerator } from '../GitService/remote/helpers/GitignoreGenerator';

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
    const envModel = process.env.AI_MODEL_NAME;
    const modelOpus = envModel || 'claude-opus-4-6';
    const modelSonnet = envModel || 'claude-sonnet-4-6';
    
    // ✅ Determine if Cloud Mode
    const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
    
    // ✅ Read effective GitHub owner: user override > org config
    const effectiveOwner = await this.resolveEffectiveGitHubOwner(userContext);
    const defaultGithubRepo = effectiveOwner
      ? buildDefaultGitHubRepoUrl({ github: { owner: effectiveOwner } }, sanitizedName)
      : undefined;
    
    logger.debug('Creating project config', { component: 'ProjectCrudService', organizationId: userContext.organizationId, userId: userContext.userId, projectId: id }, {
      isCloudMode,
      modelOpus,
      modelSonnet,
      defaultGithubRepo,
    });
    
    // ✅ Create config based on mode
    // branchBase is intentionally omitted — it will be auto-detected at clone/init time.
    // All runtime reads already fall back to 'main' when branchBase is absent.
    const config: Record<string, any> = {
      repositoryName: sanitizedName,
      repoType: isCloudMode ? 'cloud' : 'local',
      ...(isCloudMode ? {} : { localPath: `../${sanitizedName}` }),
      ...(defaultGithubRepo ? { githubRepo: defaultGithubRepo } : {}),
      llmModels: {
        design: {
          default: modelOpus,
        },
        code: {
          default: modelOpus,
        },
        learn: {
          default: modelSonnet,
        },
        plan: {
          default: modelSonnet,
        }
      }
    };

    // Auto-detect default branch from existing git repo at codebase path
    try {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, id);
      const detected = await detectGitDefaultBranch(codebasePath);
      if (detected) {
        config.branchBase = detected;
        logger.debug(`Auto-detected default branch: ${detected}`, { component: 'ProjectCrudService' });
      }
    } catch {
      // Codebase doesn't exist yet — branchBase stays absent
    }
    
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    // Initialize local git for managed codebases (cloud repos, not local-path repos).
    // This ensures branch tracking works in the IDE even before GitHub is connected.
    if (!config.localPath) {
      const codebasePath = this.workspaceResolver.getCodebasePath(userContext, id);
      await this.initializeLocalGit(codebasePath, config.branchBase || 'main', userContext);
    }
  }

  /**
   * Initialize a local git repository for a new managed codebase.
   * Non-fatal: errors are logged but do not fail project creation.
   */
  private async initializeLocalGit(codebasePath: string, baseBranch: string, userContext: UserContext): Promise<void> {
    try {
      await fs.promises.mkdir(codebasePath, { recursive: true });

      const git = simpleGit({ baseDir: codebasePath, binary: 'git', maxConcurrentProcesses: 6 });
      await git.init([`--initial-branch=${baseBranch}`]);

      await GitHelper.ensureSafeDirectory(codebasePath);
      await GitHelper.ensureUserConfig(git, userContext);

      // Create .gitignore
      const gitignorePath = path.join(codebasePath, '.gitignore');
      const gitignoreContent = await GitignoreGenerator.generate(codebasePath);
      await fs.promises.writeFile(gitignorePath, gitignoreContent, 'utf-8');

      // Create initial commit
      await git.add('.');
      const status = await git.status();
      if (status.files.length > 0) {
        await git.commit('Initial commit');
      } else {
        const gitkeepPath = path.join(codebasePath, '.gitkeep');
        await fs.promises.writeFile(gitkeepPath, '');
        await git.add('.gitkeep');
        await git.commit('Initial commit');
      }

      logger.info(`Local git initialized on branch '${baseBranch}'`, { component: 'ProjectCrudService' });
    } catch (error) {
      logger.warn('Failed to initialize local git (non-fatal)', { component: 'ProjectCrudService' }, { error });
    }
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
   * Rename a project (rename the project directory)
   */
  async renameProject(oldId: string, newId: string, userContext: UserContext): Promise<void> {
    if (oldId === newId) {
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(newId)) {
      throw new Error('Project ID can only contain letters, numbers, hyphens, and underscores');
    }

    const oldPath = this.workspaceResolver.getProjectPath(userContext, oldId);
    const newPath = this.workspaceResolver.getProjectPath(userContext, newId);

    try {
      await fs.promises.access(oldPath);
    } catch {
      throw new Error('Project not found');
    }

    try {
      await fs.promises.access(newPath);
      throw new Error('A project with the new name already exists');
    } catch (error: any) {
      if (error.message === 'A project with the new name already exists') {
        throw error;
      }
    }

    await fs.promises.rename(oldPath, newPath);

    logger.info(`Project renamed: ${oldId} → ${newId}`, {
      component: 'ProjectCrudService',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
    });
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
    
    // Get environment variable defaults for LLM (per-job)
    const envModel = process.env.AI_MODEL_NAME || process.env.MODEL_NAME;
    const fallbackOpus = envModel || 'claude-opus-4-6';
    const fallbackSonnet = envModel || 'claude-sonnet-4-6';
    
    try {
      const configData = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      
      // ✅ Apply environment variable defaults if not set in config
      if (!config.llmModels) {
        config.llmModels = {};
      }
      
      // ✅ Ensure job-level structure exists with defaults
      if (!config.llmModels.design) {
        config.llmModels.design = { default: fallbackOpus };
      } else if (!config.llmModels.design.default) {
        config.llmModels.design.default = fallbackOpus;
      }
      
      if (!config.llmModels.code) {
        config.llmModels.code = { default: fallbackOpus };
      } else if (!config.llmModels.code.default) {
        config.llmModels.code.default = fallbackOpus;
      }
      
      if (!config.llmModels.learn) {
        config.llmModels.learn = { default: fallbackSonnet };
      } else if (!config.llmModels.learn.default) {
        config.llmModels.learn.default = fallbackSonnet;
      }
      
      if (!config.llmModels.plan) {
        config.llmModels.plan = { default: fallbackSonnet };
      } else if (!config.llmModels.plan.default) {
        config.llmModels.plan.default = fallbackSonnet;
      }
      
      return config;
    } catch (error) {
      // If config doesn't exist, return minimal default config
      console.warn('[ProjectCrudService] Config not found, returning defaults');
      const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
      return {
        repositoryName: this.sanitizeProjectName(id),
        repoType: isCloudMode ? 'cloud' : 'local',
        llmModels: {
          design: {
            default: fallbackOpus,
          },
          code: {
            default: fallbackOpus,
          },
          learn: {
            default: fallbackSonnet,
          },
          plan: {
            default: fallbackSonnet,
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

