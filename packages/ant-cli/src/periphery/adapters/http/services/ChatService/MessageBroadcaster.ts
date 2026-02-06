/**
 * MessageBroadcaster - Handles chat message broadcasting via Redis Pub/Sub
 * 
 * Cloud-safe: All chat messages are published to user-scoped Redis channels,
 * ensuring multi-tenant isolation and efficient routing to the correct clients.
 */

import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';

export interface ChatBroadcastMessage {
  projectId: string;
  featureName: string;
  type: 'chat';
  data: any;
  userContext: UserContext;  // Required for user-scoped channels
}

export class MessageBroadcaster {
  constructor(private stateStore?: StateStorePort) {}

  /**
   * Broadcast chat event via user-scoped Redis Pub/Sub channel (fire-and-forget)
   * Only the API Server instances with the specific user's SSE connections will receive this.
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

    // Require userContext for user-scoped channel
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.warn('MessageBroadcaster: Cannot broadcast without userContext', { 
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
      type: 'chat',
      data: enrichedData,
      userContext
    };

    // Publish to user-scoped channel
    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    
    // Fire-and-forget: publish asynchronously without blocking
    this.stateStore.publish(channel, message).catch((error) => {
      logger.error(`Failed to publish chat message to Redis channel ${channel}`, { 
        component: 'MessageBroadcaster', 
        projectId, 
        featureName 
      }, error);
    });
  }
}
