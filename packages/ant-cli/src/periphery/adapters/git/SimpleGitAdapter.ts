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
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved (feature outputs) → write directly
    // - Relative paths: Codebase files → join with repoRoot
    
    if (p.isAbsolute(path)) {
      // Absolute path already resolved by WorkspaceResolver
      fs.mkdirSync(p.dirname(path), { recursive: true });
      fs.writeFileSync(path, content, "utf8");
      return;
    }
    
    // Relative path: codebase file
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    fs.mkdirSync(p.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  async readFile(path: string): Promise<string | null> {
    const fs = await import("fs");
    const p = await import("path");
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved → read directly
    // - Relative paths: Codebase files → join with repoRoot
    
    if (p.isAbsolute(path)) {
      try {
        return fs.readFileSync(path, "utf8");
      } catch {
        return null;
      }
    }
    
    // Relative path: codebase file
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
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved → check directly
    // - Relative paths: Codebase files → join with repoRoot
    
    if (p.isAbsolute(path)) {
      return fs.existsSync(path);
    }
    
    // Relative path: codebase file
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    return fs.existsSync(full);
  }

  async deleteFile(path: string): Promise<void> {
    const fs = await import("fs");
    const p = await import("path");
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved → delete directly
    // - Relative paths: Codebase files → join with repoRoot
    
    let full: string;
    if (p.isAbsolute(path)) {
      full = path;
    } else {
      await this.ensure();
      const root = await this.getRepoRoot();
      full = p.join(root, path);
    }
    
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
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved → read directly
    // - Relative paths: Codebase dirs → join with repoRoot
    
    let full: string;
    if (p.isAbsolute(path)) {
      full = path;
    } else {
      await this.ensure();
      const root = await this.getRepoRoot();
      full = p.join(root, path);
    }
    
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
    
    // ✅ Strategy: Let WorkspaceResolver handle all path resolution
    // - Absolute paths: Already resolved → create directly
    // - Relative paths: Codebase dirs → join with repoRoot
    
    if (p.isAbsolute(path)) {
      fs.mkdirSync(path, { recursive: true });
      return;
    }
    
    // Relative path: codebase directory
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

