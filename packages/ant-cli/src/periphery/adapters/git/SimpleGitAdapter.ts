import { GitPort } from "../../../core/ports";
import { getGitInstance, createBranch, getChangedFiles, getFileFromHead, resolveLocalPath } from "./gitUtils";
import * as path from "path";

// Workspace is at project root (../../workspace from packages/ant-cli)
const WORKSPACE_ROOT = path.join(process.cwd(), "../../workspace");

export class SimpleGitAdapter implements GitPort {
  private git: any;
  private project: string;
  private config: any;

  constructor(project: string, config: any) {
    this.project = project;
    this.config = config;
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
    
    // For workspace paths, write to workspace root
    if (path.startsWith('workspace/')) {
      const relativePath = path.substring('workspace/'.length);
      const full = p.join(WORKSPACE_ROOT, relativePath);
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
    
    // For workspace paths, read from workspace root
    if (path.startsWith('workspace/')) {
      const relativePath = path.substring('workspace/'.length);
      const full = p.join(WORKSPACE_ROOT, relativePath);
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
    
    // For workspace paths, check in workspace root
    if (path.startsWith('workspace/')) {
      const relativePath = path.substring('workspace/'.length);
      const full = p.join(WORKSPACE_ROOT, relativePath);
      return fs.existsSync(full);
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    return fs.existsSync(full);
  }

  async readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const fs = await import("fs");
    const p = await import("path");
    
    // For workspace paths, read from workspace root
    if (path.startsWith('workspace/')) {
      const relativePath = path.substring('workspace/'.length);
      const full = p.join(WORKSPACE_ROOT, relativePath);
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
    
    // For workspace paths, create in workspace root
    if (path.startsWith('workspace/')) {
      const relativePath = path.substring('workspace/'.length);
      const full = p.join(WORKSPACE_ROOT, relativePath);
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

