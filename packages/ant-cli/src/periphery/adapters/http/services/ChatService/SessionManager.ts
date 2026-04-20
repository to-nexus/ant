/**
 * SessionManager — streaming scratchpad for the Chat API (local cache + Redis).
 *
 * Session redesign §16.2: chat.json is retired. This manager owns the
 * transient message state that backs SSE delta broadcasts; the durable
 * SSOT lives in trace.jsonl (+ feature.jsonl) and is rebuilt via
 * {@link TraceToChatMessages} when the UI asks for history.
 *
 * Session Key Format: "org:user:projectId/featureName"
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ChatSession, ChatMessage } from './types';
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

    // 3. Nothing cached and Redis returned nothing — start a fresh session.
    // Durable history is in trace.jsonl; this scratchpad is only for the
    // current streaming turn.
    const session: ChatSession = {
      projectId,
      featureName,
      jobId,
      messages: [],
      userContext,
    };

    // Save to Redis for future Pod consistency
    await this.saveSessionAsync(projectId, featureName, session, userContext);

    // Update local cache
    this.localCache.set(simpleKey, { session, cachedAt: Date.now() });

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

    // Create a fresh session. Durable history lives in trace.jsonl and is
    // rebuilt on demand by ChatService.getMessagesAsync.
    const session: ChatSession = {
      projectId,
      featureName,
      jobId,
      messages: [],
      userContext,
    };

    // Cache locally
    this.localCache.set(simpleKey, { session, cachedAt: Date.now() });

    // Async: Save to Redis (don't await)
    this.saveSessionAsync(projectId, featureName, session, userContext).catch((err) => {
      logger.warn(`Failed to save session to Redis`, { component: 'SessionManager' }, err);
    });

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
    
    // Save to Redis (durable SSOT is trace.jsonl; Redis is streaming scratchpad)
    if (this.stateStore) {
      try {
        await this.stateStore.setChatSession(redisKey, SessionManager.toRedisSession(session));
      } catch (error) {
        logger.warn(`Failed to save session to Redis`, {
          component: 'SessionManager',
          projectId,
          featureName,
        }, error);
      }
    }
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
    
    // Collapse trace.jsonl / feature.jsonl so the durable SSOT also reflects
    // an empty timeline. This is the user-visible clear effect.
    await this.persistence.collapseSessionLogs(projectId, featureName, userContext);

    // Clean up draft images associated with chat
    const featurePath = this.persistence.getFeaturePath(projectId, featureName, userContext);
    if (featurePath) {
      try {
        const draftsDir = path.join(featurePath, 'inputs', 'assets', 'gen', 'drafts');
        if (fs.existsSync(draftsDir)) {
          fs.rmSync(draftsDir, { recursive: true, force: true });
          logger.info('Cleaned up draft images on chat clear', {
            component: 'SessionManager', projectId, featureName,
          });
        }
      } catch (error) {
        logger.warn('Failed to clean up draft images', { component: 'SessionManager' }, error);
      }
    }

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
   * Cleanup method - drop the in-memory cache (call on server shutdown).
   *
   * Historically also closed chat.json file watchers; those are retired now
   * that trace.jsonl is the SSOT and no file is being watched.
   */
  cleanup(): void {
    this.localCache.clear();
    logger.info(`Cleanup complete`, { component: 'SessionManager' });
  }
}
