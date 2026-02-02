import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { logger } from '../../../../utils/logger';

const GIT_CHANGE_CHANNEL = 'sse:git-change';

/**
 * GitWatcherService
 * 
 * Watches .git/index file for changes to detect Git operations
 * Broadcasts git change events via Redis Pub/Sub for SSE delivery
 */
export class GitWatcherService {
  private readonly workspaceResolver?: WorkspaceResolver;
  private readonly stateStore?: StateStorePort;
  
  // Git watchers - key: "projectId/featureName"
  private gitWatchers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(
    workspaceResolver?: WorkspaceResolver,
    stateStore?: StateStorePort
  ) {
    this.workspaceResolver = workspaceResolver;
    this.stateStore = stateStore;
  }
  
  /**
   * Watch .git/index for changes (detects any Git operation)
   */
  watchGitChanges(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): void {
    const key = `${userContext.organizationId}:${userContext.userId}:${projectId}/${featureName}`;
    
    // Don't create duplicate watchers
    if (this.gitWatchers.has(key)) {
      return;
    }
    
    if (!this.workspaceResolver) {
      logger.warn('WorkspaceResolver not available', { component: 'GitWatcher', projectId, featureName, organizationId: userContext.organizationId, userId: userContext.userId });
      return;
    }
    
    // Get codebase path
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const codebasePath = path.join(featurePath, 'codebase');
    const gitIndexPath = path.join(codebasePath, '.git', 'index');
    
    // Check if Git repo exists
    if (!fs.existsSync(gitIndexPath)) {
      logger.debug(`No Git repo found for ${key}`, { component: 'GitWatcher', projectId, featureName });
      return;
    }
    
    let lastModified = 0;
    
    // Poll .git/index every 1 second (lightweight)
    const intervalId = setInterval(async () => {
      try {
        const stats = await fs.promises.stat(gitIndexPath);
        const mtime = stats.mtimeMs;
        
        if (lastModified === 0) {
          // First check - just record time
          lastModified = mtime;
        } else if (mtime > lastModified) {
          // Git index changed - something was staged/unstaged/committed
          lastModified = mtime;
          
          logger.debug(`Git changes detected for ${key}`, { component: 'GitWatcher', projectId, featureName });
          
          // Broadcast to frontend via Redis Pub/Sub
          if (this.stateStore) {
            await this.stateStore.publish(GIT_CHANGE_CHANNEL, {
              projectId,
              featureName,
              userContext,
              data: {
                timestamp: new Date().toISOString(),
                project: projectId,
                feature: featureName
              }
            });
          }
        }
      } catch (error: any) {
        // File doesn't exist anymore - repo deleted
        if (error.code === 'ENOENT') {
          logger.debug(`Git repo deleted for ${key}, stopping watcher`, { component: 'GitWatcher', projectId, featureName });
          clearInterval(intervalId);
          this.gitWatchers.delete(key);
        }
      }
    }, 1000); // Check every 1 second
    
    this.gitWatchers.set(key, intervalId);
    logger.debug(`Started watching Git changes for ${key}`, { component: 'GitWatcher', projectId, featureName });
  }
  
  /**
   * Stop watching Git changes
   */
  stopWatchingGitChanges(projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const intervalId = this.gitWatchers.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.gitWatchers.delete(key);
      logger.debug(`Stopped watching ${key}`, { component: 'GitWatcher', projectId, featureName });
    }
  }
  
  /**
   * Cleanup all watchers
   */
  cleanup(): void {
    for (const [key, intervalId] of this.gitWatchers.entries()) {
      clearInterval(intervalId);
    }
    this.gitWatchers.clear();
    logger.debug('Cleaned up all watchers', { component: 'GitWatcher' });
  }
}

