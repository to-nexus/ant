import { GitPort } from "../../../core/ports";
import { getGitInstance, createBranch, getChangedFiles, getFileFromHead, resolveLocalPath } from "./gitUtils";

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
    
    // For workspace paths, write directly from process.cwd()
    if (path.startsWith('workspace/')) {
      const full = p.join(process.cwd(), path);
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
    
    // For workspace paths, read directly from process.cwd()
    if (path.startsWith('workspace/')) {
      const full = p.join(process.cwd(), path);
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
    
    // For workspace paths, check directly from process.cwd()
    if (path.startsWith('workspace/')) {
      const full = p.join(process.cwd(), path);
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
    
    // For workspace paths, read directly from process.cwd()
    if (path.startsWith('workspace/')) {
      const full = p.join(process.cwd(), path);
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
    
    // For workspace paths, create directly from process.cwd()
    if (path.startsWith('workspace/')) {
      const full = p.join(process.cwd(), path);
      fs.mkdirSync(full, { recursive: true });
      return;
    }
    
    await this.ensure();
    const root = await this.getRepoRoot();
    const full = p.join(root, path);
    
    fs.mkdirSync(full, { recursive: true });
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

