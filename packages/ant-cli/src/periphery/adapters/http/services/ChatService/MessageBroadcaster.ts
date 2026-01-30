/**
 * MessageBroadcaster - Handles chat message broadcasting via Redis Pub/Sub
 * 
 * Cloud-safe: All chat messages are published to Redis, allowing any API Server
 * instance to receive and broadcast to its connected SSE clients.
 */

import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';

// Redis channel for chat messages
export const CHAT_BROADCAST_CHANNEL = 'chat:broadcast';

export interface ChatBroadcastMessage {
  projectId: string;
  featureName: string;
  data: any;
  userContext?: UserContext;
}

export class MessageBroadcaster {
  constructor(private stateStore?: StateStorePort) {}

  /**
   * Broadcast chat event via Redis Pub/Sub (fire-and-forget)
   * All API Server instances will receive this and forward to their SSE clients
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

    // Fire-and-forget: publish asynchronously without blocking
    this.stateStore.publish(CHAT_BROADCAST_CHANNEL, message).catch((error) => {
      logger.error('Failed to publish chat message to Redis', { 
        component: 'MessageBroadcaster', 
        projectId, 
        featureName 
      }, error);
    });
  }
}
