import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';
import { GitHubAuthService } from '../../auth/GitHubAuthService';
import simpleGit from 'simple-git';

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
  private readonly githubAuthService?: GitHubAuthService;
  
  constructor(workspaceResolver: WorkspaceResolver, githubAuthService?: GitHubAuthService) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
  }
  
  /**
   * 🛡️ CRITICAL SAFETY: Get Git instance only if .git exists in EXACT directory
   * 
   * Prevents simpleGit from traversing up to parent directories (e.g., ant source code).
   * Returns null if .git is not found in the specified path.
   * 
   * @param targetPath - The exact directory where .git should exist
   * @returns SimpleGit instance or null if not initialized
   */
  private getGitInstanceSafe(targetPath: string): ReturnType<typeof simpleGit> | null {
    const gitDir = path.join(targetPath, '.git');
    
    if (!fs.existsSync(gitDir)) {
      console.log(`[ProjectService] 🚫 .git not found at: ${targetPath}`);
      return null;
    }
    
    console.log(`[ProjectService] ✅ .git verified at: ${targetPath}`);
    return simpleGit(targetPath);
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
      // ✅ Only include localPath for local mode
      ...(isCloudMode ? {} : { localPath: `../${sanitizedName}` }),
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
      if (!config.llmModel && defaultLLMModel) {
        config.llmModel = defaultLLMModel;
      }
      
      return config;
    } catch (error) {
      // Return default config if file doesn't exist
      return {
        repoType: 'local',
        localPath: `../${id}`,
        llmProvider: defaultLLMProvider,
        llmModel: defaultLLMModel
      };
    }
  }
  
  /**
   * Update project configuration
   * 
   * ⚠️ Security: In Cloud mode, localPath should not be stored or modified
   */
  async updateProjectConfig(projectId: string, config: any, userContext: UserContext): Promise<void> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    // ✅ Cloud Mode: Remove localPath from config (should not be stored)
    const isCloudMode = userContext.userId !== 'local' && userContext.organizationId !== 'local';
    
    if (isCloudMode && config.repoType === 'cloud') {
      // ✅ CRITICAL: In Cloud mode, localPath should not be stored
      // Path is always calculated from WorkspaceResolver
      if (config.localPath) {
        console.warn(`[ProjectService] ⚠️  Removing localPath from Cloud mode config`);
        console.warn(`   localPath should not be stored in Cloud mode`);
        console.warn(`   Path is calculated from WorkspaceResolver: {projectPath}/codebase`);
        delete config.localPath;
      }
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
    await fs.promises.mkdir(path.join(featurePath, 'outputs/design'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'outputs/reports'), { recursive: true });
    await fs.promises.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
    
    // ✅ Create Git branch for feature (if Git is initialized)
    try {
      await this.switchToFeatureBranch(projectId, featureName, userContext);
    } catch (error: any) {
      // If Git not initialized, silently skip (not an error for feature creation)
      if (error.message?.includes('not initialized')) {
      } else {
        console.error(`[ProjectService] Failed to create branch for ${featureName}:`, error);
        // Don't throw - feature directories are created successfully
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
        // 폴더가 없으면 빈 배열 반환
        return [];
      }
      
      const tree: any[] = [];

      // ✅ 빈 폴더일 경우 빈 배열 반환 (children: []로 처리됨)
      // 자기 자신을 다시 반환하지 않음 (design/design 중복 버그 수정)
      if (items.length === 0) {
        return [];
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

  /**
   * Clone GitHub repository to project codebase directory
   * Automatically handles nested directory structures
   */
  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    // Get project config
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path based on repoType
    let codebasePath: string;
    if (config.repoType === 'local') {
      // For local mode, use localPath
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      // Resolve localPath (supports ~/, absolute, relative)
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      // For cloud mode, use projectPath/codebase
      codebasePath = path.join(projectPath, 'codebase');
    }

    // ✅ Check if already cloned
    const gitDir = path.join(codebasePath, '.git');
    if (fs.existsSync(gitDir)) {
      throw new Error('Repository already cloned. Delete .git directory to re-clone.');
    }

    // ✅ Check if features already exist (must be clean workspace)
    const featuresPath = path.join(projectPath, 'features');
    if (fs.existsSync(featuresPath)) {
      const features = fs.readdirSync(featuresPath).filter(f => !f.startsWith('.'));
      if (features.length > 0) {
        throw new Error('Cannot clone: Features already exist. Clone requires a clean workspace.');
      }
    }

    // ✅ Check if codebase directory has any files (must be clean)
    if (fs.existsSync(codebasePath)) {
      const files = fs.readdirSync(codebasePath).filter(f => !f.startsWith('.'));
      if (files.length > 0) {
        throw new Error('Cannot clone: Codebase directory is not empty. Clone requires a clean workspace.');
      }
    }

    // Build authenticated URL
    console.log(`[ProjectService] Converting UserContext for PAT lookup:`);
    console.log(`[ProjectService]   organizationId="${userContext.organizationId}" → org`);
    console.log(`[ProjectService]   userId="${userContext.userId}" → user`);
    
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );
    console.log(`[ProjectService] ✅ Authenticated URL built successfully`);

    // Create temp directory for cloning
    const tempPath = path.join(projectPath, '.temp-clone');
    
    // Ensure temp doesn't exist
    if (fs.existsSync(tempPath)) {
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    }

    // Clone to temp directory
    const git = simpleGit();
    await git.clone(authenticatedUrl, tempPath, ['--depth', '1']);
    console.log(`[ProjectService] ✅ Clone completed, analyzing structure...`);

    // Detect actual source root
    const sourceRoot = await this.detectSourceRoot(tempPath);
    console.log(`[ProjectService] Detected source root: ${sourceRoot || '(repo root)'}`);

    // Create parent directory if needed
    await fs.promises.mkdir(path.dirname(codebasePath), { recursive: true });

    // Move source to codebase path
    const sourcePath = sourceRoot ? path.join(tempPath, sourceRoot) : tempPath;
    
    if (sourceRoot) {
      // Flatten nested structure
      console.log(`[ProjectService] Flattening nested structure: ${sourceRoot}/`);
      
      // Move nested source directory to codebase
      await fs.promises.rename(sourcePath, codebasePath);
      
      // ✅ CRITICAL: Move .git from temp root to codebase
      const tempGitDir = path.join(tempPath, '.git');
      const codebaseGitDir = path.join(codebasePath, '.git');
      
      if (fs.existsSync(tempGitDir)) {
        await fs.promises.rename(tempGitDir, codebaseGitDir);
      } else {
        console.warn(`[ProjectService] ⚠️  .git not found in temp directory`);
      }
      
      // Clean up temp
      await fs.promises.rm(tempPath, { recursive: true, force: true });
    } else {
      // Move entire repo (includes .git)
      await fs.promises.rename(tempPath, codebasePath);
    }

    // ✅ Verify .git exists in final location
    const finalGitDir = path.join(codebasePath, '.git');
    if (fs.existsSync(finalGitDir)) {
      // ✅ Set upstream for default branch (main)
      try {
        const git = this.getGitInstanceSafe(codebasePath);
        if (!git) {
          console.warn('[ProjectService] Git not initialized, skipping upstream setup');
          return;
        }
        
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        const branchClean = currentBranch.trim();
        
        // Check if upstream is already set
        let hasUpstream = false;
        try {
          await git.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]);
          hasUpstream = true;
        } catch {
          hasUpstream = false;
        }
        
        if (!hasUpstream) {
          await git.branch(['--set-upstream-to', `origin/${branchClean}`, branchClean]);
          console.log(`[ProjectService] ✅ Set upstream for default branch: ${branchClean} -> origin/${branchClean}`);
        }
      } catch (err) {
        console.warn(`[ProjectService] Could not set upstream for default branch:`, err);
      }
    } else {
      console.error(`[ProjectService] ❌ WARNING: .git not found at ${finalGitDir}`);
      throw new Error('Clone completed but .git directory is missing. Please try again.');
    }
  }

  /**
   * Detect the actual source root directory in a cloned repo
   * Returns relative path to source root, or null if repo root is the source
   */
  private async detectSourceRoot(repoPath: string): Promise<string | null> {
    const entries = await fs.promises.readdir(repoPath, { withFileTypes: true });
    
    // Common source indicators (prioritized)
    const sourceIndicators = [
      'package.json',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'setup.py',
      'composer.json'
    ];
    
    // Check if source indicators exist at root
    const hasSourceAtRoot = sourceIndicators.some(indicator =>
      entries.some(e => e.name === indicator && e.isFile())
    );
    
    if (hasSourceAtRoot) {
      // Repo root is the source
      return null;
    }
    
    // Look for common wrapper directories
    const wrapperCandidates = ['src', 'codebase', 'code', 'source', 'app'];
    
    for (const candidate of wrapperCandidates) {
      const candidateEntry = entries.find(e => 
        e.name === candidate && e.isDirectory()
      );
      
      if (!candidateEntry) continue;
      
      const candidatePath = path.join(repoPath, candidate);
      const candidateEntries = await fs.promises.readdir(candidatePath, { withFileTypes: true });
      
      // Check if this directory has source indicators
      const hasSourceInCandidate = sourceIndicators.some(indicator =>
        candidateEntries.some(e => e.name === indicator && e.isFile())
      );
      
      if (hasSourceInCandidate) {
        // Found source in nested directory
        return candidate;
      }
      
      // Also check for common source directories
      const hasSourceDirs = candidateEntries.some(e =>
        e.isDirectory() && ['src', 'lib', 'app', 'components'].includes(e.name)
      );
      
      if (hasSourceDirs) {
        return candidate;
      }
    }
    
    // No wrapper detected, use repo root
    return null;
  }

  /**
   * Get Git status for project
   * Returns comprehensive Git state information
   */
  async getGitStatus(projectId: string, userContext: UserContext): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        return { hasGit: false, hasCodebase: false, hasFeatures: false };
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          return { hasGit: false, hasCodebase: false, hasFeatures: false };
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      const hasCodebase = fs.existsSync(codebasePath);
      const gitDir = path.join(codebasePath, '.git');
      const hasGit = fs.existsSync(gitDir);
      
      // Check if features exist
      const featuresPath = path.join(projectPath, 'features');
      const hasFeatures = fs.existsSync(featuresPath) && 
        fs.readdirSync(featuresPath).filter(f => !f.startsWith('.')).length > 0;

      let currentBranch: string | undefined;
      if (hasGit) {
        try {
          const git = this.getGitInstanceSafe(codebasePath);
          if (git) {
            currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
          }
        } catch (error) {
          console.warn('[ProjectService] Failed to get current branch:', error);
        }
      }


      return { hasGit, hasCodebase, hasFeatures, currentBranch };
    } catch (error) {
      console.error('[ProjectService] Error checking Git status:', error);
      return { hasGit: false, hasCodebase: false, hasFeatures: false };
    }
  }

  /**
   * Get Git changes with detailed file status and ahead/behind information
   */
  async getGitChanges(projectId: string, userContext: UserContext): Promise<{
    hasChanges: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    currentBranch?: string;
  }> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        throw new Error('Project config not found');
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          throw new Error('Local path not configured');
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      const gitDir = path.join(codebasePath, '.git');
      if (!fs.existsSync(gitDir)) {
        throw new Error('Git repository not initialized');
      }

      const git = simpleGit(codebasePath);
      
      // Get status
      const status = await git.status();
      
      // Get current branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      
      // Determine staged and unstaged files
      const staged: string[] = [
        ...status.staged,
        ...status.created.filter((f: string) => status.staged.includes(f))
      ];
      
      const unstaged: string[] = [
        ...status.modified.filter((f: string) => !status.staged.includes(f)),
        ...status.deleted.filter((f: string) => !status.staged.includes(f))
      ];
      
      const untracked: string[] = status.not_added || [];
      
      const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
      
      // Get ahead/behind info
      let ahead = status.ahead || 0;
      let behind = status.behind || 0;
      
      // ✅ More reliable upstream check using git rev-parse
      let hasUpstream = false;
      try {
        await git.revparse(['--abbrev-ref', `${currentBranch.trim()}@{upstream}`]);
        hasUpstream = true;
        console.log(`[ProjectService] ✅ Upstream detected: ahead=${ahead}, behind=${behind}`);
      } catch {
        hasUpstream = false;
        console.log(`[ProjectService] ⚠️  No upstream detected for ${currentBranch.trim()}`);
      }
      
      // ✅ If no upstream, reset ahead/behind to avoid showing unreliable data
      // The UI will show "No changes" instead of incorrect "Push N"
      // After upstream is configured (by fetch/pull/push), correct data will be shown
      if (!hasUpstream) {
        ahead = 0;
        behind = 0;
        console.log(`[ProjectService] No upstream - resetting ahead/behind to 0 (data unreliable)`);
      }


      return {
        hasChanges,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        currentBranch
      };
    } catch (error: any) {
      console.error('[ProjectService] getGitChanges error:', error);
      throw error;
    }
  }

  /**
   * Commit changes with auto-generated message
   */
  async commitChanges(projectId: string, userContext: UserContext, message?: string): Promise<{ success: boolean; commitHash?: string }> {
    try {
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        throw new Error('Project config not found');
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          throw new Error('Local path not configured');
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      const gitDir = path.join(codebasePath, '.git');
      if (!fs.existsSync(gitDir)) {
        throw new Error('Git repository not initialized');
      }

      const git = simpleGit(codebasePath);
      
      // Get changes
      const changes = await this.getGitChanges(projectId, userContext);
      
      if (!changes.hasChanges) {
        throw new Error('No changes to commit');
      }
      
      // Stage all changes if there are unstaged or untracked files
      if (changes.unstaged.length > 0 || changes.untracked.length > 0) {
        await git.add('.');
      }
      
      // Generate commit message if not provided
      let commitMessage = message;
      if (!commitMessage) {
        // Auto-generate message based on file types and counts
        const totalFiles = changes.staged.length + changes.unstaged.length + changes.untracked.length;
        const hasMultipleTypes = (changes.staged.length > 0 ? 1 : 0) + 
                                  (changes.unstaged.length > 0 ? 1 : 0) + 
                                  (changes.untracked.length > 0 ? 1 : 0) > 1;
        
        if (hasMultipleTypes || totalFiles > 5) {
          commitMessage = `Update ${totalFiles} file${totalFiles > 1 ? 's' : ''}`;
        } else {
          // List individual files for small changes
          const allFiles = [...changes.staged, ...changes.unstaged, ...changes.untracked];
          const fileNames = allFiles.map((f: string) => path.basename(f));
          commitMessage = `Update ${fileNames.join(', ')}`;
        }
      }
      
      // Commit
      const commitResult = await git.commit(commitMessage);
      
      
      return {
        success: true,
        commitHash: commitResult.commit
      };
    } catch (error: any) {
      console.error('[ProjectService] commitChanges error:', error);
      throw error;
    }
  }

  /**
   * Sync with remote (pull then push)
   */
  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{ success: boolean; pulledChanges?: boolean; pushedChanges?: boolean }> {
    try {
      // First, pull
      await this.pullFromGitHub(projectId, userContext);
      
      // Then, push
      await this.pushToGitHub(projectId, userContext);
      
      return {
        success: true,
        pulledChanges: true,
        pushedChanges: true
      };
    } catch (error: any) {
      console.error('[ProjectService] syncWithRemote error:', error);
      throw error;
    }
  }

  /**
   * Check if project has been cloned (has .git directory)
   */
  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    try {
      // Get project config
      const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
      const configPath = path.join(projectPath, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        console.log(`[ProjectService] checkCloneStatus: Config not found for ${projectId}`);
        return false;
      }

      const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      
      // Determine codebase path based on repoType
      let codebasePath: string;
      if (config.repoType === 'local') {
        if (!config.localPath) {
          console.log(`[ProjectService] checkCloneStatus: Local path not configured`);
          return false;
        }
        codebasePath = config.localPath.startsWith('~')
          ? config.localPath.replace('~', process.env.HOME || '')
          : path.isAbsolute(config.localPath)
          ? config.localPath
          : path.resolve(process.cwd(), config.localPath);
      } else {
        codebasePath = path.join(projectPath, 'codebase');
      }

      // Check if .git directory exists
      const gitDir = path.join(codebasePath, '.git');
      const exists = fs.existsSync(gitDir);
      
      
      return exists;
    } catch (error) {
      console.error('[ProjectService] Error checking clone status:', error);
      return false;
    }
  }

  /**
   * Generate .gitignore content based on project type
   */
  private async generateGitignoreContent(codebasePath: string): Promise<string> {
    // Check for package.json to determine project type
    const packageJsonPath = path.join(codebasePath, 'package.json');
    let projectType = 'generic';
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
        
        // Detect Next.js
        if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
          projectType = 'nextjs';
        }
        // Detect Vite
        else if (packageJson.dependencies?.vite || packageJson.devDependencies?.vite) {
          projectType = 'vite';
        }
        // Detect React (CRA or generic)
        else if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
          projectType = 'react';
        }
        // Generic Node.js
        else {
          projectType = 'nodejs';
        }
      } catch {
        projectType = 'generic';
      }
    }
    
    console.log(`[ProjectService] Detected project type: ${projectType}`);
    
    // Base .gitignore (always include these)
    let gitignoreContent = `# Dependencies
node_modules/
/.pnp
.pnp.js

# Testing
/coverage

# Production builds
/build
/dist

# Misc
.DS_Store
*.pem
*.log
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Editor directories
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.idea/
*.swp
*.swo
*~

`;
    
    // Add project-specific ignores
    switch (projectType) {
      case 'nextjs':
        gitignoreContent += `# Next.js
/.next/
/out/
next-env.d.ts

# Vercel
.vercel

`;
        break;
      
      case 'vite':
      case 'react':
        gitignoreContent += `# Vite / React
/dist
/dist-ssr
*.local

`;
        break;
      
      case 'nodejs':
        gitignoreContent += `# Node.js
*.tsbuildinfo

`;
        break;
    }
    
    return gitignoreContent;
  }

  /**
   * Initialize a new GitHub repository and push existing code
   */
  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    // Get project config
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path (same logic as clone)
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    // Check if already initialized
    const gitDir = path.join(codebasePath, '.git');
    if (fs.existsSync(gitDir)) {
      throw new Error('Repository already initialized. Delete .git directory to re-initialize.');
    }

    // Check if GitHub repo already exists
    const repoExists = await this.githubAuthService.checkRepoExists(userContext, config.githubRepo);
    if (repoExists) {
      throw new Error('Repository already exists on GitHub. Use Clone instead.');
    }

    // ⚠️ Check if features already exist (undefined case)
    const featuresPath = path.join(projectPath, 'features');
    if (fs.existsSync(featuresPath)) {
      const features = fs.readdirSync(featuresPath).filter(f => !f.startsWith('.'));
      if (features.length > 0) {
        throw new Error(
          `Cannot initialize: ${features.length} feature(s) already exist. ` +
          `Git initialization must be done before creating features. ` +
          `Please delete features and re-initialize, or clone the repository instead.`
        );
      }
    }

    // Ensure codebase directory exists before git init
    if (!fs.existsSync(codebasePath)) {
      await fs.promises.mkdir(codebasePath, { recursive: true });
    }

    // Check if codebase is empty (only create README if empty)
    const files = await fs.promises.readdir(codebasePath);
    const hasFiles = files.length > 0;

    if (!hasFiles) {
      // Create README.md only if codebase is empty
      const readmePath = path.join(codebasePath, 'README.md');
      const readmeContent = `# ${projectId}\n\nGenerated by ANT\n\n## Getting Started\n\nThis project was created using ANT CLI.\n`;
      await fs.promises.writeFile(readmePath, readmeContent, 'utf-8');
    }

    // Get base branch from config
    const baseBranch = config.branchBase || 'main';
    
    // Initialize local git repository (with base branch)
    const git = simpleGit(codebasePath);
    await git.init([`--initial-branch=${baseBranch}`]);
    
    // Verify .git was created in correct location
    const gitDirCreated = path.join(codebasePath, '.git');
    if (!fs.existsSync(gitDirCreated)) {
      throw new Error(`Git initialization failed: .git not found in ${codebasePath}`);
    }

    // ✅ Create .gitignore BEFORE staging files (critical!)
    const gitignorePath = path.join(codebasePath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      console.log(`[ProjectService] Creating .gitignore at ${gitignorePath}`);
      
      // Detect project type and create appropriate .gitignore
      const gitignoreContent = await this.generateGitignoreContent(codebasePath);
      await fs.promises.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      
      console.log(`[ProjectService] ✅ .gitignore created`);
    } else {
      console.log(`[ProjectService] .gitignore already exists, skipping creation`);
    }

    // ✅ Auto-commit and push to create base branch on GitHub
    try {
      // Stage all files (now with .gitignore in place!)
      await git.add('.');
      
      // Create initial commit
      const commitMessage = hasFiles 
        ? 'Initial commit with existing code'
        : 'Initial commit from ANT';
      await git.commit(commitMessage);
      
      console.log(`[ProjectService] ✅ Initial commit created: "${commitMessage}"`);
      
      // Build authenticated URL for push
      const credentialContext = {
        org: userContext.organizationId,
        user: userContext.userId
      };
      const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
        credentialContext,
        config.githubRepo
      );
      
      // Add remote
      await git.addRemote('origin', authenticatedUrl);
      
      // Create GitHub repo if it doesn't exist
      console.log(`[ProjectService] Creating GitHub repository...`);
      await this.githubAuthService.createRepo(userContext, config.githubRepo);
      console.log(`[ProjectService] ✅ GitHub repository created`);
      
      // Push to create base branch on remote
      await git.push(['-u', 'origin', baseBranch]);
      console.log(`[ProjectService] ✅ Pushed to origin/${baseBranch}`);
      
      // Set upstream
      await git.branch(['--set-upstream-to', `origin/${baseBranch}`, baseBranch]);
      console.log(`[ProjectService] ✅ Upstream configured: ${baseBranch} -> origin/${baseBranch}`);
      
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      // Handle various error cases
      if (errorMsg.includes('already exists') && errorMsg.includes('repository')) {
        // Repo already exists - this is fine, just push
        console.log(`[ProjectService] Repository already exists, attempting push...`);
        try {
          await git.push(['-u', 'origin', baseBranch]);
          console.log(`[ProjectService] ✅ Pushed to existing repository`);
        } catch (pushError: any) {
          throw new Error(`Failed to push to existing repository: ${pushError.message}`);
        }
      } else if (errorMsg.includes('authentication failed')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Failed to initialize and push: ${errorMsg}`);
      }
    }
  }

  /**
   * Push changes to GitHub
   */
  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    // Get project config
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    // ✅ CRITICAL: Safe Git instance (exact path check)
    const git = this.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Check if there are changes to push
    const status = await git.status();

    // Get current branch
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    // ✅ Check if branch has upstream
    let hasUpstream = false;
    try {
      await git.revparse(['--abbrev-ref', `${branch}@{upstream}`]);
      hasUpstream = true;
    } catch {
      // No upstream configured
      hasUpstream = false;
    }
    

    // ✅ Allow push if: (1) has changes, (2) ahead of remote, OR (3) no upstream (new branch)
    if (status.files.length === 0 && status.ahead === 0 && hasUpstream) {
      throw new Error('No changes to push');
    }

    // Stage and commit changes if there are uncommitted files
    if (status.files.length > 0) {
      await git.add('.');
      await git.commit('Auto-commit from ANT', { '--author': '"ANT CLI <ant@ant.dev>"' });
    }

    // ✅ Check if remote repo exists, create if it doesn't
    const repoExists = await this.githubAuthService.checkRepoExists(userContext, config.githubRepo);
    if (!repoExists) {
      // Create GitHub repository on first push
      await this.githubAuthService.createRepo(userContext, config.githubRepo, {
        description: `${projectId} - Generated by ANT`,
        private: true
      });
    }

    // Build authenticated URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    // Update remote URL (in case PAT changed)
    try {
      await git.removeRemote('origin');
    } catch {
      // Remote might not exist
    }
    await git.addRemote('origin', authenticatedUrl);


    // ✅ Push with upstream setup for new branches
    try {
      if (!hasUpstream) {
        // New branch - set upstream using -u flag
        await git.push(['-u', 'origin', branch]);
      } else {
        // Existing branch - normal push
        await git.push('origin', branch);
      }
    } catch (error: any) {
      // Parse git error for user-friendly message
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('rejected') || errorMsg.includes('non-fast-forward')) {
        throw new Error('Push rejected: Remote has changes. Please pull first.');
      } else if (errorMsg.includes('authentication failed') || errorMsg.includes('could not read Username')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Push failed: ${errorMsg}`);
      }
    }
  }

  /**
   * Pull changes from GitHub
   */
  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    // Get project config
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    // ✅ CRITICAL: Safe Git instance (exact path check)
    const git = this.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Check for uncommitted changes
    const status = await git.status();
    if (status.files.length > 0) {
      await git.stash(['push', '-m', 'ANT auto-stash before pull']);
    }

    // Build authenticated URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    // Update remote URL (in case PAT changed)
    try {
      await git.removeRemote('origin');
    } catch {
      // Remote might not exist
    }
    await git.addRemote('origin', authenticatedUrl);

    // Get current branch
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);

    // Pull with error handling
    try {
      const pullResult = await git.pull('origin', branch);
      
      // ✅ After pull, auto-setup upstream if not configured
      const branchClean = branch.trim();
      let hasUpstream = false;
      try {
        await git.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]);
        hasUpstream = true;
      } catch {
        hasUpstream = false;
      }
      
      if (!hasUpstream) {
        try {
          await git.branch(['--set-upstream-to', `origin/${branchClean}`, branchClean]);
          console.log(`[ProjectService] ✅ Auto-configured upstream after pull: ${branchClean} -> origin/${branchClean}`);
        } catch (err) {
          console.log(`[ProjectService] Could not auto-setup upstream after pull:`, err);
        }
      }
      
      // Check for conflicts (simple-git doesn't expose conflicts directly)
      // We'll rely on status check instead
      const statusAfterPull = await git.status();
      if (statusAfterPull.conflicted.length > 0) {
        // Conflicts detected
        const conflictFiles = statusAfterPull.conflicted.join(', ');
        throw new Error(`Merge conflicts detected in: ${conflictFiles}. Please resolve conflicts manually.`);
      }
      
      
      // Pop stash if we stashed earlier
      if (status.files.length > 0) {
        try {
          await git.stash(['pop']);
        } catch (stashError: any) {
          if (stashError.message.includes('CONFLICT')) {
            throw new Error('Stash conflicts detected. Please resolve conflicts manually.');
          }
          throw stashError;
        }
      }
    } catch (error: any) {
      // Parse git error for user-friendly message
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflicts')) {
        // Already formatted above
        throw error;
      } else if (errorMsg.includes('authentication failed') || errorMsg.includes('could not read Username')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else if (errorMsg.includes('no tracking information')) {
        throw new Error('No upstream branch configured. Push first to set upstream.');
      } else {
        throw new Error(`Pull failed: ${errorMsg}`);
      }
    }
  }

  /**
   * Switch to feature branch (create if not exists)
   * Called when feature is selected or created
   */
  async switchToFeatureBranch(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<string> {  // ✅ Return the actual branch name
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    // Determine codebase path
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    // ✅ CRITICAL: Verify Git is initialized in the EXACT codebase path
    // This prevents simpleGit from traversing up to parent directories (like ant source!)
    const git = this.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Get base branch from config
    const baseBranch = config.branchBase || 'main';
    
    // ✅ Special case: If featureName is 'main' or matches baseBranch, checkout base branch directly
    if (featureName === 'main' || featureName === baseBranch) {
      await git.checkout(baseBranch);
      
      // Set upstream for main if remote exists
      try {
        const remoteBranches = await git.branch(['-r']);
        if (remoteBranches.all.includes(`origin/${baseBranch}`)) {
          let hasUpstream = false;
          try {
            await git.revparse(['--abbrev-ref', `${baseBranch}@{upstream}`]);
            hasUpstream = true;
          } catch {
            hasUpstream = false;
          }
          
          if (!hasUpstream) {
            await git.branch(['--set-upstream-to', `origin/${baseBranch}`, baseBranch]);
            console.log(`[ProjectService] ✅ Set upstream: ${baseBranch} -> origin/${baseBranch}`);
          }
        }
      } catch (err) {
        console.log(`[ProjectService] Could not set upstream for ${baseBranch}:`, err);
      }
      
      return baseBranch;  // ✅ Return base branch name
    }
    
    // Sanitize feature name for branch (replace spaces with hyphens, lowercase)
    const branchName = `feature/${featureName.toLowerCase().replace(/\s+/g, '-')}`;


    // Check if branch exists locally
    const branches = await git.branchLocal();
    const branchExists = branches.all.includes(branchName);

    if (branchExists) {
      // Checkout existing branch
      await git.checkout(branchName);
      console.log(`[ProjectService] ✅ Checked out existing branch: ${branchName}`);
    } else {
      // Create new branch from base
      
      // Ensure we're on base branch first
      const localBranches = await git.branchLocal();
      const baseBranchExists = localBranches.all.includes(baseBranch);
      
      if (!baseBranchExists) {
        // ✅ Base branch doesn't exist locally - try to fetch from remote
        console.log(`[ProjectService] Base branch '${baseBranch}' not found locally, checking remote...`);
        
        try {
          // Fetch from remote
          await git.fetch(['origin', baseBranch]);
          
          // Check if remote branch exists
          const remoteBranches = await git.branch(['-r']);
          if (remoteBranches.all.includes(`origin/${baseBranch}`)) {
            // Create local branch tracking remote
            await git.checkout(['-b', baseBranch, `origin/${baseBranch}`]);
            console.log(`[ProjectService] ✅ Created local '${baseBranch}' from origin/${baseBranch}`);
          } else {
            throw new Error(`Base branch '${baseBranch}' not found on remote`);
          }
        } catch (fetchError) {
          throw new Error(
            `Base branch '${baseBranch}' not found locally or on remote. ` +
            `Please ensure the base branch exists before creating features. ` +
            `Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
          );
        }
      } else {
        // Base branch exists locally, check it out
        await git.checkout(baseBranch);
        console.log(`[ProjectService] ✅ Checked out base branch: ${baseBranch}`);
      }
      
      // Create feature branch from base
      await git.checkoutLocalBranch(branchName);
      console.log(`[ProjectService] ✅ Created new local branch: ${branchName}`);
    }

    // ✅ After checkout, handle upstream and remote branch
    try {
      // ✅ First, fetch to update remote branch info (to avoid stale cache)
      if (config.githubRepo && this.githubAuthService) {
        try {
          const credentialContext = {
            org: userContext.organizationId,
            user: userContext.userId
          };
          const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
            credentialContext,
            config.githubRepo
          );
          
          // Update remote URL
          try {
            const remotes = await git.getRemotes(true);
            const originExists = remotes.some(r => r.name === 'origin');
            
            if (originExists) {
              await git.remote(['set-url', 'origin', authenticatedUrl]);
            } else {
              await git.addRemote('origin', authenticatedUrl);
            }
          } catch (remoteError) {
            console.log(`[ProjectService] Could not update remote:`, remoteError);
          }
          
          // Fetch to update remote refs (with --prune to remove deleted branches)
          await git.fetch(['--prune']);
          console.log(`[ProjectService] ✅ Fetched latest remote refs (with prune)`);
        } catch (fetchError) {
          console.log(`[ProjectService] Could not fetch (non-critical):`, fetchError);
          // Continue even if fetch fails
        }
      }
      
      const remoteBranches = await git.branch(['-r']);
      const remoteBranchName = `origin/${branchName}`;
      const remoteExists = remoteBranches.all.includes(remoteBranchName);
      
      console.log(`[ProjectService] Remote branch check: ${remoteBranchName} exists=${remoteExists}`);
      
      if (remoteExists) {
        // Remote branch exists - ensure upstream is set
        const branchClean = branchName.trim();
        
        // Check if upstream is already set
        let hasUpstream = false;
        try {
          await git.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]);
          hasUpstream = true;
        } catch {
          hasUpstream = false;
        }
        
        if (!hasUpstream) {
          await git.branch(['--set-upstream-to', remoteBranchName, branchClean]);
          console.log(`[ProjectService] ✅ Set upstream: ${branchClean} -> ${remoteBranchName}`);
        } else {
          console.log(`[ProjectService] ✅ Upstream already set for ${branchClean}`);
        }
      } else if (config.githubRepo && this.githubAuthService) {
        // ✅ Remote branch doesn't exist and GitHub is configured → auto-push to create remote branch
        console.log(`[ProjectService] 🚀 Remote branch not found, pushing to create: ${branchName}`);
        
        try {
          // Build authenticated URL
          const credentialContext = {
            org: userContext.organizationId,
            user: userContext.userId
          };
          const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
            credentialContext,
            config.githubRepo
          );
          
          // Update remote URL to use authenticated URL
          try {
            const remotes = await git.getRemotes(true);
            const originExists = remotes.some(r => r.name === 'origin');
            
            if (originExists) {
              await git.remote(['set-url', 'origin', authenticatedUrl]);
            } else {
              await git.addRemote('origin', authenticatedUrl);
            }
          } catch (remoteError) {
            console.log(`[ProjectService] Could not update remote:`, remoteError);
          }
          
          // Push with upstream
          await git.push(['-u', 'origin', branchName]);
          console.log(`[ProjectService] ✅ Pushed ${branchName} to remote and set upstream`);
        } catch (pushError: any) {
          console.error(`[ProjectService] Failed to push new branch:`, pushError.message);
          // Don't throw - branch is created locally, user can push manually later
        }
      }
    } catch (err) {
      console.log(`[ProjectService] Could not set upstream:`, err);
    }
    
    return branchName;  // ✅ Return the feature branch name
  }

  /**
   * Fetch from GitHub (update remote refs)
   */
  async fetchFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    if (!this.githubAuthService) {
      throw new Error('GitHub integration not configured');
    }

    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    if (!config.githubRepo) {
      throw new Error('GitHub repository not configured in project config');
    }

    // Determine codebase path
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    // ✅ CRITICAL: Safe Git instance (exact path check)
    const git = this.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Build authenticated URL
    const credentialContext = {
      org: userContext.organizationId,
      user: userContext.userId
    };
    
    const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
      credentialContext,
      config.githubRepo
    );

    // ✅ Update remote URL safely - check if remote exists first
    try {
      const remotes = await git.getRemotes(true);
      const originExists = remotes.some(r => r.name === 'origin');
      
      if (originExists) {
        // Update existing remote URL (doesn't affect upstream)
        await git.remote(['set-url', 'origin', authenticatedUrl]);
      } else {
        // Add new remote
        await git.addRemote('origin', authenticatedUrl);
      }
    } catch (error: any) {
      console.error('[ProjectService] Failed to update remote:', error.message);
      throw new Error('Failed to update remote configuration');
    }

    // Fetch
    try {
      await git.fetch('origin');
      
      // ✅ After fetch, auto-setup upstream if not configured but remote branch exists
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      const currentBranchClean = currentBranch.trim();
      
      // Check if current branch has upstream
      let hasUpstream = false;
      try {
        await git.revparse(['--abbrev-ref', `${currentBranchClean}@{upstream}`]);
        hasUpstream = true;
      } catch {
        hasUpstream = false;
      }
      
      // If no upstream, check if remote branch exists with same name
      if (!hasUpstream) {
        try {
          const remoteBranches = await git.branch(['-r']);
          const remoteBranchName = `origin/${currentBranchClean}`;
          
          if (remoteBranches.all.includes(remoteBranchName)) {
            // Remote branch exists - set up tracking
            await git.branch(['--set-upstream-to', remoteBranchName, currentBranchClean]);
            console.log(`[ProjectService] ✅ Auto-configured upstream for ${currentBranchClean} -> ${remoteBranchName}`);
          }
        } catch (err) {
          // Ignore errors in auto-setup
          console.log(`[ProjectService] Could not auto-setup upstream:`, err);
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      if (errorMsg.includes('authentication failed') || errorMsg.includes('could not read Username')) {
        throw new Error('Authentication failed. Please check your GitHub PAT.');
      } else {
        throw new Error(`Fetch failed: ${errorMsg}`);
      }
    }
  }
}
