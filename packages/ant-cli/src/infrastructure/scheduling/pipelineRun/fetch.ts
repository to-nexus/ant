/**
 * `fetch-poll` control job — the deterministic poller behind `on.fetch`.
 *
 * One poll: authority → claim ledger present (fail-CLOSED) → poll lock →
 * source call through the shared admission owner → room under `concurrency`
 * → for each unclaimed item up to `batch`, one `fire` control job carrying
 * the item. The FIRE path claims (Redis NX + disk line) after it holds both
 * slots, so a full activation claims nothing and the item is seen again next
 * poll — the source is the queue, Ant keeps only the claim ledger.
 *
 * Never throws: the control queue retries thrown jobs (attempts: 3) and a
 * retried poll is a wasted egress. Every exit records `FETCH_STATUS`.
 */

import {
  parsePipelineDuration,
  resolveRunConcurrency,
  type PipelineFetchStatus,
  type PipelineRunItem,
} from '@ant/shared';
import { randomUUID } from 'crypto';
import type { PipelineFetchPollJobData } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { REST_CALL_TIMEOUT_DEFAULT_MS } from '../../../core/customAgents/restApi';
import { logger } from '../../../utils/logger';
import { pollFetchSource } from '../../../core/pipelines/fetchConnection';
import { loadFireAuthority } from './fire';
import { ensureItemLedger, isDeadClaim, parseClaimValue } from './itemLedger';
import { publish, tenantCtx } from './runStore';
import { COMPONENT, type PipelineRunOps } from './types';

/**
 * The lock must outlive the longest poll: the source call (REST default
 * timeout) plus a ledger rebuild — a lock that lapses mid-poll lets a replica
 * start a second one, which is the duplicate the lock exists to stop.
 */
export const FETCH_LOCK_MIN_S = REST_CALL_TIMEOUT_DEFAULT_MS / 1000 + 60;
export const FETCH_LOCK_MAX_S = 180;

/** One poll in flight per activation, bounded by half the interval, clamped to FETCH_LOCK_MIN_S..FETCH_LOCK_MAX_S. */
export function fetchLockTtlSeconds(everyMs: number): number {
  return Math.min(FETCH_LOCK_MAX_S, Math.max(FETCH_LOCK_MIN_S, Math.floor(everyMs / 2000)));
}

export async function handleFetchPoll(ctx: PipelineRunOps, data: PipelineFetchPollJobData): Promise<void> {
  const { owner, pipelineId, projectId } = data;
  const { organizationId, userId } = owner;
  const authority = loadFireAuthority(ctx, owner, pipelineId, projectId, 'poll');
  if (!authority) return;
  const { def, actRoot } = authority;
  const trigger = def.on?.fetch;
  if (!trigger) {
    logger.info(`[Pipeline] poll skipped — ${pipelineId} has no fetch trigger (stale scheduler)`, { component: COMPONENT });
    return;
  }

  const record = async (status: Omit<PipelineFetchStatus, 'polledAt' | 'manual'>): Promise<void> => {
    const lastPoll: PipelineFetchStatus = { polledAt: new Date().toISOString(), ...status, ...(data.manual && { manual: true }) };
    try {
      await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.FETCH_STATUS(organizationId, userId, projectId), JSON.stringify(lastPoll), REDIS_TTL.PIPE.FETCH_STATUS);
    } catch (e) {
      logger.warn(`[Pipeline] poll status write failed: ${projectId}`, { component: COMPONENT }, e);
    }
    await publish(ctx.deps, owner, { cause: 'fetchPolled', pipelineId, projectId, lastPoll });
    if (lastPoll.error) logger.warn(`[Pipeline] poll ${pipelineId} on ${projectId}: ${lastPoll.error}`, { component: COMPONENT });
  };

  const lockKey = REDIS_KEYS.PIPE.FETCH_LOCK(organizationId, userId, projectId);
  const lockToken = randomUUID();
  const everyMs = parsePipelineDuration(trigger.every) ?? 60_000;
  if (!(await ctx.deps.stateStore.tryAcquireLock(lockKey, lockToken, fetchLockTtlSeconds(everyMs)))) {
    logger.info(`[Pipeline] poll skipped — another poll holds ${projectId}`, { component: COMPONENT });
    return;
  }
  try {
    // Fail-CLOSED on the claim projection: a duplicate case costs credits and
    // a person's time; rebuilding costs one ledger read. Idempotent (NX).
    await ensureItemLedger(ctx.deps.stateStore, actRoot, owner, projectId, pipelineId);

    const resolver = ctx.deps.credentialResolverFor?.(owner);
    if (!resolver) return void (await record({ seen: 0, unclaimed: 0, enqueued: 0, error: 'credential store unavailable in this process' }));

    const outcome = await pollFetchSource(
      { tenant: tenantCtx(ctx.deps, owner), credentialResolver: resolver, fetchImpl: ctx.deps.fetchImpl },
      trigger,
    );
    if (!outcome.ok) return void (await record({ seen: 0, unclaimed: 0, enqueued: 0, error: outcome.error }));
    const { items, seen } = outcome.extracted;

    // Soft pre-check — the fire path's slot reservation is the real gate; this
    // only stops the poll from enqueueing fires that would certainly skip.
    const live = await ctx.deps.stateStore.countSlots(REDIS_KEYS.PIPE.ACTIVE_RUNS(organizationId, userId, projectId));
    const room = Math.max(0, resolveRunConcurrency(def) - live);
    const take = Math.min(trigger.batch ?? 1, room);

    const unclaimed: PipelineRunItem[] = [];
    for (const item of items) {
      const itemKey = REDIS_KEYS.PIPE.ITEM(organizationId, userId, projectId, pipelineId, item.key);
      const claim = parseClaimValue(await ctx.deps.stateStore.getKey(itemKey));
      if (claim) {
        // A claim whose fire never produced a run (crash between claim and
        // commit) is healed here so the item is not lost to a 30-day TTL.
        if (!(await isDeadClaim(ctx.deps.stateStore, actRoot, projectId, claim))) continue;
        await ctx.deps.stateStore.deleteKey(itemKey).catch(() => {});
        logger.info(`[Pipeline] healed dead item claim: ${item.key} (run ${claim.runId})`, { component: COMPONENT });
      }
      unclaimed.push(item);
    }

    let enqueued = 0;
    const now = Date.now();
    for (const item of unclaimed.slice(0, take)) {
      await ctx.deps.scheduleQueue.addNow({
        kind: 'fire',
        owner,
        pipelineId,
        pipelineScope: authority.activation.pipelineScope,
        projectId,
        firedBy: 'fetch',
        fireEpoch: now,
        item,
      });
      enqueued += 1;
    }
    await record({ seen, unclaimed: unclaimed.length, enqueued });
  } catch (e) {
    await record({ seen: 0, unclaimed: 0, enqueued: 0, error: e instanceof Error ? e.message : String(e) });
  } finally {
    await ctx.deps.stateStore.releaseLockIfOwner(lockKey, lockToken).catch(() => {});
  }
}
