import { GitPort } from "../../../core/ports";
import { getGitInstance, createBranch, getChangedFiles, getFileFromHead, resolveLocalPath } from "./gitUtils";
import * as path from "path";

export class SimpleGitAdapter implements GitPort {
  private git: any;
  private project: string;
  private config: any;
  private projectPath: string;  // ✅ Store project path

  constructor(project: string, config: any, projectPath?: string) {
    this.project = project;
    this.config = config;
    // ✅ Require projectPath - no fallback
    // projectPath는 WorkspaceResolver에서 생성해야 함
    // 예시: new LocalWorkspaceResolver().getProjectPath(context, project)
    if (!projectPath) {
      throw new Error('projectPath is required for SimpleGitAdapter. Use WorkspaceResolver to generate paths.');
    }
    this.projectPath = projectPath;
  }

  private async ensure() {
    if (!this.git) {
      this.git = await getGitInstance(this.project, this.config);
    }
  }

  async getRepoRoot(): Promise<string> {
    await this.ensure();
    // For local repos, use resolved localPath
    if (this.config.repoType === "local") {
      return resolveLocalPath(this.config.localPath, this.project);
    }
    // For cloud repos, codebase is in projectPath/codebase
    if (this.config.repoType === "cloud") {
      return path.join(this.projectPath, 'codebase');
    }
    return (await this.git.revparse(["--show-toplevel"]))?.trim();
  }

  async createBranch(name: string, base: string): Promise<void> {
    await this.ensure();
    await createBranch(this.git, name, base);
  }

  async getChangedFiles(): Promise<string[]> {
    await this.ensure();
    return await getChangedFiles(this.git);
  }

  async hasChanges(): Promise<boolean> {
    await this.ensure();
    const changed = await getChangedFiles(this.git);
    return changed.length > 0;
  }

  async getHeadFile(path: string): Promise<string | null> {
    await this.ensure();
    return await getFileFromHead(this.git, path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, write to project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      // Extract everything after workspace/project/
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      
      fs.mkdirSync(p.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
      return;
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    fs.mkdirSync(p.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  async readFile(path: string): Promise<string | null> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, read from project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      
      try {
        return fs.readFileSync(full, "utf8");
      } catch {
        return null;
      }
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    try {
      return fs.readFileSync(full, "utf8");
    } catch {
      return null;
    }
  }

  async fileExists(path: string): Promise<boolean> {
    const fs = await import("fs");
    const p = await import("path");
    
    // ✅ If absolute path, check directly (for workspace/project/feature validation)
    if (p.isAbsolute(path)) {
      return fs.existsSync(path);
    }
    
    // For workspace paths, check in project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      const projectInPath = parts[0];
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      return fs.existsSync(full);
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    return fs.existsSync(full);
  }

  async deleteFile(path: string): Promise<void> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, delete from project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      
      // ✅ Check if file exists and is a file (not directory)
      if (!fs.existsSync(full)) {
        return; // File doesn't exist, nothing to do
      }
      
      const stats = fs.statSync(full);
      if (stats.isDirectory()) {
        throw new Error(`Cannot delete directory as file: ${path}`);
      }
      
      try {
        fs.unlinkSync(full);
      } catch (error: any) {
        // ✅ Re-throw with better error message
        throw new Error(`Failed to delete ${path}: ${error.message || 'Permission denied'}`);
      }
      return;
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    // ✅ Check if file exists and is a file (not directory)
    if (!fs.existsSync(full)) {
      return; // File doesn't exist, nothing to do
    }
    
    const stats = fs.statSync(full);
    if (stats.isDirectory()) {
      throw new Error(`Cannot delete directory as file: ${path}`);
    }
    
    try {
      fs.unlinkSync(full);
    } catch (error: any) {
      // ✅ Re-throw with better error message for permission/lock issues
      if (error.code === 'EPERM') {
        throw new Error(`Permission denied: ${path}`);
      } else if (error.code === 'EBUSY') {
        throw new Error(`File is in use: ${path}`);
      } else {
        throw new Error(`Failed to delete ${path}: ${error.message || 'Unknown error'}`);
      }
    }
  }

  async readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, read from project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      try {
        const entries = fs.readdirSync(full, { withFileTypes: true });
        return entries.map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory()
        }));
      } catch {
        return [];
      }
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    try {
      const entries = fs.readdirSync(full, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory()
      }));
    } catch {
      return [];
    }
  }

  async createDirectory(path: string): Promise<void> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, create in project path
    if (path.startsWith('workspace/')) {
      // workspace/project/feature/... -> feature/...
      const parts = path.split('/');
      parts.shift();  // Remove 'workspace'
      parts.shift();  // Remove project name
      const featureRelativePath = parts.join('/');
      
      const full = p.join(this.projectPath, featureRelativePath);
      fs.mkdirSync(full, { recursive: true });
      return;
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    fs.mkdirSync(full, { recursive: true });
  }

  /**
   * List all files in directory recursively
   */
  async listFiles(path: string, exclude: string[] = []): Promise<string[]> {
    const fs = await import("fs");
    const p = await import("path");
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const targetDir = p.join(root, path);
    
    const results: string[] = [];
    
    const walk = async (dir: string): Promise<void> => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = p.join(dir, entry.name);
          const relativePath = p.relative(root, fullPath);
          
          // Check if excluded
          const isExcluded = exclude.some(pattern => {
            if (pattern.includes('*')) {
              // Simple glob matching
              const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
              return regex.test(relativePath) || regex.test(entry.name);
            }
            return relativePath.includes(pattern) || entry.name === pattern;
          });
          
          if (isExcluded) continue;
          
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            results.push(relativePath);
          }
        }
      } catch (error) {
        // Skip directories that can't be read
      }
    };
    
    await walk(targetDir);
    return results;
  }

  // Legacy compatibility methods
  async diff(): Promise<string[]> {
    return await this.getChangedFiles();
  }

  async show(args: string[]): Promise<string> {
    await this.ensure();
    const result = await this.git.show(args);
    return result || "";
  }

  async status(): Promise<{ files: Array<{ path: string }> }> {
    const changed = await this.getChangedFiles();
    return {
      files: changed.map(path => ({ path }))
    };
  }
}

