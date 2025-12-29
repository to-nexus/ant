/**
 * SessionManager - Manages in-memory chat sessions
 * 
 * Handles session lifecycle and file watching
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ChatSession, ChatMessage } from './types';
import { BASE_BRANCH_NAMES } from './types';
import type { UserContext } from '../../../../../core/types/user';
import type { SessionPersistence } from './SessionPersistence';
import type { MessageBroadcaster } from './MessageBroadcaster';
import { logger } from '../../../../../utils/logger';

export class SessionManager {
  private sessions = new Map<string, ChatSession>();
  private fileWatchers = new Map<string, fs.FSWatcher>();

  constructor(
    private persistence: SessionPersistence,
    private broadcaster?: MessageBroadcaster
  ) {}

  /**
   * Get session key for a project/feature
   */
  getSessionKey(projectId: string, featureName: string): string {
    return `${projectId}/${featureName}`;
  }

  /**
   * Get or create a chat session
   */
  getOrCreateSession(
    projectId: string, 
    featureName: string, 
    jobId?: string, 
    userContext?: UserContext
  ): ChatSession {
    const key = this.getSessionKey(projectId, featureName);
    
    // Check memory cache first
    if (!this.sessions.has(key)) {
      // Load from file if exists
      const fileSession = this.persistence.loadSession(projectId, featureName, userContext);
      
      this.sessions.set(key, {
        projectId,
        featureName,
        jobId,
        messages: fileSession?.messages || [],
        userContext
      });
      
      if (fileSession) {
        logger.debug(`Loaded ${fileSession.messages.length} messages from file`, { component: 'SessionManager', projectId, featureName });
      }
      
      // Start watching the chat file for external changes
      this.startWatchingChatFile(projectId, featureName, userContext);
    }

    const session = this.sessions.get(key)!;
    
    // Update jobId if provided and changed
    if (jobId && session.jobId !== jobId) {
      session.jobId = jobId;
    }
    
    // Update userContext if provided (for existing sessions)
    if (userContext && !session.userContext) {
      session.userContext = userContext;
    }

    return session;
  }

  /**
   * Get session if exists (without creating)
   */
  getSession(projectId: string, featureName: string): ChatSession | undefined {
    const key = this.getSessionKey(projectId, featureName);
    return this.sessions.get(key);
  }

  /**
   * Check if session has an active (streaming) message
   */
  hasActiveMessage(projectId: string, featureName: string): boolean {
    const session = this.getSession(projectId, featureName);
    return session?.currentMessage !== undefined;
  }

  /**
   * Get all messages for a session (including streaming message)
   */
  getMessages(projectId: string, featureName: string): ChatMessage[] {
    const session = this.getSession(projectId, featureName);
    if (!session) {
      return [];
    }

    const messages = [...session.messages];
    
    // Include current streaming message if exists
    if (session.currentMessage) {
      messages.push({
        ...session.currentMessage,
        isStreaming: undefined // Remove streaming flag when sending
      });
    }

    return messages;
  }

  /**
   * Clear all messages in a session
   */
  clearMessages(projectId: string, featureName: string, userContext?: UserContext): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (session) {
      session.messages = [];
      session.currentMessage = undefined;
      
      // Delete file
      this.persistence.deleteSession(projectId, featureName, userContext);
      
      // Broadcast to frontend
      this.broadcaster?.broadcast(projectId, featureName, {
        type: 'messages_cleared'
      }, session.userContext);
    }
  }

  /**
   * Start watching chat file for external changes (e.g., manual deletion)
   */
  private startWatchingChatFile(projectId: string, featureName: string, userContext?: UserContext): void {
    // Base branches don't persist chat history; watching can fail because sessions dir won't be created.
    if (BASE_BRANCH_NAMES.includes(featureName.toLowerCase())) {
      return;
    }

    const key = this.getSessionKey(projectId, featureName);
    
    // Don't create duplicate watchers
    if (this.fileWatchers.has(key)) {
      return;
    }
    
    try {
      const filePath = this.persistence.getChatFilePath(projectId, featureName, userContext);
      const dirPath = path.dirname(filePath);

      // Ensure sessions directory exists before watching (fs.watch throws ENOENT otherwise)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Watch the sessions directory (file might not exist yet)
      const watcher = fs.watch(dirPath, { persistent: false }, (eventType, filename) => {
        if (filename === 'chat.json') {
          // Check if file was deleted
          if (!fs.existsSync(filePath)) {
            logger.info(`Detected external deletion of chat file`, { component: 'SessionManager', projectId, featureName });
            
            // Clear in-memory session
            const session = this.sessions.get(key);
            if (session) {
              session.messages = [];
              session.currentMessage = undefined;
            }
            
            // Broadcast to frontend
            this.broadcaster?.broadcast(projectId, featureName, {
              type: 'messages_cleared'
            }, session?.userContext);
          }
        }
      });
      
      this.fileWatchers.set(key, watcher);
      logger.debug(`Started watching chat file`, { component: 'SessionManager', projectId, featureName });
      
      // Clean up watcher on error
      watcher.on('error', (error) => {
        logger.warn(`File watcher error`, { component: 'SessionManager', projectId, featureName }, error);
        this.stopWatchingChatFile(projectId, featureName);
      });
    } catch (error) {
      logger.warn(`Failed to start watching chat file`, { component: 'SessionManager', projectId, featureName }, error);
    }
  }

  /**
   * Stop watching chat file
   */
  private stopWatchingChatFile(projectId: string, featureName: string): void {
    const key = this.getSessionKey(projectId, featureName);
    const watcher = this.fileWatchers.get(key);
    
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(key);
      logger.debug(`Stopped watching chat file`, { component: 'SessionManager', projectId, featureName });
    }
  }

  /**
   * Cleanup method - stop all watchers (call on server shutdown)
   */
  cleanup(): void {
    logger.info(`Cleaning up ${this.fileWatchers.size} file watchers...`, { component: 'SessionManager' });
    
    for (const [key, watcher] of this.fileWatchers.entries()) {
      try {
        watcher.close();
        logger.debug(`Closed watcher: ${key}`, { component: 'SessionManager' });
      } catch (error) {
        logger.warn(`Error closing watcher for ${key}`, { component: 'SessionManager' }, error);
      }
    }
    
    this.fileWatchers.clear();
    logger.info(`Cleanup complete`, { component: 'SessionManager' });
  }
}




