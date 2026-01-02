/**
 * MessageManager - Manages chat messages
 * 
 * Handles user/assistant message creation and lifecycle
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
   */
  addUserMessage(
    projectId: string, 
    featureName: string, 
    content: string, 
    jobId?: string, 
    userContext?: UserContext
  ): string {
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
    
    // Broadcast new user message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'user_message',
      message: userMessage
    }, session.userContext);
    
    return messageId;
  }

  /**
   * Start a new assistant message (for streaming)
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
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): number {
    const session = this.sessionManager.getSession(projectId, featureName);
    if (!session) {
      logger.warn('No session found', { component: 'MessageManager', projectId, featureName });
      return -1;
    }

    return this.contentMerger.addContent(projectId, featureName, session, content);
  }

  /**
   * Finalize current streaming message
   */
  finalizeCurrentMessage(projectId: string, featureName: string, cancelled: boolean = false): void {
    const session = this.sessionManager.getSession(projectId, featureName);
    
    if (!session || !session.currentMessage) {
      return;
    }

    // Finalize content (thinking blocks, in-progress work, file operations)
    this.contentMerger.finalizeContent(projectId, featureName, session, cancelled);

    session.currentMessage.isStreaming = false;
    session.messages.push(session.currentMessage);
    
    // Save to file
    this.persistence.saveSession(projectId, featureName, session.messages, session.userContext);
    
    // Broadcast message complete
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_complete',
      messageId: session.currentMessage.id
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
    
    logger.debug(`Added job error message: ${messageId}`, { component: 'MessageManager', projectId, featureName, jobId });
    return messageId;
  }

  /**
   * Add cancelled message (for job interruptions)
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
    
    logger.debug(`Added cancelled message: ${messageId} (reason: ${reason})`, { component: 'MessageManager', projectId, featureName, jobId });
    return messageId;
  }
}








