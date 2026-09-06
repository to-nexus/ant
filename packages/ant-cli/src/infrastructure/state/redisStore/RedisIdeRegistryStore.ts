/**
 * Port registry — IDE (full state management).
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type { IDEState } from '../../../core/ports/portRegistry';
import { createIDEKey, NO_FEATURE_KEY } from '../redisKeyUtils';
import { REDIS_KEYS, REDIS_TTL } from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisPreviewRegistryStore } from './RedisPreviewRegistryStore';

export class RedisIdeRegistryStore extends RedisPreviewRegistryStore {
  // ============================================
  // Port Registry - IDE (Full State Management)
  // ============================================

  /**
   * Register IDE state
   */
  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number,
    host: string,
    podId: string,
    feature: string = NO_FEATURE_KEY
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    
    const state: IDEState = {
      tenantId,
      userId,
      projectId,
      running: true,
      ready: true,
      port,
      host,
      podId,
      startedAt: new Date(),
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    pipeline.sadd(this.key(REDIS_KEYS.INFRA.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`[IDE] Registered: ${portKey} → ${host}:${port} (pod: ${podId})`, { component: 'RedisStateStore' });
  }

  /**
   * Get IDE state
   */
  async getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string = NO_FEATURE_KEY
  ): Promise<IDEState | null> {
    // Validate all key components are present
    if (!tenantId || !userId || !projectId) {
      logger.warn(`[IDE] getIDE() INVALID ARGS: tenantId=${tenantId}, userId=${userId}, projectId=${projectId}`, { component: 'RedisStateStore' });
      return null;
    }
    
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const state: IDEState = JSON.parse(data);
    // Parse dates
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);

    return state;
  }

  /**
   * Get IDE port (convenience method)
   */
  async getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string = NO_FEATURE_KEY
  ): Promise<number | null> {
    const state = await this.getIDE(tenantId, userId, projectId, feature);
    return state?.port ?? null;
  }

  /**
   * Update last accessed time
   */
  async touchIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string = NO_FEATURE_KEY
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: IDEState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
  }

  /**
   * Unregister IDE
   */
  async unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string = NO_FEATURE_KEY
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(REDIS_KEYS.INFRA.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`[IDE] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active IDEs
   */
  async listIDEs(): Promise<IDEState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.IDE_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.IDE, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: IDEState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

}
