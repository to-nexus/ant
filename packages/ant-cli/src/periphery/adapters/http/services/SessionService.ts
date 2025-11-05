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
  
  // Session file watchers - key: "projectId/featureName"
  private sessionWatchers: Map<string, NodeJS.Timeout> = new Map();
  
  // Callback for session file changes
  private onSessionChange?: (projectId: string, featureName: string) => void;
  
  constructor(workspaceRoot: string, callbacks?: {
    onSessionChange?: (projectId: string, featureName: string) => void;
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
    sseClientChecker: () => boolean
  ): void {
    const key = `${projectId}/${featureName}`;
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      'outputs/session.json'
    );
    
    // Don't create duplicate watchers
    if (this.sessionWatchers.has(key)) {
      console.log(`[Session Watcher] Already watching ${key}`);
      return;
    }
    
    let lastModified = 0;
    let lastSize = 0;
    let fileExisted = false;
    
    console.log(`[Session Watcher] Started watching ${key}`);
    
    // Poll session file every 500ms
    const intervalId = setInterval(async () => {
      try {
        const stats = await fs.promises.stat(sessionPath);
        const mtime = stats.mtimeMs;
        const size = stats.size;
        
        // File exists now
        if (!fileExisted) {
          // File was created
          console.log(`[Session Watcher] File created for ${key}`);
          fileExisted = true;
          lastModified = mtime;
          lastSize = size;
          this.onSessionChange?.(projectId, featureName);
        } else if (mtime > lastModified || size !== lastSize) {
          // File was modified or size changed (emptied)
          lastModified = mtime;
          const sizeChanged = size !== lastSize;
          lastSize = size;
          
          if (sizeChanged && size === 0) {
            console.log(`[Session Watcher] File emptied for ${key}`);
          } else if (sizeChanged) {
            console.log(`[Session Watcher] File size changed for ${key} (${size} bytes)`);
          } else {
            console.log(`[Session Watcher] Detected update for ${key}`);
          }
          
          this.onSessionChange?.(projectId, featureName);
        }
      } catch (error: any) {
        // File doesn't exist
        if (error.code === 'ENOENT') {
          if (fileExisted) {
            // File was deleted!
            console.log(`[Session Watcher] File deleted for ${key}`);
            fileExisted = false;
            lastModified = 0;
            lastSize = 0;
            this.onSessionChange?.(projectId, featureName);
          }
        }
      }
      
      // Keep watching even if task is completed (for paused/resumed tasks)
      // Only stop if no SSE clients are connected
      if (!sseClientChecker()) {
        console.log(`[Session Watcher] No SSE clients for ${key}, stopping watcher`);
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
      console.log(`[Session Watcher] Stopped watching ${key}`);
    }
  }
  
  /**
   * Read session data from file
   */
  async readSessionData(projectId: string, featureName: string): Promise<any> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      'outputs/session.json'
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
  async sessionExists(projectId: string, featureName: string): Promise<boolean> {
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      'outputs/session.json'
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
      console.log(`[Session Watcher] Stopped watching ${key}`);
    }
    this.sessionWatchers.clear();
  }
}

