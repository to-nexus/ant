/**
 * PreviewBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Preview state updates from Job Worker.
 * 
 * Architecture:
 * - Implements PreviewUpdatePort for compatibility
 * - Broadcasts structureType via Redis Pub/Sub as SSE 'preview' message
 * - Persists structureType to Redis PREVIEW_CONFIG key for durability
 * - Used by detect node to notify frontend immediately
 * 
 * Flow:
 *   detect → PreviewBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 *                                          → Redis SET (PREVIEW_CONFIG) → GET /preview-config
 */

import { Redis } from 'ioredis';
import { PreviewUpdatePort, PreviewStructureType } from '../ports/preview';
import { UserContext } from '../types/user';
import { getRealtimeBroadcastChannel, BroadcasterOptions } from './types';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis';
import { InflightTracker } from './InflightTracker';

export class PreviewBroadcaster implements PreviewUpdatePort {
  private pubRedis: Redis;
  private readonly options: BroadcasterOptions;
  private readonly inflight = new InflightTracker();

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
   * Broadcast structure type and project profile to frontend via SSE
   * Implements PreviewUpdatePort interface
   */
  broadcastStructureType(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext?: UserContext,
    projectProfile?: { language: string; framework?: string }
  ): void {
    const ctx = userContext || this.options.userContext;
    // Tracked so close() can flush before pubRedis.quit() drops the publish.
    this.inflight.track(
      this.doBroadcast(projectId, featureName, structureType, ctx, projectProfile)
        .catch(err => {
          console.warn(`[PreviewBroadcaster] Failed to broadcast structureType:`, err.message);
        })
    );
  }

  private async doBroadcast(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext: UserContext,
    projectProfile?: { language: string; framework?: string }
  ): Promise<void> {
    if (!userContext?.organizationId || !userContext?.userId) {
      console.warn(`[PreviewBroadcaster] Cannot broadcast without userContext`);
      return;
    }

    // 1. Broadcast as SSE 'preview' type with 'status' subtype (real-time push)
    // Frontend usePreviewManager already handles type:'preview', subtype:'status'
    // structureType detected → code exists → canStart is true
    const statusData: Record<string, any> = {
      structureType,
      canStart: true,
    };
    if (projectProfile) {
      statusData.projectProfile = projectProfile;
    }
    
    const message = {
      projectId,
      featureName,
      type: 'preview' as const,
      data: {
        type: 'status',
        data: statusData,
      },
      userContext,
    };

    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    await this.pubRedis.publish(channel, JSON.stringify(message));
    console.log(`[PreviewBroadcaster] ✅ structureType=${structureType}${projectProfile ? ` profile=${projectProfile.language}/${projectProfile.framework || 'none'}` : ''} broadcast to ${channel}`);

    // 2. Persist structureType + projectProfile to PREVIEW_CONFIG Redis key (durable storage)
    // This ensures GET /preview-config returns these values even after page refresh,
    // before preview server has ever started.
    try {
      const configKey = `${REDIS_KEYS.INFRA.PREVIEW_CONFIG}${userContext.organizationId}:${userContext.userId}:${projectId}:${featureName}`;
      const existing = await this.pubRedis.get(configKey);
      const config = existing ? JSON.parse(existing) : {};
      config.structureType = structureType;
      if (projectProfile) {
        config.projectProfile = projectProfile;
      }
      await this.pubRedis.set(configKey, JSON.stringify(config), 'EX', REDIS_TTL.INFRA.PREVIEW_CONFIG);
      console.log(`[PreviewBroadcaster] ✅ structureType=${structureType}${projectProfile ? ` projectProfile=${JSON.stringify(projectProfile)}` : ''} persisted to ${configKey}`);
    } catch (err: any) {
      // Non-critical: SSE broadcast already delivered the value in real-time
      console.warn(`[PreviewBroadcaster] Failed to persist to Redis:`, err.message);
    }
  }

  async close(): Promise<void> {
    await this.inflight.flush();
    await this.pubRedis.quit();
  }
}
