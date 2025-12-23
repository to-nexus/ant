/**
 * GitAdapter
 * 
 * Pure Git operations adapter - NO file I/O operations.
 * Use FileSystemPort for file operations instead.
 * 
 * This adapter focuses solely on Git version control:
 * - Branch management
 * - Staging and commits
 * - Remote operations (clone, fetch, pull, push)
 * - Working tree status
 */

import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import { GitPort } from '../../../core/ports/git';

export class GitAdapter implements GitPort {
  private git: SimpleGit;
  private readonly codebasePath: string;
  
  /**
   * @param codebasePath - Absolute path to Git repository (codebase directory)
   */
  constructor(codebasePath: string) {
    this.codebasePath = path.resolve(codebasePath);
    
    // Initialize simpleGit instance
    this.git = simpleGit({
      baseDir: this.codebasePath,
      binary: 'git',
      maxConcurrentProcesses: 6
    });
  }
  
  async getRepoRoot(): Promise<string> {
    try {
      const root = await this.git.revparse(['--show-toplevel']);
      return root.trim();
    } catch {
      // Not a git repository - return codebase path
      return this.codebasePath;
    }
  }
  
  async getRepoName(): Promise<string> {
    try {
      const root = await this.getRepoRoot();
      return path.basename(root);
    } catch {
      return path.basename(this.codebasePath);
    }
  }
  
  async createBranch(name: string, base: string): Promise<void> {
    await this.git.checkoutBranch(name, base);
  }
  
  async getCurrentBranch(): Promise<string> {
    const result = await this.git.branch();
    return result.current;
  }
  
  async checkoutBranch(branch: string, options?: { create?: boolean }): Promise<void> {
    if (options?.create) {
      await this.git.checkoutLocalBranch(branch);
    } else {
      await this.git.checkout(branch);
    }
  }
  
  async getBranches(options?: { remote?: boolean }): Promise<string[]> {
    const result = await this.git.branch(options?.remote ? ['-r'] : []);
    return Object.keys(result.branches);
  }
  
  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map(r => r.to)
    ];
  }
  
  async hasChanges(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }
  
  async status(): Promise<{ files: Array<{ path: string }> }> {
    const status = await this.git.status();
    const files = [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map(r => r.to)
    ].map(path => ({ path }));
    
    return { files };
  }
  
  async getCurrentCommit(): Promise<string> {
    const result = await this.git.revparse(['HEAD']);
    return result.trim();
  }
  
  async getHeadFile(filePath: string): Promise<string | null> {
    try {
      const content = await this.git.show(['HEAD:' + filePath]);
      return content;
    } catch {
      return null;
    }
  }
  
  async diff(): Promise<string[]> {
    const result = await this.git.diff(['--name-only']);
    return result.split('\n').filter(Boolean);
  }
  
  async show(args: string[]): Promise<string> {
    return await this.git.show(args);
  }
  
  async stage(files: string[]): Promise<void> {
    await this.git.add(files);
  }
  
  async unstage(files: string[]): Promise<void> {
    await this.git.reset(['HEAD', '--', ...files]);
  }
  
  async commit(message: string, files?: string[]): Promise<void> {
    if (files && files.length > 0) {
      await this.git.add(files);
    }
    await this.git.commit(message);
  }
  
  async clone(url: string, targetPath: string, options?: { depth?: number }): Promise<void> {
    const args = ['--recursive'];
    
    if (options?.depth) {
      args.push('--depth', options.depth.toString());
    }
    
    await this.git.clone(url, targetPath, args);
  }
  
  async fetch(remote: string = 'origin'): Promise<void> {
    await this.git.fetch(remote);
  }
  
  async pull(remote: string = 'origin', branch?: string): Promise<void> {
    if (branch) {
      await this.git.pull(remote, branch);
    } else {
      await this.git.pull(remote);
    }
  }
  
  async push(
    remote: string = 'origin', 
    branch?: string, 
    options?: { setUpstream?: boolean; force?: boolean }
  ): Promise<void> {
    const args: string[] = [];
    
    if (options?.setUpstream) {
      args.push('--set-upstream');
    }
    
    if (options?.force) {
      args.push('--force');
    }
    
    if (branch) {
      await this.git.push(remote, branch, args);
    } else {
      await this.git.push(remote, undefined, args);
    }
  }
  
  async getRemotes(): Promise<Array<{ name: string; url: string }>> {
    const remotes = await this.git.getRemotes(true);
    return remotes.map(r => ({
      name: r.name,
      url: r.refs.fetch || r.refs.push
    }));
  }
  
  async addRemote(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url);
  }
  
  async removeRemote(name: string): Promise<void> {
    await this.git.removeRemote(name);
  }
  
  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.git.remote(['set-url', name, url]);
  }
}

