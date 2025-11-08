import * as fs from 'fs';
import * as path from 'path';

/**
 * SessionService
 * 
 * Manages session file watching and broadcasts updates when session files change.
 * Provides session data reading and persistence.
 */
export class SessionService {
  private readonly workspaceRoot: string;
  
  // Session file watchers - key: "projectId/featureName/job"
  private sessionWatchers: Map<string, NodeJS.Timeout> = new Map();
  
  // Callback for session file changes - now includes job type
  private onSessionChange?: (projectId: string, featureName: string, jobType: 'design' | 'code' | 'learn') => void;
  
  constructor(workspaceRoot: string, callbacks?: {
    onSessionChange?: (projectId: string, featureName: string, jobType: 'design' | 'code' | 'learn') => void;
  }) {
    this.workspaceRoot = workspaceRoot;
    this.onSessionChange = callbacks?.onSessionChange;
  }
  
  /**
   * Watch session file for changes
   */
  watchSessionFile(
    projectId: string, 
    featureName: string,
    job: 'design' | 'code' | 'learn',
    sseClientChecker: () => boolean
  ): void {
    const key = `${projectId}/${featureName}/${job}`;  // ✅ Include job in key
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`  // ✅ Use job-specific path
    );
    
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
  stopWatchingSessionFile(projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const intervalId = this.sessionWatchers.get(key);
    if (intervalId) {
      clearInterval(intervalId);
      this.sessionWatchers.delete(key);
    }
  }
  
  /**
   * Read session data from file
   */
  async readSessionData(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code'): Promise<any> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`
    );
    
    try {
      if (fs.existsSync(sessionPath)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        return sessionData;
      }
      return null;
    } catch (error) {
      console.error(`[Session] Error reading session file:`, error);
      return null;
    }
  }
  
  /**
   * Check if session file exists
   */
  async sessionExists(projectId: string, featureName: string, job: 'design' | 'code' | 'learn' = 'code'): Promise<boolean> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${job}.json`
    );
    
    try {
      await fs.promises.access(sessionPath);
      return true;
    } catch {
      return false;
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

