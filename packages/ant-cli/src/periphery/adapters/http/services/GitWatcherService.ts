import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../core/types/user';
import { logger } from '../../../../utils/logger';
import { GitChangeBroadcaster } from '../../../../core/realtime/GitChangeBroadcaster';

/**
 * GitWatcherService
 * 
 * Watches .git/index file for changes to detect Git operations.
 * Supports both regular repos (.git directory) and worktrees (.git file with gitdir pointer).
 * Emits git change events through GitChangeBroadcaster (the single publish
 * path — FileTreeBroadcaster co-emits through the same class for non-index
 * working-tree mutations during jobs).
 */
export class GitWatcherService {
  private readonly workspaceResolver?: WorkspaceResolver;
  private readonly gitChangeBroadcaster?: GitChangeBroadcaster;

  private gitWatchers: Map<string, NodeJS.Timeout> = new Map();
  private deferredWatchers: Map<string, { projectId: string; featureName: string; userContext: UserContext }> = new Map();

  constructor(
    workspaceResolver?: WorkspaceResolver,
    gitChangeBroadcaster?: GitChangeBroadcaster
  ) {
    this.workspaceResolver = workspaceResolver;
    this.gitChangeBroadcaster = gitChangeBroadcaster;
  }
  
  private makeKey(userContext: UserContext, projectId: string, featureName: string): string {
    return `${userContext.organizationId}:${userContext.userId}:${projectId}/${featureName}`;
  }

  /**
   * Resolve the actual git index path, handling both regular repos and worktrees.
   * - Regular repo: .git is a directory -> .git/index
   * - Worktree: .git is a file containing "gitdir: <path>" -> <path>/index
   * - No .git: returns null
   */
  private resolveGitIndexPath(codebasePath: string): string | null {
    const gitPath = path.join(codebasePath, '.git');

    try {
      const stat = fs.statSync(gitPath);

      if (stat.isDirectory()) {
        return path.join(gitPath, 'index');
      }

      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, 'utf-8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (match) {
          const gitdir = path.isAbsolute(match[1]) ? match[1] : path.resolve(codebasePath, match[1]);
          return path.join(gitdir, 'index');
        }
      }
    } catch {
      // .git doesn't exist
    }

    return null;
  }

  /**
   * Watch .git/index for changes (detects any Git operation)
   */
  watchGitChanges(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): void {
    const key = this.makeKey(userContext, projectId, featureName);
    
    if (this.gitWatchers.has(key)) {
      return;
    }
    
    if (!this.workspaceResolver) {
      logger.warn('WorkspaceResolver not available', { component: 'GitWatcher', projectId, featureName });
      return;
    }
    
    const codebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
    const gitIndexPath = this.resolveGitIndexPath(codebasePath);
    
    if (!gitIndexPath || !fs.existsSync(gitIndexPath)) {
      logger.debug(`No Git repo found for ${key}, deferring`, { component: 'GitWatcher', projectId, featureName });
      this.deferredWatchers.set(key, { projectId, featureName, userContext });
      return;
    }

    this.deferredWatchers.delete(key);
    
    let lastModified = 0;
    
    const intervalId = setInterval(async () => {
      try {
        const stats = await fs.promises.stat(gitIndexPath);
        const mtime = stats.mtimeMs;
        
        if (lastModified === 0) {
          lastModified = mtime;
        } else if (mtime > lastModified) {
          lastModified = mtime;

          logger.debug(`Git changes detected for ${key}`, { component: 'GitWatcher', projectId, featureName });

          // Delegate all gitChange publishing to the broadcaster so the
          // transport (Redis Pub/Sub / StateStorePort) is decoupled from
          // this service. userContext is per-watcher, so we pass it
          // explicitly instead of relying on the broadcaster's default.
          await this.gitChangeBroadcaster?.notifyGitChange(
            projectId,
            featureName,
            userContext
          );
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.debug(`Git repo deleted for ${key}, stopping watcher`, { component: 'GitWatcher', projectId, featureName });
          clearInterval(intervalId);
          this.gitWatchers.delete(key);
        }
      }
    }, 1000);
    
    this.gitWatchers.set(key, intervalId);
    logger.debug(`Started watching Git changes for ${key}`, { component: 'GitWatcher', projectId, featureName });
  }
  
  /**
   * Retry all deferred watchers for a given project (called after init/clone completes)
   */
  retryDeferredWatchers(projectId: string): void {
    const toRetry: Array<{ key: string; info: { projectId: string; featureName: string; userContext: UserContext } }> = [];

    for (const [key, info] of this.deferredWatchers) {
      if (info.projectId === projectId) {
        toRetry.push({ key, info });
      }
    }

    if (toRetry.length === 0) return;

    logger.debug(`Retrying ${toRetry.length} deferred watchers for project ${projectId}`, { component: 'GitWatcher' });

    for (const { key, info } of toRetry) {
      this.deferredWatchers.delete(key);
      this.watchGitChanges(info.projectId, info.featureName, info.userContext);
    }
  }

  /**
   * Remove a deferred watcher entry (called when SSE connection closes)
   */
  removeDeferredWatcher(userContext: UserContext, projectId: string, featureName: string): void {
    const key = this.makeKey(userContext, projectId, featureName);
    this.deferredWatchers.delete(key);
  }

  /**
   * Stop watching Git changes
   */
  stopWatchingGitChanges(userContext: UserContext, projectId: string, featureName: string): void {
    const key = this.makeKey(userContext, projectId, featureName);
    const intervalId = this.gitWatchers.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.gitWatchers.delete(key);
      logger.debug(`Stopped watching ${key}`, { component: 'GitWatcher', projectId, featureName });
    }
    this.deferredWatchers.delete(key);
  }
  
  /**
   * Cleanup all watchers and deferred entries
   */
  cleanup(): void {
    for (const [, intervalId] of this.gitWatchers.entries()) {
      clearInterval(intervalId);
    }
    this.gitWatchers.clear();
    this.deferredWatchers.clear();
    logger.debug('Cleaned up all watchers', { component: 'GitWatcher' });
  }
}
