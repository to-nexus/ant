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
    
    // Create basic project structure
    const configPath = path.join(projectPath, 'config.json');
    const defaultConfig = {
      name: id,
      createdAt: new Date().toISOString(),
      description: `Project ${id}`,
      features: []
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
    return JSON.parse(configData);
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
  async getSession(projectId: string, featureName: string = 'skeleton'): Promise<any> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      'outputs/session.json'
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

