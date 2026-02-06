import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';

/**
 * SessionService
 * 
 * Manages session file watching and broadcasts updates when session files change.
 * Provides session data reading and persistence.
 */
export class SessionService {
  private readonly workspaceRoot: string;
  private readonly workspaceResolver?: WorkspaceResolver;
  
  // Session file watchers - key: "projectId/featureName/job"
  private sessionWatchers: Map<string, NodeJS.Timeout> = new Map();
  
  // Callback for session file changes - now includes job type
  private onSessionChange?: (projectId: string, featureName: string, jobType: 'design' | 'code' | 'learn') => void;
  
  constructor(workspaceRoot: string, callbacks?: {
    onSessionChange?: (projectId: string, featureName: string, jobType: 'design' | 'code' | 'learn') => void;
  }, workspaceResolver?: WorkspaceResolver) {
    this.workspaceRoot = workspaceRoot;
    this.onSessionChange = callbacks?.onSessionChange;
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Watch session file for changes
   */
  watchSessionFile(
    projectId: string, 
    featureName: string,
    job: 'design' | 'code' | 'learn',
    userContext: UserContext,
    sseClientChecker: () => boolean
  ): void {
    if (!this.workspaceResolver) {
      throw new Error('WorkspaceResolver is required');
    }
    // ✅ Multi-tenant safe key (org/user/project/feature/job)
    const key = `${userContext.organizationId}/${userContext.userId}/${projectId}/${featureName}/${job}`;
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = path.join(featurePath, `sessions/${job}.json`);
    
    // Don't create duplicate watchers
    if (this.sessionWatchers.has(key)) {
      return;
    }
    
    let lastModified = 0;
    let lastSize = 0;
    let fileExisted = false;
    
    
    // Poll session file every 500ms
    const intervalId = setInterval(async () => {
      try {
        const stats = await fs.promises.stat(sessionPath);
        const mtime = stats.mtimeMs;
        const size = stats.size;
        
        // File exists now
        if (!fileExisted) {
          // File was created
          fileExisted = true;
          lastModified = mtime;
          lastSize = size;
          this.onSessionChange?.(projectId, featureName, job);  // ✅ Pass job type
        } else if (mtime > lastModified || size !== lastSize) {
          // File was modified or size changed (emptied)
          lastModified = mtime;
          const sizeChanged = size !== lastSize;
          lastSize = size;
          
          if (sizeChanged && size === 0) {
          } else if (sizeChanged) {
          } else {
          }
          
          this.onSessionChange?.(projectId, featureName, job);  // ✅ Pass job type
        }
      } catch (error: any) {
        // File doesn't exist
        if (error.code === 'ENOENT') {
          if (fileExisted) {
            // File was deleted!
            fileExisted = false;
            lastModified = 0;
            lastSize = 0;
            this.onSessionChange?.(projectId, featureName, job);  // ✅ Pass job type
          }
        }
      }
      
      // Keep watching even if task is completed (for paused/resumed tasks)
      // Only stop if no SSE clients are connected
      if (!sseClientChecker()) {
        clearInterval(intervalId);
        this.sessionWatchers.delete(key);
      }
    }, 500);
    
    this.sessionWatchers.set(key, intervalId);
  }
  
  /**
   * Stop watching session file
   */
  stopWatchingSessionFile(projectId: string, featureName: string, job: 'design' | 'code' | 'learn', userContext: UserContext): void {
    const key = `${userContext.organizationId}/${userContext.userId}/${projectId}/${featureName}/${job}`;
    const intervalId = this.sessionWatchers.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.sessionWatchers.delete(key);
    }
  }
  
  /**
   * Read session data from file
   * 
   * ✅ Retry logic for EFS/NFS environments:
   * In cloud mode (EFS), a file written by a Job Worker child process on another pod
   * may not be immediately readable due to NFS cache or partial write propagation.
   * Retries with exponential backoff handle this race condition.
   */
  async readSessionData(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code', userContext?: UserContext): Promise<any> {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = path.join(featurePath, `sessions/${job}.json`);
    
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (!fs.existsSync(sessionPath)) {
          return null;
        }
        
        const content = fs.readFileSync(sessionPath, 'utf-8');
        
        // Empty or whitespace-only file: likely still being written (EFS propagation)
        if (!content || content.trim().length === 0) {
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            console.warn(`[Session] Empty session file, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          console.warn(`[Session] Session file still empty after ${MAX_RETRIES} retries: ${sessionPath}`);
          return null;
        }
        
        return JSON.parse(content);
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[Session] Error reading session file, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, 
            error instanceof SyntaxError ? error.message : error);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[Session] Failed to read session file after ${MAX_RETRIES + 1} attempts:`, error);
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * Check if session file exists
   */
  async sessionExists(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code', userContext?: UserContext): Promise<boolean> {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = path.join(featurePath, `sessions/${job}.json`);
    
    try {
      await fs.promises.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Reset job state (remove jobId, timing, and all task data from session)
   * Used when user explicitly wants to start fresh
   */
  async resetJobState(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code'): Promise<void> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`
    );
    
    try {
      // Read existing session
      if (!fs.existsSync(sessionPath)) {
        console.log(`[SessionService] No session to reset: ${sessionPath}`);
        return;
      }
      
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      
      // Remove ALL job-related data (jobId, timing, tasks)
      if (sessionData.state) {
        delete sessionData.state.jobId;
        delete sessionData.state.jobTiming;
        delete sessionData.state.taskQueue;
        delete sessionData.state.currentTask;
        delete sessionData.state.completedTasks;
        delete sessionData.state.completedTasksDetails;
        delete sessionData.state.interruption;
        delete sessionData.state.retries;
        delete sessionData.state.recursionCount;
        delete sessionData.state.recursionLimit;
        
        console.log(`[SessionService] Reset job state: ${sessionPath}`);
        console.log(`   Removed: jobId, jobTiming, taskQueue, currentTask, completedTasks, completedTasksDetails, interruption, retries, recursionCount, recursionLimit`);
        
        // Write back to file
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        
        // Trigger onChange callback if exists
        if (this.onSessionChange) {
          this.onSessionChange(projectId, featureName, job);
        }
      }
    } catch (error) {
      console.error(`[SessionService] Error resetting job state:`, error);
      throw error;
    }
  }
  
  /**
   * Cleanup all watchers
   */
  cleanup(): void {
    for (const [key, intervalId] of this.sessionWatchers.entries()) {
      clearInterval(intervalId);
    }
    this.sessionWatchers.clear();
  }
}

