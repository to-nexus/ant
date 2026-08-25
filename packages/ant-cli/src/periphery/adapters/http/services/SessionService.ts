import * as fs from 'fs';
import { WorkspaceResolver, WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../core/types/user';
import { getSessionFilePathByJob, readSessionTextBounded, SessionTooLargeError, SESSION_MAX_BYTES } from '../../../../core/utils/sessionPaths';
import { toBaseRelative, readTextContainedBase, statContainedBase } from '../../../../core/config/containedIo';

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
    const sessionPath = getSessionFilePathByJob(featurePath, job);
    
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
    const sessionPath = getSessionFilePathByJob(featurePath, job);
    
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;
    
    // Bind the read to a base descent when in-base: a reparented feature root
    // must not return another tenant's session JSON to this HTTP/SSE response
    // (H-017). Out-of-base (repoType:local) keeps the raw read + retry.
    const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), sessionPath);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        let content: string;
        if (br) {
          // Bound per attempt on the read's own descriptor (M-NEW-029): the retry
          // loop must not multiply an unbounded read into heap pressure.
          const read = readTextContainedBase(br, { maxBytes: SESSION_MAX_BYTES });
          if (!read.ok) {
            if (read.reason === 'missing') return null;
            if (read.reason === 'too-large') throw new SessionTooLargeError(sessionPath, SESSION_MAX_BYTES, SESSION_MAX_BYTES);
            throw new Error(`session read failed: ${read.reason}`);
          }
          content = read.text;
        } else {
          const bounded = readSessionTextBounded(sessionPath);
          if (bounded === null) return null;
          content = bounded;
        }

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
    const sessionPath = getSessionFilePathByJob(featurePath, job);

    const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), sessionPath);
    if (br) return statContainedBase(br).ok;

    try {
      await fs.promises.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }
  
  // `resetJobState` was removed — session.state wipe without Redis/runs[]
  // coordination violated the SSOT invariant. See
  // `finalizeTerminalJob` / Hard Reset for the SSOT-safe replacements.

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

