/**
 * PreviewBroadcaster
 *
 * Direct Redis Pub/Sub implementation for Preview state updates from Job Worker.
 *
 * Architecture:
 * - Implements PreviewUpdatePort for compatibility
 * - Broadcasts the decompose techTier HINT via Redis Pub/Sub as an SSE 'preview' message
 * - Persists the hint to the Redis PREVIEW_CONFIG cache for durability
 *
 * Flow:
 *   decompose → PreviewBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 *                                          → Redis SET (PREVIEW_CONFIG) → GET /preview-config
 *
 * The hint is provenance-tagged (`source: 'techtier-hint'`) and travels as a
 * whole `projectProfile`. It deliberately does NOT publish a bare top-level
 * `structureType`: an untagged value would resurrect through any `||` fallback
 * and outrank the manifest-derived truth.
 */

import { Redis } from 'ioredis';
import { buildRedisTlsOptions } from '../../infrastructure/utils/redis';
import type { ProjectProfile } from '@ant/shared';
import { PreviewUpdatePort } from '../ports/preview';
import { UserContext } from '../types/user';
import { getRealtimeBroadcastChannel, BroadcasterOptions } from './types';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis';
import { InflightTracker } from './InflightTracker';

export class PreviewBroadcaster implements PreviewUpdatePort {
  private pubRedis: Redis;
  private readonly options: BroadcasterOptions;
  private readonly inflight = new InflightTracker();

  constructor(options: BroadcasterOptions) {
    const tlsOptions = buildRedisTlsOptions(options.redisUrl);
    this.pubRedis = new Redis(options.redisUrl, {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    this.options = options;

    this.pubRedis.on('error', (err) => console.error(`❌ [PreviewBroadcaster] pubRedis error:`, err.message));
  }

  /**
   * Broadcast the decompose techTier hint to the frontend via SSE.
   * Implements PreviewUpdatePort interface.
   */
  broadcastProjectProfileHint(
    projectId: string,
    featureName: string,
    hint: ProjectProfile,
    userContext?: UserContext
  ): void {
    const ctx = userContext || this.options.userContext;
    // Tracked so close() can flush before pubRedis.quit() drops the publish.
    this.inflight.track(
      this.doBroadcast(projectId, featureName, hint, ctx)
        .catch(err => {
          console.warn(`[PreviewBroadcaster] Failed to broadcast project profile hint:`, err.message);
        })
    );
  }

  private async doBroadcast(
    projectId: string,
    featureName: string,
    hint: ProjectProfile,
    userContext: UserContext
  ): Promise<void> {
    if (!userContext?.organizationId || !userContext?.userId) {
      console.warn(`[PreviewBroadcaster] Cannot broadcast without userContext`);
      return;
    }

    // 1. Broadcast as SSE 'preview' type with 'status' subtype (real-time push).
    //    `canStart` is an independent signal: a techTier decision means the job
    //    is about to write code, so offering Start is correct even though no
    //    manifest exists yet.
    const message = {
      projectId,
      featureName,
      type: 'preview' as const,
      data: {
        type: 'status',
        data: { projectProfile: hint, canStart: true },
      },
      userContext,
    };

    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    await this.pubRedis.publish(channel, JSON.stringify(message));
    console.log(`[PreviewBroadcaster] ✅ hint=${hint.language ?? 'none'}/${hint.framework ?? 'none'} (${hint.structureType ?? 'no structure'}) broadcast to ${channel}`);

    // 2. Persist the hint to the PREVIEW_CONFIG cache so GET /preview-config can
    //    serve it after a refresh, before any preview has started. Only the
    //    `projectProfile` field is written — `structureType` is owned by the
    //    manifest-derived resolver.
    try {
      const configKey = `${REDIS_KEYS.INFRA.PREVIEW_CONFIG}${userContext.organizationId}:${userContext.userId}:${projectId}:${featureName}`;
      const existing = await this.pubRedis.get(configKey);
      const config = existing ? JSON.parse(existing) : {};
      config.projectProfile = hint;
      await this.pubRedis.set(configKey, JSON.stringify(config), 'EX', REDIS_TTL.INFRA.PREVIEW_CONFIG);
      console.log(`[PreviewBroadcaster] ✅ hint ${JSON.stringify(hint)} persisted to ${configKey}`);
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
