/**
 * PreviewBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Preview state updates from Job Worker.
 * 
 * Architecture:
 * - Implements PreviewUpdatePort for compatibility
 * - Broadcasts structureType via Redis Pub/Sub as SSE 'preview' message
 * - Used by detectEnvironment node to notify frontend immediately
 * 
 * Flow:
 *   detectEnvironment → PreviewBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import { PreviewUpdatePort, PreviewStructureType } from '../ports/preview';
import { UserContext } from '../types/user';
import { getRealtimeBroadcastChannel, BroadcasterOptions } from './types';

export class PreviewBroadcaster implements PreviewUpdatePort {
  private pubRedis: Redis;
  private readonly options: BroadcasterOptions;

  constructor(options: BroadcasterOptions) {
    const isTLS = options.redisUrl.startsWith('rediss://');
    const tlsOptions = isTLS ? { tls: { checkServerIdentity: () => undefined as undefined } } : {};
    this.pubRedis = new Redis(options.redisUrl, {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    this.options = options;

    this.pubRedis.on('error', (err) => console.error(`❌ [PreviewBroadcaster] pubRedis error:`, err.message));
  }

  /**
   * Broadcast structure type to frontend via SSE
   * Implements PreviewUpdatePort interface
   */
  broadcastStructureType(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext?: UserContext
  ): void {
    const ctx = userContext || this.options.userContext;
    this.doBroadcast(projectId, featureName, structureType, ctx)
      .catch(err => {
        console.warn(`[PreviewBroadcaster] Failed to broadcast structureType:`, err.message);
      });
  }

  private async doBroadcast(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext: UserContext
  ): Promise<void> {
    if (!userContext?.organizationId || !userContext?.userId) {
      console.warn(`[PreviewBroadcaster] Cannot broadcast without userContext`);
      return;
    }

    // Broadcast as SSE 'preview' type with 'status' subtype
    // Frontend usePreviewManager already handles type:'preview', subtype:'status'
    // structureType detected → code exists → canStart is true
    const message = {
      projectId,
      featureName,
      type: 'preview' as const,
      data: {
        type: 'status',
        data: {
          structureType,
          canStart: true,
        },
      },
      userContext,
    };

    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    await this.pubRedis.publish(channel, JSON.stringify(message));
    console.log(`[PreviewBroadcaster] ✅ structureType=${structureType} broadcast to ${channel}`);
  }

  async close(): Promise<void> {
    await this.pubRedis.quit();
  }
}
