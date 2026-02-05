/**
 * MessageBroadcaster - Handles chat message broadcasting via Redis Pub/Sub
 * 
 * Cloud-safe: All chat messages are published to Redis, allowing any Server
 * instance to receive and broadcast to its connected SSE clients.
 */

import type { StateStorePort } from '../ports/stateStore';
import type { UserContext } from '../types/user';
import { logger } from '../../utils/logger';

// Redis channel for chat messages
export const CHAT_BROADCAST_CHANNEL = 'chat:broadcast';

/**
 * Broadcast message structure for Redis Pub/Sub
 */
export interface ChatBroadcastMessage {
  projectId: string;
  featureName: string;
  data: any;
  userContext?: UserContext;
}

/**
 * MessageBroadcaster - Broadcasts chat events via Redis Pub/Sub
 */
export class MessageBroadcaster {
  constructor(private stateStore?: StateStorePort) {}

  /**
   * Broadcast chat event via Redis Pub/Sub (fire-and-forget)
   * All Server instances will receive this and forward to their SSE clients
   * 
   * Note: This is intentionally fire-and-forget to avoid blocking chat operations.
   * Errors are logged but don't affect the calling code.
   */
  broadcast(projectId: string, featureName: string, data: any, userContext?: UserContext): void {
    if (!this.stateStore) {
      logger.warn('MessageBroadcaster: No stateStore configured, cannot broadcast', { 
        component: 'MessageBroadcaster', 
        projectId, 
        featureName 
      });
      return;
    }

    // Enrich data with projectId and featureName for frontend filtering
    const enrichedData = {
      ...data,
      projectId,
      featureName
    };

    const message: ChatBroadcastMessage = {
      projectId,
      featureName,
      data: enrichedData,
      userContext
    };

    // ✅ Debug: Log broadcast (only for non-streaming events to reduce noise)
    if (data.type !== 'content_update' || !data.content?.type?.includes('thinking')) {
      logger.debug(`Broadcasting: ${data.type} (msgId: ${data.messageId || 'N/A'})`, { 
        component: 'MessageBroadcaster', 
        projectId, 
        featureName
      });
    }

    // Fire-and-forget: publish asynchronously without blocking
    this.stateStore.publish(CHAT_BROADCAST_CHANNEL, message).catch((error) => {
      logger.error('Failed to publish chat message to Redis', { 
        component: 'MessageBroadcaster', 
        projectId, 
        featureName 
      }, error);
    });
  }

  /**
   * Broadcast message finalized event
   * NOTE: Uses 'message_complete' type to match UI expectations
   */
  broadcastMessageFinalized(
    projectId: string, 
    featureName: string, 
    messageId: string, 
    userContext?: UserContext
  ): void {
    this.broadcast(projectId, featureName, {
      type: 'message_complete',  // UI expects 'message_complete', not 'message_finalized'
      messageId
    }, userContext);
  }

  /**
   * Broadcast content add event
   */
  broadcastContentAdd(
    projectId: string,
    featureName: string,
    messageId: string,
    content: any,
    userContext?: UserContext
  ): void {
    this.broadcast(projectId, featureName, {
      type: 'content_add',
      messageId,
      content
    }, userContext);
  }

  /**
   * Broadcast content update event
   */
  broadcastContentUpdate(
    projectId: string,
    featureName: string,
    messageId: string,
    contentIndex: number,
    content: any,
    userContext?: UserContext
  ): void {
    this.broadcast(projectId, featureName, {
      type: 'content_update',
      messageId,
      contentIndex,
      content
    }, userContext);
  }

  /**
   * Broadcast thinking collapse event
   */
  broadcastThinkingCollapse(
    projectId: string,
    featureName: string,
    messageId: string,
    contentIndex: number,
    durationMs: number,
    userContext?: UserContext
  ): void {
    this.broadcast(projectId, featureName, {
      type: 'thinking_collapse',
      messageId,
      contentIndex,
      durationMs
    }, userContext);
  }
}
