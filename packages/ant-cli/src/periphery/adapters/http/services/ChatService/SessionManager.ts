/**
 * SessionManager - Manages chat sessions with Redis backing
 * 
 * CLOUD MODE: Sessions are stored in Redis for Pod-to-Pod consistency.
 * File persistence is used for backup/recovery only.
 * 
 * Session Key Format: "org:user:projectId/featureName"
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ChatSession, ChatMessage } from './types';
import { isBaseBranch, readBranchBaseFromConfig } from '../../../../../core/utils/branchUtils';
import type { UserContext } from '../../../../../core/types/user';
import type { SessionPersistence } from './SessionPersistence';
import type { MessageBroadcaster } from './MessageBroadcaster';
import type { StateStorePort, ChatSessionData, ChatMessageData } from '../../../../../core/ports/stateStore';
import { logger } from '../../../../../utils/logger';

export class SessionManager {
  // ============================================
  // Static: Redis Data Converters
  // ============================================

  /**
   * Convert internal ChatSession to Redis ChatSessionData
   */
  private static toRedisSession(session: ChatSession): ChatSessionData {
    return {
      projectId: session.projectId,
      featureName: session.featureName,
      jobId: session.jobId,
      messages: session.messages.map(m => ({
        id: m.id,
        role: m.role,
        contents: m.contents,
        timestamp: m.timestamp,
        jobId: m.jobId,
        isStreaming: m.isStreaming
      })),
      userContext: session.userContext,
      thinkingStartTime: session.thinkingStartTime,
      lastThinkingContentIndex: session.lastThinkingContentIndex,
      activeFileOperations: session.activeFileOperations 
        ? Array.from(session.activeFileOperations.values())
        : undefined
    };
  }

  /**
   * Convert Redis ChatSessionData to internal ChatSession
   */
  private static fromRedisSession(data: ChatSessionData): ChatSession {
    const session: ChatSession = {
      projectId: data.projectId,
      featureName: data.featureName,
      jobId: data.jobId,
      messages: data.messages as ChatMessage[],
      userContext: data.userContext,
      thinkingStartTime: data.thinkingStartTime,
      lastThinkingContentIndex: data.lastThinkingContentIndex
    };
    
    if (data.activeFileOperations) {
      session.activeFileOperations = new Map(
        data.activeFileOperations.map(op => [op.filePath, op])
      );
    }
    
    return session;
  }

  /**
   * Convert internal ChatMessage to Redis ChatMessageData
   */
  private static toRedisMessage(message: ChatMessage): ChatMessageData {
    return {
      id: message.id,
      role: message.role,
      contents: message.contents,
      timestamp: message.timestamp,
      jobId: message.jobId,
      isStreaming: message.isStreaming
    };
  }

  /**
   * Convert Redis ChatMessageData to internal ChatMessage
   */
  private static fromRedisMessage(data: ChatMessageData): ChatMessage {
    return data as ChatMessage;
  }

  // ============================================
  // Instance Properties
  // ============================================
  // Local memory cache for hot path optimization
  // Redis is the source of truth; this is just for performance
  private localCache = new Map<string, { session: ChatSession; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds cache TTL
  
  private fileWatchers = new Map<string, fs.FSWatcher>();

  constructor(
    private persistence: SessionPersistence,
    private broadcaster?: MessageBroadcaster,
    private stateStore?: StateStorePort
  ) {}

  /**
   * Get session key for a project/feature (includes user context for Cloud mode)
   */
  getSessionKey(projectId: string, featureName: string, userContext?: UserContext): string {
    // Include org:user in key for tenant isolation in Cloud mode
    if (userContext?.organizationId && userContext?.userId) {
      return `${userContext.organizationId}:${userContext.userId}:${projectId}/${featureName}`;
    }
    return `local:local:${projectId}/${featureName}`;
  }

  /**
   * Simple key (internal use only)
   */
  private getSimpleKey(projectId: string, featureName: string): string {
    return `${projectId}/${featureName}`;
  }

  /**
   * Check if local cache is valid
   */
  private isCacheValid(key: string): boolean {
    const cached = this.localCache.get(key);
    if (!cached) return false;
    return Date.now() - cached.cachedAt < this.CACHE_TTL_MS;
  }

  /**
   * Get or create a chat session
   * Priority: 1. Redis, 2. Local Cache, 3. File, 4. New Session
   */
  async getOrCreateSessionAsync(
    projectId: string, 
    featureName: string, 
    jobId?: string, 
    userContext?: UserContext
  ): Promise<ChatSession> {
    const redisKey = this.getSessionKey(projectId, featureName, userContext);
    const simpleKey = this.getSimpleKey(projectId, featureName);

    // 1. Check local cache FIRST for in-progress streaming state preservation
    // This is critical because currentMessage with streaming contents is updated locally
    // and saved to Redis asynchronously. Local cache has the most up-to-date state.
    if (this.isCacheValid(simpleKey)) {
      const cached = this.localCache.get(simpleKey)!;
      if (jobId && cached.session.jobId !== jobId) {
        cached.session.jobId = jobId;
      }
      logger.debug(`Using local cache for ${projectId}/${featureName} (hasCurrentMessage=${!!cached.session.currentMessage}, contents=${cached.session.currentMessage?.contents.length || 0})`, { 
        component: 'SessionManager'
      });
      return cached.session;
    }

    // 2. Try Redis (source of truth in Cloud mode)
    if (this.stateStore) {
      try {
        const redisSession = await this.stateStore.getChatSession(redisKey);
        
        if (redisSession) {
          const session = SessionManager.fromRedisSession(redisSession);
          
          // CRITICAL: Also restore currentMessage from Redis
          // This ensures cross-Pod consistency when local cache is cold
          const currentMessage = await this.stateStore.getCurrentMessage(redisKey);
          if (currentMessage) {
            session.currentMessage = SessionManager.fromRedisMessage(currentMessage);
            logger.debug(`Restored currentMessage from Redis for ${projectId}/${featureName} (${session.currentMessage.contents.length} contents)`, { 
              component: 'SessionManager'
            });
          }
          
          // Update jobId if provided
          if (jobId && session.jobId !== jobId) {
            session.jobId = jobId;
            await this.saveSessionAsync(projectId, featureName, session, userContext);
          }
          
          // Update local cache
          this.localCache.set(simpleKey, { session, cachedAt: Date.now() });
          
          logger.debug(`Loaded session from Redis: ${projectId}/${featureName} (${session.messages.length} messages)`, { 
            component: 'SessionManager'
          });
          
          return session;
        }
      } catch (error) {
        logger.warn(`Failed to load session from Redis, falling back to file`, { 
          component: 'SessionManager',
          projectId, 
          featureName 
        }, error);
      }
    }

    // 3. Check local cache (fallback if Redis unavailable)
    if (this.isCacheValid(simpleKey)) {
      const cached = this.localCache.get(simpleKey)!;
      if (jobId && cached.session.jobId !== jobId) {
        cached.session.jobId = jobId;
      }
      return cached.session;
    }

    // 3. Try file persistence
    const fileSession = this.persistence.loadSession(projectId, featureName, userContext);
    
    const session: ChatSession = {
      projectId,
      featureName,
      jobId,
      messages: fileSession?.messages || [],
      userContext
    };
    
    if (fileSession) {
      logger.debug(`Loaded ${fileSession.messages.length} messages from file`, { 
        component: 'SessionManager', 
        projectId, 
        featureName 
      });
    }

    // Save to Redis for future Pod consistency
    await this.saveSessionAsync(projectId, featureName, session, userContext);
    
    // Update local cache
    this.localCache.set(simpleKey, { session, cachedAt: Date.now() });
    
    // Start watching the chat file for external changes
    this.startWatchingChatFile(projectId, featureName, userContext);

    return session;
  }

  /**
   * Get or create a chat session (sync version)
   * Uses local cache first, then triggers async Redis load
   */
  getOrCreateSession(
    projectId: string, 
    featureName: string, 
    jobId?: string, 
    userContext?: UserContext
  ): ChatSession {
    const simpleKey = this.getSimpleKey(projectId, featureName);
    
    // Check local cache first (sync)
    if (this.isCacheValid(simpleKey)) {
      const cached = this.localCache.get(simpleKey)!;
      if (jobId && cached.session.jobId !== jobId) {
        cached.session.jobId = jobId;
      }
      return cached.session;
    }

    // Create new session with file data if available
    const fileSession = this.persistence.loadSession(projectId, featureName, userContext);
    
    const session: ChatSession = {
      projectId,
      featureName,
      jobId,
      messages: fileSession?.messages || [],
      userContext
    };
    
    if (fileSession) {
      logger.debug(`Loaded ${fileSession.messages.length} messages from file`, { 
        component: 'SessionManager', 
        projectId, 
        featureName 
      });
    }

    // Cache locally
    this.localCache.set(simpleKey, { session, cachedAt: Date.now() });
    
    // Async: Save to Redis (don't await)
    this.saveSessionAsync(projectId, featureName, session, userContext).catch(err => {
      logger.warn(`Failed to save session to Redis`, { component: 'SessionManager' }, err);
    });
    
    // Start watching the chat file for external changes
    this.startWatchingChatFile(projectId, featureName, userContext);

    return session;
  }

  /**
   * Get session if exists (without creating)
   */
  getSession(projectId: string, featureName: string): ChatSession | undefined {
    const simpleKey = this.getSimpleKey(projectId, featureName);
    const cached = this.localCache.get(simpleKey);
    return cached?.session;
  }

  /**
   * Save session to Redis and file
   */
  async saveSessionAsync(
    projectId: string, 
    featureName: string, 
    session: ChatSession,
    userContext?: UserContext
  ): Promise<void> {
    const redisKey = this.getSessionKey(projectId, featureName, userContext || session.userContext);
    const simpleKey = this.getSimpleKey(projectId, featureName);
    
    // Update local cache
    this.localCache.set(simpleKey, { session, cachedAt: Date.now() });
    
    // Save to Redis
    if (this.stateStore) {
      try {
        await this.stateStore.setChatSession(redisKey, SessionManager.toRedisSession(session));
      } catch (error) {
        logger.warn(`Failed to save session to Redis`, { 
          component: 'SessionManager',
          projectId, 
          featureName 
        }, error);
      }
    }
    
    // Also save to file (backup)
    this.persistence.saveSession(
      projectId, 
      featureName, 
      session.messages, 
      userContext || session.userContext
    );
  }

  /**
   * Check if session has an active (streaming) message
   * Uses Redis for cross-Pod consistency
   */
  async hasActiveMessageAsync(projectId: string, featureName: string, userContext?: UserContext): Promise<boolean> {
    if (this.stateStore) {
      const redisKey = this.getSessionKey(projectId, featureName, userContext);
      try {
        return await this.stateStore.hasActiveMessage(redisKey);
      } catch (error) {
        logger.warn(`Failed to check active message in Redis`, { 
          component: 'SessionManager' 
        }, error);
      }
    }
    
    // Fallback to local check
    const session = this.getSession(projectId, featureName);
    return session?.currentMessage !== undefined;
  }

  /**
   * Check if session has an active (streaming) message (sync version)
   */
  hasActiveMessage(projectId: string, featureName: string): boolean {
    const session = this.getSession(projectId, featureName);
    return session?.currentMessage !== undefined;
  }

  /**
   * Get current streaming message from Redis
   */
  async getCurrentMessageAsync(
    projectId: string, 
    featureName: string, 
    userContext?: UserContext
  ): Promise<ChatMessage | null> {
    if (this.stateStore) {
      const redisKey = this.getSessionKey(projectId, featureName, userContext);
      try {
        const message = await this.stateStore.getCurrentMessage(redisKey);
        return message ? SessionManager.fromRedisMessage(message) : null;
      } catch (error) {
        logger.warn(`Failed to get current message from Redis`, { 
          component: 'SessionManager' 
        }, error);
      }
    }
    
    // Fallback to local
    const session = this.getSession(projectId, featureName);
    return session?.currentMessage || null;
  }

  /**
   * Set current streaming message in Redis
   */
  async setCurrentMessageAsync(
    projectId: string, 
    featureName: string, 
    message: ChatMessage | null,
    userContext?: UserContext
  ): Promise<void> {
    const simpleKey = this.getSimpleKey(projectId, featureName);
    
    // Update local cache
    const cached = this.localCache.get(simpleKey);
    if (cached) {
      cached.session.currentMessage = message || undefined;
    }
    
    // Save to Redis
    if (this.stateStore) {
      const redisKey = this.getSessionKey(projectId, featureName, userContext);
      try {
        await this.stateStore.setCurrentMessage(
          redisKey, 
          message ? SessionManager.toRedisMessage(message) : null
        );
      } catch (error) {
        logger.warn(`Failed to set current message in Redis`, { 
          component: 'SessionManager' 
        }, error);
      }
    }
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
  async clearMessagesAsync(
    projectId: string, 
    featureName: string, 
    userContext?: UserContext
  ): Promise<void> {
    const redisKey = this.getSessionKey(projectId, featureName, userContext);
    const simpleKey = this.getSimpleKey(projectId, featureName);
    
    // Clear local cache
    const cached = this.localCache.get(simpleKey);
    if (cached) {
      cached.session.messages = [];
      cached.session.currentMessage = undefined;
    }
    
    // Clear Redis
    if (this.stateStore) {
      try {
        await this.stateStore.deleteChatSession(redisKey);
      } catch (error) {
        logger.warn(`Failed to clear session in Redis`, { 
          component: 'SessionManager' 
        }, error);
      }
    }
    
    // Delete file
    this.persistence.deleteSession(projectId, featureName, userContext);
    
    // Broadcast to frontend
    this.broadcaster?.broadcast(projectId, featureName, {
      type: 'messages_cleared'
    }, userContext);
  }

  /**
   * Clear all messages in a session (sync version)
   */
  clearMessages(projectId: string, featureName: string, userContext?: UserContext): void {
    // Start async clear
    this.clearMessagesAsync(projectId, featureName, userContext).catch(err => {
      logger.warn(`Failed to clear messages`, { component: 'SessionManager' }, err);
    });
  }

  /**
   * Invalidate local cache for a session (call when session is modified by another Pod)
   */
  invalidateCache(projectId: string, featureName: string): void {
    const simpleKey = this.getSimpleKey(projectId, featureName);
    this.localCache.delete(simpleKey);
  }

  /**
   * Start watching chat file for external changes (e.g., manual deletion)
   */
  private startWatchingChatFile(projectId: string, featureName: string, userContext?: UserContext): void {
    // Base branches don't persist chat history; watching can fail because sessions dir won't be created.
    if (userContext && this.persistence.isBaseBranchFeature(projectId, featureName, userContext)) {
      return;
    }

    const key = this.getSimpleKey(projectId, featureName);
    
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
            
            // Clear local cache and Redis
            this.clearMessagesAsync(projectId, featureName, userContext).catch(err => {
              logger.warn(`Failed to clear messages after file deletion`, { component: 'SessionManager' }, err);
            });
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
    const key = this.getSimpleKey(projectId, featureName);
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
    this.localCache.clear();
    logger.info(`Cleanup complete`, { component: 'SessionManager' });
  }
}
