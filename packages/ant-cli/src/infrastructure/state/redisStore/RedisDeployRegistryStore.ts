/**
 * Port registry — deploy (static build serving) and deploy-only custom
 * domains.
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type { DeployState } from '../../../core/ports/portRegistry';
import type { CustomDomain } from '@ant/shared';
import { createDeployKey } from '../redisKeyUtils';
import { toDnsLabel } from '../../../periphery/adapters/http/services/PreviewService/utils/previewLabel';
import { toUrlKey } from '../../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { REDIS_KEYS, REDIS_TTL } from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisKvStore } from './RedisKvStore';

export class RedisDeployRegistryStore extends RedisKvStore {
  // ============================================
  // Port Registry - Deploy (Static Build Serving)
  // ============================================

  async registerDeploy(state: Omit<DeployState, 'lastAccessedAt'>): Promise<void> {
    const { tenantId, userId, projectId, feature } = state;
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);

    const fullState: DeployState = { ...state, lastAccessedAt: new Date() };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(fullState), 'EX', REDIS_TTL.INFRA.DEPLOY);
    pipeline.sadd(REDIS_KEYS.INFRA.DEPLOY_LIST, deployKey);
    // O(1) DNS-label → deployKey index (M-NEW-023) — mirror of the preview index.
    for (const label of this.deployLabelsOf(tenantId, userId, projectId, feature, fullState.packages)) {
      pipeline.set(this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label), deployKey, 'EX', REDIS_TTL.INFRA.DEPLOY);
    }
    await pipeline.exec();
    const portsLabel = state.packages.map(p => `${p.slug}:${p.port}`).join(',');
    logger.info(`[Deploy] Registered: ${deployKey} -> ${state.host} [${portsLabel}]`, { component: 'RedisStateStore' });
  }

  /** Every DNS label a deploy answers to: the entry key + each package urlKey. */
  protected deployLabelsOf(
    tenantId: string, userId: string, projectId: string, feature: string,
    packages: DeployState['packages'] | undefined,
  ): string[] {
    const serverKey = `${tenantId}:${userId}:${projectId}:${feature}`;
    const labels = new Set<string>([toDnsLabel(toUrlKey(serverKey))]);
    for (const p of packages || []) labels.add(toDnsLabel(p.urlKey || toUrlKey(serverKey)));
    return [...labels];
  }

  /** O(1) deploy resolve by DNS label — mirror of {@link getPreviewByLabel}. */
  async getDeployByLabel(label: string): Promise<DeployState | null> {
    const labelKey = this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label);
    const deployKey = await this.redis.get(labelKey);
    if (!deployKey) return null;
    const data = await this.redis.get(this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey));
    if (!data) { this.redis.del(labelKey).catch(() => {}); return null; }
    const state: DeployState = JSON.parse(data);
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    const stillValid = this.deployLabelsOf(state.tenantId, state.userId, state.projectId, state.feature, state.packages).includes(label);
    if (!stillValid) { this.redis.del(labelKey).catch(() => {}); return null; }
    return state;
  }

  async getDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<DeployState | null> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return null;
    const state: DeployState = JSON.parse(data);
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    return state;
  }

  async updateDeploy(
    tenantId: string, userId: string, projectId: string, feature: string,
    update: Partial<Pick<DeployState, 'phase' | 'host' | 'podId' | 'error' | 'buildLog' | 'workspacePath' | 'packages' | 'lastAccessedAt' | 'visibility'>>
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return;
    const state: DeployState = JSON.parse(data);
    Object.assign(state, update);
    // Record and index in one awaited round trip — the index is the only
    // resolution path for platform-label routing (M-NEW-023).
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.DEPLOY);
    if (update.packages !== undefined) {
      for (const label of this.deployLabelsOf(tenantId, userId, projectId, feature, state.packages)) {
        pipeline.set(this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label), deployKey, 'EX', REDIS_TTL.INFRA.DEPLOY);
      }
    }
    await pipeline.exec();
  }

  async touchDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return;
    const state: DeployState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    // Refresh the label index with the record: refreshing only the record let a
    // continuously-served deploy outlive its index entry, which without the
    // full-scan fallback is a 404 on a healthy deploy (M-NEW-023).
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.DEPLOY);
    for (const label of this.deployLabelsOf(tenantId, userId, projectId, feature, state.packages)) {
      pipeline.set(this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label), deployKey, 'EX', REDIS_TTL.INFRA.DEPLOY);
    }
    await pipeline.exec();
  }

  async unregisterDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(REDIS_KEYS.INFRA.DEPLOY_LIST, deployKey);
    if (data) {
      const state: DeployState = JSON.parse(data);
      for (const label of this.deployLabelsOf(tenantId, userId, projectId, feature, state.packages)) {
        pipeline.del(this.key(REDIS_KEYS.INFRA.DEPLOY_LABEL_IDX, label));
      }
    }
    await pipeline.exec();
    logger.info(`[Deploy] Unregistered: ${deployKey}`, { component: 'RedisStateStore' });
  }

  async listDeploys(): Promise<DeployState[]> {
    const deployKeys = await this.redis.smembers(REDIS_KEYS.INFRA.DEPLOY_LIST);
    if (deployKeys.length === 0) return [];
    const keys = deployKeys.map(dk => this.key(REDIS_KEYS.INFRA.DEPLOY, dk));
    const values = await this.redis.mget(...keys);

    // Clean up stale SET members whose Redis keys have expired (TTL)
    const staleMembers = deployKeys.filter((_, i) => values[i] === null);
    if (staleMembers.length > 0) {
      this.redis.srem(REDIS_KEYS.INFRA.DEPLOY_LIST, ...staleMembers).catch(() => {});
    }

    return values
      .filter((v): v is string => v !== null)
      .map(v => {
        const state: DeployState = JSON.parse(v);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  // ============================================
  // Port Registry - Custom Domains (Deploy-only)
  // ============================================

  async registerCustomDomain(domain: CustomDomain): Promise<void> {
    const hostname = domain.hostname.toLowerCase();
    const record: CustomDomain = { ...domain, hostname };
    const deployKey = createDeployKey(domain.tenantId, domain.userId, domain.projectId, domain.feature);
    const key = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, hostname);
    const byDeployKey = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_BY_DEPLOY, deployKey);

    // Persisted WITHOUT TTL — a user's domain mapping must not silently expire
    // while the deploy lives. Removed only via deleteCustomDomain / cleanup cascade.
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(record));
    pipeline.sadd(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_LIST, hostname);
    pipeline.sadd(byDeployKey, hostname);
    await pipeline.exec();
    logger.info(`[CustomDomain] Registered: ${hostname} -> ${deployKey}`, { component: 'RedisStateStore' });
  }

  async getCustomDomainByHost(hostname: string): Promise<CustomDomain | null> {
    const key = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, hostname.toLowerCase());
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as CustomDomain;
  }

  async listCustomDomainsForDeploy(
    tenantId: string, userId: string, projectId: string, feature: string,
  ): Promise<CustomDomain[]> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const byDeployKey = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_BY_DEPLOY, deployKey);
    const hostnames = await this.redis.smembers(byDeployKey);
    if (hostnames.length === 0) return [];
    const keys = hostnames.map(h => this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, h));
    const values = await this.redis.mget(...keys);

    // Clean up stale reverse-index members whose primary key is gone.
    const staleMembers = hostnames.filter((_, i) => values[i] === null);
    if (staleMembers.length > 0) {
      this.redis.srem(byDeployKey, ...staleMembers).catch(() => {});
      this.redis.srem(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_LIST, ...staleMembers).catch(() => {});
    }

    return values.filter((v): v is string => v !== null).map(v => JSON.parse(v) as CustomDomain);
  }

  async updateCustomDomainStatus(
    hostname: string,
    patch: Partial<Pick<CustomDomain, 'status' | 'certStatus' | 'error' | 'verifiedAt'>>,
  ): Promise<void> {
    const key = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, hostname.toLowerCase());
    const data = await this.redis.get(key);
    if (!data) return;
    const record: CustomDomain = JSON.parse(data);
    Object.assign(record, patch);
    await this.redis.set(key, JSON.stringify(record));
  }

  async deleteCustomDomain(hostname: string): Promise<void> {
    const h = hostname.toLowerCase();
    const key = this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, h);
    const data = await this.redis.get(key);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_LIST, h);
    if (data) {
      const record: CustomDomain = JSON.parse(data);
      const deployKey = createDeployKey(record.tenantId, record.userId, record.projectId, record.feature);
      pipeline.srem(this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_BY_DEPLOY, deployKey), h);
    }
    await pipeline.exec();
    logger.info(`[CustomDomain] Deleted: ${h}`, { component: 'RedisStateStore' });
  }

}
