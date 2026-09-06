/**
 * Port registry — preview (full state management) and preview config.
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type { PreviewState } from '../../../core/ports/portRegistry';
import type { PreviewConfigRecord } from '../../../core/ports/preview';
import { createPreviewKey, createDeployKey } from '../redisKeyUtils';
import { toDnsLabel } from '../../../periphery/adapters/http/services/PreviewService/utils/previewLabel';
import { toUrlKey } from '../../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { REDIS_KEYS, REDIS_TTL } from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisDeployRegistryStore } from './RedisDeployRegistryStore';

export class RedisPreviewRegistryStore extends RedisDeployRegistryStore {
  // ============================================
  // Port Registry - Preview (Full State Management)
  // ============================================

  /**
   * Register/Update preview state (full state)
   * Called when preview server starts
   */
  async registerPreview(state: Omit<PreviewState, 'lastAccessedAt'>): Promise<void> {
    const { tenantId, userId, projectId, feature, port, host, podId } = state;
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    
    const fullState: PreviewState = {
      ...state,
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(fullState), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    pipeline.sadd(REDIS_KEYS.INFRA.PREVIEW_LIST, portKey);
    // Index by podId for cleanup on pod restart
    pipeline.sadd(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, podId), portKey);
    // O(1) DNS-label → portKey index so the content/WS proxy resolves a subdomain
    // without enumerating the whole registry every request (M-NEW-020). Stale
    // entries expire with the same TTL and resolution re-verifies the record.
    for (const label of this.previewLabelsOf(tenantId, userId, projectId, feature, fullState.packages)) {
      pipeline.set(this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label), portKey, 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    }
    await pipeline.exec();

    logger.info(`[Preview] Registered: ${portKey} → ${host}:${port} (pod: ${podId})`, { component: 'RedisStateStore' });
  }

  /**
   * Populate the DNS-label indexes from the active preview/deploy registries.
   *
   * Subdomain routing resolves through the label index ONLY — there is no
   * per-request full-registry scan any more (M-NEW-020 / M-NEW-023). A record
   * written before the index existed, or one whose index entry expired, would
   * otherwise 404 while the record itself is healthy. A label is a pure function
   * of the record (coordinates + package urlKeys), so it is always recomputable.
   *
   * Startup/maintenance only: this is the one place enumeration is the right
   * tool. Best-effort — a failure here must not block boot.
   */
  async backfillLabelIndexes(): Promise<{ previews: number; deploys: number }> {
    let previews = 0;
    let deploys = 0;

    try {
      const all = await this.listPreviews();
      const pipeline = this.redis.pipeline();
      for (const p of all) {
        const portKey = createPreviewKey(p.tenantId, p.userId, p.projectId, p.feature);
        for (const label of this.previewLabelsOf(p.tenantId, p.userId, p.projectId, p.feature, p.packages)) {
          pipeline.set(this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label), portKey, 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
          previews++;
        }
      }
      if (previews > 0) await pipeline.exec();
    } catch (err: any) {
      logger.warn(`[Preview] label-index backfill failed: ${err?.message ?? err}`, { component: 'RedisStateStore' });
    }

    try {
      const all = await this.listDeploys();
      const pipeline = this.redis.pipeline();
      for (const d of all) {
        const deployKey = createDeployKey(d.tenantId, d.userId, d.projectId, d.feature);
        for (const label of this.deployLabelsOf(d.tenantId, d.userId, d.projectId, d.feature, d.packages)) {
          pipeline.set(this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label), deployKey, 'EX', REDIS_TTL.INFRA.DEPLOY);
          deploys++;
        }
      }
      if (deploys > 0) await pipeline.exec();
    } catch (err: any) {
      logger.warn(`[Deploy] label-index backfill failed: ${err?.message ?? err}`, { component: 'RedisStateStore' });
    }

    if (previews > 0 || deploys > 0) {
      logger.info(
        `[Routing] Label index backfilled: ${previews} preview label(s), ${deploys} deploy label(s)`,
        { component: 'RedisStateStore' },
      );
    }
    return { previews, deploys };
  }

  /** Every DNS label a preview answers to: the entry key + each frontend package. */
  private previewLabelsOf(
    tenantId: string, userId: string, projectId: string, feature: string,
    packages: PreviewState['packages'] | undefined,
  ): string[] {
    const serverKey = `${tenantId}:${userId}:${projectId}:${feature}`;
    const labels = new Set<string>([toDnsLabel(toUrlKey(serverKey))]);
    for (const p of packages || []) {
      if (p.type === 'frontend') labels.add(toDnsLabel(p.urlKey || toUrlKey(serverKey)));
    }
    return [...labels];
  }

  /**
   * O(1) preview resolve by DNS label: the label index → portKey → record.
   * Returns null (and lazily prunes the stale index entry) when the record is
   * gone or no longer answers to that label — the caller falls back to a full
   * scan only on a genuine miss, never per legitimate request.
   */
  async getPreviewByLabel(label: string): Promise<PreviewState | null> {
    const labelKey = this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label);
    const portKey = await this.redis.get(labelKey);
    if (!portKey) return null;
    const data = await this.redis.get(this.key(REDIS_KEYS.INFRA.PREVIEW, portKey));
    if (!data) { this.redis.del(labelKey).catch(() => {}); return null; }
    const state: PreviewState = JSON.parse(data);
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    const stillValid = this.previewLabelsOf(state.tenantId, state.userId, state.projectId, state.feature, state.packages).includes(label);
    if (!stillValid) { this.redis.del(labelKey).catch(() => {}); return null; }
    return state;
  }

  /**
   * Get preview state
   * Does NOT auto-update lastAccessedAt (use touchPreview for that)
   */
  async getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewState | null> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const state: PreviewState = JSON.parse(data);
    // Parse dates
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    
    return state;
  }

  /**
   * Get preview port (convenience method)
   */
  async getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const state = await this.getPreview(tenantId, userId, projectId, feature);
    return state?.port ?? null;
  }

  /**
   * Update preview state (partial update)
   * For updating running, ready, issues, packages without re-registering
   */
  async updatePreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'errorStage' | 'hint' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath' | 'structureType' | 'projectProfile' | 'setupReasoning' | 'setupReason' | 'suggestedFix' | 'connections' | 'restartRequired'>>
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(`[Preview] updatePreview: NOT FOUND ${portKey}`, { component: 'RedisStateStore' });
      return;
    }

    const state: PreviewState = JSON.parse(data);
    const updated: PreviewState = {
      ...state,
      ...update,
      lastAccessedAt: new Date()
    };

    // Record and index move together. The index is the ONLY resolution path for
    // subdomain routing (there is no full-scan fallback any more), so a dropped
    // index write is a 404 rather than a slow success — it must be awaited, in
    // the same round trip as the record (M-NEW-020).
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(updated), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    if (update.packages !== undefined) {
      for (const label of this.previewLabelsOf(tenantId, userId, projectId, feature, updated.packages)) {
        pipeline.set(this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label), portKey, 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
      }
    }
    await pipeline.exec();
    logger.debug(`[Preview] Updated: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * Update last accessed time (called on proxy request)
   */
  async touchPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: PreviewState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    // Refresh the label index alongside the record. Refreshing only the record
    // let a continuously-accessed preview outlive its index entry, and with the
    // full-scan fallback removed that is a hard 404 on a healthy preview
    // (M-NEW-020).
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    for (const label of this.previewLabelsOf(tenantId, userId, projectId, feature, state.packages)) {
      pipeline.set(this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label), portKey, 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    }
    await pipeline.exec();
  }

  // ============================================
  // Preview Config (User Settings, separate from runtime state)
  // ============================================

  /**
   * Save preview config (user-configured settings: connections, structureType, projectProfile).
   * Stored in a separate Redis key from runtime state so it persists
   * across preview start/stop cycles.
   */
  async savePreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    config: PreviewConfigRecord
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW_CONFIG, portKey);
    
    // Merge with existing config to avoid overwriting other fields
    const existing = await this.redis.get(key);
    const merged = existing ? { ...JSON.parse(existing), ...config } : config;
    
    await this.redis.set(key, JSON.stringify(merged), 'EX', REDIS_TTL.INFRA.PREVIEW_CONFIG);
    logger.info(`[Preview] Config saved: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * Get preview config (user-configured settings).
   * Returns null if no config has been saved.
   */
  async getPreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewConfigRecord | null> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW_CONFIG, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Unregister preview (delete state)
   */
  async unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    
    // Get state to find podId for index cleanup
    const data = await this.redis.get(key);
    
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(REDIS_KEYS.INFRA.PREVIEW_LIST), portKey);
    
    // Cleanup pod + label indexes if state exists
    if (data) {
      const state: PreviewState = JSON.parse(data);
      pipeline.srem(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, state.podId), portKey);
      // Drop the label entries now rather than leaving them to expire. The
      // reader's revalidation still prunes anything missed, but an index that is
      // the sole resolution path should not carry known-dead labels.
      for (const label of this.previewLabelsOf(tenantId, userId, projectId, feature, state.packages)) {
        pipeline.del(this.key(REDIS_KEYS.INFRA.PREVIEW_LABEL_IDX, label));
      }
    }

    await pipeline.exec();
    logger.info(`[Preview] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active previews
   */
  /**
   * O(1) count of registered previews via SCARD — the cheap counter the public
   * `/health` endpoint needs instead of enumerating the whole registry with
   * SMEMBERS + MGET + JSON.parse per entry (M-NEW-020).
   */
  async countPreviews(): Promise<number> {
    return this.redis.scard(this.key(REDIS_KEYS.INFRA.PREVIEW_LIST));
  }

  async listPreviews(): Promise<PreviewState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.PREVIEW_LIST));

    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.PREVIEW, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: PreviewState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  /**
   * List previews for a specific pod (for cleanup on pod restart)
   */
  async listPreviewsByPod(podId: string): Promise<PreviewState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, podId));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.PREVIEW, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: PreviewState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  /**
   * Get idle previews (for auto-cleanup)
   * @param idleThresholdMs - Milliseconds since last access
   */
  async getIdlePreviews(idleThresholdMs: number): Promise<PreviewState[]> {
    const allPreviews = await this.listPreviews();
    const now = Date.now();
    
    return allPreviews.filter(preview => {
      const lastAccess = new Date(preview.lastAccessedAt).getTime();
      return (now - lastAccess) > idleThresholdMs;
    });
  }

}
