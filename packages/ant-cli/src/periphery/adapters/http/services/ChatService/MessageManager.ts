/**
 * MessageManager - Manages chat messages
 * 
 * Handles user/assistant message creation and lifecycle
 * CLOUD MODE: Uses Redis for cross-Pod consistency of currentMessage
 */

import type { ChatMessage, MessageContent, ChatSession } from './types';
import type { SessionManager } from './SessionManager';
import type { SessionPersistence } from './SessionPersistence';
import type { MessageBroadcaster } from './MessageBroadcaster';
import type { ContentMerger } from './ContentMerger';
import type { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';

export class MessageManager {
  constructor(
    private sessionManager: SessionManager,
    private persistence: SessionPersistence,
    private broadcaster: MessageBroadcaster,
    private contentMerger: ContentMerger
  ) {}

  /**
   * Add user message to chat history
   * CLOUD MODE: Waits for Redis save to ensure message order consistency
   */
  async addUserMessage(
    projectId: string, 
    featureName: string, 
    content: string, 
    jobId?: string, 
    userContext?: UserContext
  ): Promise<string> {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId, userContext);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: ChatMessage = {
      id: messageId,
      role: 'user',
      contents: [{
        type: 'text',
        content
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(userMessage);
    
    // Save to file
    this.persistence.saveSession(projectId, featureName, session.messages, userContext);
    
    // ✅ CRITICAL: Wait for Redis save to ensure message order in Cloud mode
    // Without this, Job Worker may start before user message is in Redis,
    // causing assistant message to appear before user message
    try {
      await this.sessionManager.saveSessionAsync(projectId, featureName, session, userContext);
    } catch (err) {
      logger.warn('Failed to save session to Redis', { component: 'MessageManager' }, err);
    }
    
    // Broadcast new user message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'user_message',
      message: userMessage
    }, session.userContext);
    
    return messageId;
  }

  /**
   * Start a new assistant message (for streaming)
   * CLOUD MODE: Saves currentMessage to Redis for cross-Pod consistency
   */
  startAssistantMessage(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): string {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId, userContext);
    
    // If there's already a current message being streamed, reuse it
    if (session.currentMessage && session.currentMessage.isStreaming) {
      return session.currentMessage.id;
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [],
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };

    session.currentMessage = newMessage;
    
    // Save currentMessage to Redis for cross-Pod consistency
    this.sessionManager.setCurrentMessageAsync(
      projectId, 
      featureName, 
      newMessage, 
      userContext
    ).catch(err => {
      logger.warn('Failed to save currentMessage to Redis', { component: 'MessageManager' }, err);
    });
    
    // Broadcast message start
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_start',
      message: newMessage
    }, session.userContext);

    return messageId;
  }

  /**
   * Start assistant message (async version for Cloud mode)
   */
  async startAssistantMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): Promise<string> {
    const session = await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext);
    
    // Check Redis for existing streaming message (cross-Pod)
    const existingMessage = await this.sessionManager.getCurrentMessageAsync(
      projectId, featureName, userContext
    );
    
    if (existingMessage && existingMessage.isStreaming) {
      // Update local session
      session.currentMessage = existingMessage;
      return existingMessage.id;
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [],
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };

    session.currentMessage = newMessage;
    
    // Save to Redis
    await this.sessionManager.setCurrentMessageAsync(projectId, featureName, newMessage, userContext);
    
    // Broadcast message start
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_start',
      message: newMessage
    }, session.userContext);

    return messageId;
  }

  /**
   * Add content to current streaming message
   * Returns the actual content index used (important for MERGE cases)
   * 
   * IMPORTANT: In multi-Pod environments, call ensureActiveMessageAsync() first
   * to ensure session is restored from Redis before calling this sync method.
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): number {
    const session = this.sessionManager.getSession(projectId, featureName);
    if (!session) {
      // ✅ CRITICAL: This should NOT happen if ensureActiveMessageAsync() was called first
      // If this occurs in multi-Pod, it means session was not properly restored from Redis
      logger.error(`No session found for content type '${content.type}' - ensureActiveMessageAsync() may not have been called`, { 
        component: 'MessageManager', 
        projectId, 
        featureName
      });
      return -1;
    }

    if (!session.currentMessage) {
      // ✅ CRITICAL: No active message - this can happen if message was finalized
      logger.error(`No currentMessage for content type '${content.type}' - message may have been finalized`, { 
        component: 'MessageManager', 
        projectId, 
        featureName
      });
      return -1;
    }

    const result = this.contentMerger.addContent(projectId, featureName, session, content);
    
    // CRITICAL: Save currentMessage to Redis EVERY time for cross-Pod consistency
    // In multi-Pod environments, any request can hit any Pod, and the next request
    // needs to see the latest contents to properly append (not add new)
    if (session.currentMessage) {
      this.sessionManager.setCurrentMessageAsync(
        projectId, featureName, session.currentMessage, session.userContext
      ).catch(err => {
        logger.warn('Failed to sync currentMessage to Redis', { component: 'MessageManager' }, err);
      });
    }
    
    return result;
  }

  /**
   * Ensure session has an active message (for Cloud mode cross-Pod recovery)
   * Call this before addContentToCurrentMessage if message might be on different Pod
   * 
   * CRITICAL: Uses async version to restore FULL session from Redis,
   * including activeFileOperations, thinkingStartTime, etc.
   */
  async ensureActiveMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string,
    userContext?: UserContext
  ): Promise<boolean> {
    // ✅ CRITICAL: Use async version to restore FULL session from Redis
    // This ensures activeFileOperations, thinkingStartTime, etc. are restored
    // Without this, file cards fail in multi-Pod environments
    const session = await this.sessionManager.getOrCreateSessionAsync(
      projectId, featureName, jobId, userContext
    );
    
    if (session.currentMessage) {
      return true;
    }
    
    // Try to recover currentMessage from Redis if not in session
    const redisMessage = await this.sessionManager.getCurrentMessageAsync(
      projectId, featureName, userContext
    );
    
    if (redisMessage) {
      // Restore currentMessage to session
      session.currentMessage = redisMessage;
      return true;
    }
    
    // No active message found
    return false;
  }

  /**
   * Reconstruct message from client-provided messageId
   * Used in multi-Pod environments when Redis replication lag causes recovery failure
   * Creates a minimal message structure that can receive streaming content
   */
  async reconstructMessageFromId(
    projectId: string,
    featureName: string,
    jobId: string,
    messageId: string,
    userContext?: UserContext
  ): Promise<void> {
    const session = await this.sessionManager.getOrCreateSessionAsync(
      projectId, featureName, jobId, userContext
    );
    
    // Create a minimal message structure using the provided ID
    // This ensures content is added to the SAME message that client started
    const reconstructedMessage: ChatMessage = {
      id: messageId,  // ✅ Use client's message ID
      role: 'assistant',
      contents: [],  // Will be populated by subsequent content adds
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };
    
    session.currentMessage = reconstructedMessage;
    
    // Save to Redis for subsequent requests
    await this.sessionManager.setCurrentMessageAsync(
      projectId, featureName, reconstructedMessage, userContext
    );
    
    logger.debug(`Reconstructed message ${messageId} from client ID`, {
      component: 'MessageManager',
      projectId,
      featureName
    });
  }

  /**
   * Finalize current streaming message
   * Sync version - tries local session first
   */
  finalizeCurrentMessage(projectId: string, featureName: string, cancelled: boolean = false): void {
    const session = this.sessionManager.getSession(projectId, featureName);
    
    if (!session || !session.currentMessage) {
      logger.warn(`No current message to finalize (sync): ${projectId}/${featureName}`, { 
        component: 'MessageManager' 
      });
      return;
    }

    this.doFinalizeMessage(projectId, featureName, session, cancelled);
  }

  /**
   * Finalize current streaming message (async version for Cloud mode)
   * Recovers currentMessage from Redis if not in local session
   */
  async finalizeCurrentMessageAsync(
    projectId: string, 
    featureName: string, 
    cancelled: boolean = false,
    userContext?: UserContext
  ): Promise<void> {
    let session = this.sessionManager.getSession(projectId, featureName);
    
    // Try to recover currentMessage from Redis if not in local session
    if (!session?.currentMessage) {
      const redisMessage = await this.sessionManager.getCurrentMessageAsync(
        projectId, featureName, userContext
      );
      
      if (redisMessage) {
        session = this.sessionManager.getOrCreateSession(projectId, featureName, redisMessage.jobId, userContext);
        session.currentMessage = redisMessage;
      }
    }
    
    if (!session || !session.currentMessage) {
      logger.warn(`No current message to finalize (async): ${projectId}/${featureName}`, { 
        component: 'MessageManager' 
      });
      return;
    }

    this.doFinalizeMessage(projectId, featureName, session, cancelled);
  }

  /**
   * Internal: Actually finalize the message
   */
  private doFinalizeMessage(
    projectId: string, 
    featureName: string, 
    session: ChatSession, 
    cancelled: boolean
  ): void {
    if (!session.currentMessage) {
      return;
    }

    const messageId = session.currentMessage.id;

    // Finalize content (thinking blocks, in-progress work, file operations)
    this.contentMerger.finalizeContent(projectId, featureName, session, cancelled);

    session.currentMessage.isStreaming = false;
    session.messages.push(session.currentMessage);
    
    // Save to file AND Redis
    this.persistence.saveSession(projectId, featureName, session.messages, session.userContext);
    this.sessionManager.saveSessionAsync(projectId, featureName, session, session.userContext).catch(err => {
      logger.warn('Failed to save session to Redis', { component: 'MessageManager' }, err);
    });
    
    // Clear currentMessage from Redis
    this.sessionManager.setCurrentMessageAsync(
      projectId, featureName, null, session.userContext
    ).catch(err => {
      logger.warn('Failed to clear currentMessage from Redis', { component: 'MessageManager' }, err);
    });
    
    // Broadcast message complete
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_complete',
      messageId
    }, session.userContext);

    session.currentMessage = undefined;
  }

  /**
   * Add job error message
   */
  addJobError(
    projectId: string,
    featureName: string,
    jobId: string,
    errorMessage: string,
    errorDetails?: any
  ): string {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const errorMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'text',
        content: `❌ **Job Failed**\n\n${errorMessage}${errorDetails ? `\n\nDetails:\n${JSON.stringify(errorDetails, null, 2)}` : ''}`
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(errorMsg);
    
    // Save to file
    this.persistence.saveSession(projectId, featureName, session.messages);
    
    // Broadcast error message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'error_message',
      message: errorMsg
    }, session.userContext);
    
    return messageId;
  }

  /**
   * Add cancelled message (for job interruptions)
   * ✅ CRITICAL: Use async version to ensure existing messages are loaded before adding
   * This prevents overwriting existing chat history with only the cancelled message
   */
  async addCancelledMessageAsync(
    projectId: string,
    featureName: string,
    jobId: string,
    reason: string,
    message: string,
    userContext?: UserContext
  ): Promise<string> {
    // ✅ Use async version to ensure file/Redis is fully loaded
    const session = await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cancelledMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'cancelled',
        content: message,
        metadata: {
          jobId,
          reason
        }
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(cancelledMsg);
    
    // Save to file
    this.persistence.saveSession(projectId, featureName, session.messages, userContext);
    
    // Broadcast cancelled message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'cancelled_message',
      message: cancelledMsg
    }, session.userContext);
    
    return messageId;
  }

  /**
   * Add cancelled message (sync version - deprecated, use addCancelledMessageAsync)
   * @deprecated Use addCancelledMessageAsync instead to prevent race conditions
   */
  addCancelledMessage(
    projectId: string,
    featureName: string,
    jobId: string,
    reason: string,
    message: string,
    userContext?: UserContext
  ): string {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cancelledMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'cancelled',
        content: message,
        metadata: {
          jobId,
          reason
        }
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(cancelledMsg);
    
    // Save to file
    this.persistence.saveSession(projectId, featureName, session.messages, userContext);
    
    // Broadcast cancelled message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'cancelled_message',
      message: cancelledMsg
    }, session.userContext);
    
    return messageId;
  }
}
