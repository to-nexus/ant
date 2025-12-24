/**
 * MessageBroadcaster - Handles SSE broadcasting to frontend
 * 
 * Broadcasts chat events to connected clients
 */

import type { SSEService } from '../SSEService';

export class MessageBroadcaster {
  constructor(private sseService?: SSEService) {}

  /**
   * Broadcast chat event to frontend
   */
  broadcast(projectId: string, featureName: string, data: any): void {
    if (!this.sseService) {
      return;
    }

    // Include projectId and featureName in the event data
    // This allows frontend to filter messages by context (multi-tab support)
    const enrichedData = {
      ...data,
      projectId,
      featureName
    };
    
    this.sseService.broadcast(projectId, featureName, 'chat', enrichedData);
  }
}



