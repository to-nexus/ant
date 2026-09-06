/**
 * RedisStateStore
 *
 * Redis-based implementation of StateStorePort + PortRegistryPort. Suitable
 * for cloud/distributed deployments: persistent, shared across instances,
 * real-time pub/sub, automatic reconnection.
 *
 * The implementation is an inheritance chain of domain layers under
 * `redisStore/` (core → jobs → kv → deploy → preview → ide → turnBuffer →
 * sessionState); this top class adds the CROSS-domain cleanup sweeps — the
 * one cluster that must reach every domain's keys — and declares the ports.
 *
 * @see 10-cloud-scalability-design.md Section 4.1
 */

import type { StateStorePort } from '../../core/ports/stateStore';
import type { PortRegistryPort } from '../../core/ports/portRegistry';
import { REDIS_KEYS } from './redisConstants';
import { createDeployKey, parseDeployKey, parseIDEKey, parsePreviewKey } from './redisKeyUtils';
import { logger } from '../../utils/logger';
import { RedisSessionStateStore } from './redisStore/RedisSessionStateStore';

export type { RedisStateStoreOptions } from './redisStore/RedisCoreStore';

export class RedisStateStore extends RedisSessionStateStore implements StateStorePort, PortRegistryPort {
  async cleanupProject(
    organizationId: string,
    userId: string,
    projectId: string,
  ): Promise<void> {
    logger.info(`[StateStore] cleanupProject start`, { component: 'RedisStateStore' }, { organizationId, userId, projectId });

    // 1) Job-related keys via INDEX.JOBS_BY_FEATURE:{projectId}:* SETs.
    try {
      const jobsByFeaturePattern = `${REDIS_KEYS.INDEX.JOBS_BY_FEATURE}${organizationId}:${userId}:${projectId}:*`;
      let cursor = '0';
      const indexKeys: string[] = [];
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', jobsByFeaturePattern, 'COUNT', 100);
        cursor = next;
        indexKeys.push(...keys);
      } while (cursor !== '0');

      const jobIdSet = new Set<string>();
      for (const idxKey of indexKeys) {
        const ids = await this.redis.smembers(idxKey);
        for (const id of ids) jobIdSet.add(id);
      }

      const pipeline = this.redis.pipeline();
      for (const jobId of jobIdSet) {
        pipeline.del(this.key(REDIS_KEYS.JOB.STATUS, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.TASK_QUEUE_CHECKPOINT, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.MAPPING, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.USER_STOPPED, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.WORKFLOW, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.KILL_REASON, jobId));
      }
      // Drop the index sets themselves.
      for (const idxKey of indexKeys) {
        pipeline.del(idxKey);
      }
      if (jobIdSet.size > 0 || indexKeys.length > 0) {
        await pipeline.exec();
      }

      logger.debug(`[StateStore] cleaned ${jobIdSet.size} job(s) across ${indexKeys.length} feature index(es)`, {
        component: 'RedisStateStore',
      }, { projectId });
    } catch (err) {
      logger.warn(`[StateStore] job-key cleanup failed (continuing)`, { component: 'RedisStateStore' }, { projectId, err });
    }

    // 2) Infra IDE / Preview / Deploy entries — SCAN each prefix, parse the
    //    portKey tail, drop entries whose project matches.
    const infraSweep = async (
      prefix: string,
      parser: (key: string) => { tenantId: string; userId: string; projectId: string } | null,
      listSetKey?: string,
      byPodPrefix?: string,
    ): Promise<number> => {
      let cursor = '0';
      const matches: string[] = [];
      const pattern = `${prefix}*`;
      try {
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = next;
          for (const fullKey of keys) {
            const tail = fullKey.substring(prefix.length);
            const parsed = parser(tail);
            if (!parsed) continue;
            if (
              parsed.projectId === projectId &&
              parsed.tenantId === organizationId &&
              parsed.userId === userId
            ) {
              matches.push(fullKey);
            }
          }
        } while (cursor !== '0');

        if (matches.length === 0) return 0;
        const pipeline = this.redis.pipeline();
        for (const k of matches) {
          pipeline.del(k);
          if (listSetKey) {
            const tail = k.substring(prefix.length);
            pipeline.srem(listSetKey, tail);
          }
        }
        await pipeline.exec();

        // Cleanup byPod indexes — best effort, scan + srem for every pod set.
        if (byPodPrefix) {
          let podCursor = '0';
          do {
            const [next, podKeys] = await this.redis.scan(podCursor, 'MATCH', `${byPodPrefix}*`, 'COUNT', 100);
            podCursor = next;
            for (const podSet of podKeys) {
              for (const k of matches) {
                const tail = k.substring(prefix.length);
                await this.redis.srem(podSet, tail).catch(() => undefined);
              }
            }
          } while (podCursor !== '0');
        }
        return matches.length;
      } catch (err) {
        logger.warn(`[StateStore] infra sweep failed`, { component: 'RedisStateStore' }, { prefix, err });
        return 0;
      }
    };

    const ideCount = await infraSweep(
      REDIS_KEYS.INFRA.IDE,
      (tail) => parseIDEKey(tail),
      REDIS_KEYS.INFRA.IDE_LIST,
    );
    const ideInstanceCount = await infraSweep(
      REDIS_KEYS.INFRA.IDE_INSTANCE,
      (tail) => parseIDEKey(tail),
    );
    const ideLastAccessCount = await infraSweep(
      REDIS_KEYS.INFRA.IDE_LAST_ACCESS,
      (tail) => parseIDEKey(tail),
    );
    const previewCount = await infraSweep(
      REDIS_KEYS.INFRA.PREVIEW,
      (tail) => parsePreviewKey(tail),
      REDIS_KEYS.INFRA.PREVIEW_LIST,
      REDIS_KEYS.INFRA.PREVIEW_BY_POD,
    );
    const previewConfigCount = await infraSweep(
      REDIS_KEYS.INFRA.PREVIEW_CONFIG,
      (tail) => parsePreviewKey(tail),
    );
    const deployCount = await infraSweep(
      REDIS_KEYS.INFRA.DEPLOY,
      (tail) => parseDeployKey(tail),
      REDIS_KEYS.INFRA.DEPLOY_LIST,
    );

    // Custom domains — keyed by hostname (not portKey), so infraSweep can't
    // parse them. Sweep via the per-deploy reverse index instead.
    const customDomainCount = await this.sweepCustomDomains((deployKey) => {
      const parsed = parseDeployKey(deployKey);
      return !!parsed && parsed.projectId === projectId && parsed.tenantId === organizationId && parsed.userId === userId;
    });

    logger.info(`[StateStore] cleanupProject done`, { component: 'RedisStateStore' }, {
      projectId,
      ideCount,
      ideInstanceCount,
      ideLastAccessCount,
      previewCount,
      previewConfigCount,
      deployCount,
      customDomainCount,
    });
  }

  /**
   * Delete custom-domain records (+ list/reverse-index members) whose owning
   * deployKey matches the predicate. Best-effort; used by cleanup cascades.
   */
  private async sweepCustomDomains(matchDeployKey: (deployKey: string) => boolean): Promise<number> {
    const prefix = REDIS_KEYS.INFRA.CUSTOM_DOMAIN_BY_DEPLOY;
    let cursor = '0';
    let removed = 0;
    try {
      const byDeploySets: string[] = [];
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        for (const fullKey of keys) {
          const deployKey = fullKey.substring(prefix.length);
          if (matchDeployKey(deployKey)) byDeploySets.push(fullKey);
        }
      } while (cursor !== '0');

      for (const byDeployKey of byDeploySets) {
        const hostnames = await this.redis.smembers(byDeployKey);
        const pipeline = this.redis.pipeline();
        for (const h of hostnames) {
          pipeline.del(this.key(REDIS_KEYS.INFRA.CUSTOM_DOMAIN, h));
          pipeline.srem(REDIS_KEYS.INFRA.CUSTOM_DOMAIN_LIST, h);
        }
        pipeline.del(byDeployKey);
        await pipeline.exec();
        removed += hostnames.length;
      }
    } catch (err) {
      logger.warn(`[StateStore] custom-domain sweep failed`, { component: 'RedisStateStore' }, { err });
    }
    return removed;
  }

  /**
   * Feature-scoped Redis cleanup. See `StateStorePort.cleanupFeature` for
   * the scope contract — touches only the one feature's `jobsByFeature`
   * index entry and any residual JOB.* keys it points to. Errors logged +
   * swallowed; the deleteFeature fsVerify phase is the final guard.
   */
  /**
   * Purge-only sweep of the keys `cleanupProject` cannot reach: they are keyed
   * by (org,user) or by user alone, not by project. Best-effort — every arm
   * logs and continues, because a half-swept cache is strictly better than a
   * purge that aborts before the identity tombstone.
   */
  async cleanupUserScope(organizationId: string, userId: string): Promise<number> {
    let deleted = 0;

    const scanDel = async (pattern: string): Promise<void> => {
      let cursor = '0';
      const keys: string[] = [];
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
      if (keys.length === 0) return;
      const pipeline = this.redis.pipeline();
      keys.forEach((k) => pipeline.del(k));
      await pipeline.exec();
      deleted += keys.length;
    };

    const arm = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        logger.warn(
          `[StateStore] cleanupUserScope ${label} failed (continuing)`,
          { component: 'RedisStateStore' },
          { organizationId, userId, err },
        );
      }
    };

    await arm('runSlots', async () => {
      const key = REDIS_KEYS.PIPE.RUN_SLOTS(organizationId, userId);
      deleted += await this.redis.del(key);
    });

    await arm('baselines', () =>
      scanDel(`${REDIS_KEYS.BASELINE}:${organizationId}:${userId}:*`),
    );

    // Artifact caches are keyed by userId alone (no org segment).
    await arm('artifacts', async () => {
      await scanDel(`${REDIS_KEYS.ARTIFACTS.UNSEEN}${userId}:*`);
      await scanDel(`${REDIS_KEYS.ARTIFACTS.FILETREE}${userId}:*`);
    });

    // Transfers are two-sided: dropping only this user's index would leave the
    // counterparty's list holding request ids that resolve to nothing.
    await arm('transfers', async () => {
      const mine = `${organizationId}:${userId}`;
      const sentKey = `${REDIS_KEYS.TRANSFER.BY_SENDER}${mine}`;
      const recvKey = `${REDIS_KEYS.TRANSFER.BY_RECIPIENT}${mine}`;
      const requestIds = [
        ...new Set([
          ...(await this.redis.smembers(sentKey)),
          ...(await this.redis.smembers(recvKey)),
        ]),
      ];
      for (const id of requestIds) {
        const reqKey = `${REDIS_KEYS.TRANSFER.REQUEST}${id}`;
        const raw = await this.redis.get(reqKey);
        if (raw) {
          try {
            const tr = JSON.parse(raw) as {
              sender: { orgId: string; userId: string };
              recipient: { orgId: string; userId: string };
            };
            for (const [side, prefix] of [
              [tr.sender, REDIS_KEYS.TRANSFER.BY_SENDER],
              [tr.recipient, REDIS_KEYS.TRANSFER.BY_RECIPIENT],
            ] as const) {
              await this.redis.srem(`${prefix}${side.orgId}:${side.userId}`, id);
            }
          } catch {
            /* corrupt record — the DEL below still removes it */
          }
        }
        deleted += await this.redis.del(reqKey);
      }
      deleted += await this.redis.del(sentKey);
      deleted += await this.redis.del(recvKey);
    });

    logger.info(
      `[StateStore] cleanupUserScope removed ${deleted} key(s)`,
      { component: 'RedisStateStore' },
      { organizationId, userId },
    );
    return deleted;
  }

  async cleanupFeature(
    organizationId: string,
    userId: string,
    projectId: string,
    featureName: string,
  ): Promise<void> {
    logger.info(`[StateStore] cleanupFeature start`, { component: 'RedisStateStore' }, {
      organizationId,
      userId,
      projectId,
      featureName,
    });

    try {
      const indexKey = this.jobsByFeatureKey({ organizationId, userId }, projectId, featureName);
      const jobIds = await this.redis.smembers(indexKey);

      const pipeline = this.redis.pipeline();
      for (const jobId of jobIds) {
        pipeline.del(this.key(REDIS_KEYS.JOB.STATUS, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.TASK_QUEUE_CHECKPOINT, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.MAPPING, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.USER_STOPPED, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.WORKFLOW, jobId));
        pipeline.del(this.key(REDIS_KEYS.JOB.KILL_REASON, jobId));
      }
      pipeline.del(indexKey);

      if (jobIds.length > 0) {
        await pipeline.exec();
      } else {
        // Index key may still exist as an empty set or be already absent —
        // a bare DEL is cheap and idempotent.
        await this.redis.del(indexKey);
      }

      // Custom domains attached to THIS feature's deploy.
      const featureDeployKey = createDeployKey(organizationId, userId, projectId, featureName);
      const customDomainCount = await this.sweepCustomDomains((dk) => dk === featureDeployKey);

      logger.info(`[StateStore] cleanupFeature done`, { component: 'RedisStateStore' }, {
        projectId,
        featureName,
        jobCount: jobIds.length,
        customDomainCount,
      });
    } catch (err) {
      logger.warn(`[StateStore] cleanupFeature failed (continuing)`, { component: 'RedisStateStore' }, {
        projectId,
        featureName,
        err,
      });
    }
  }

}
