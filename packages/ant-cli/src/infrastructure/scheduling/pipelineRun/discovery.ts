/**
 * Step fan-out — a discovering step's sealed `<cases>` become one run per
 * case (doc 46 §2, the delegated executor beside `on.fetch`'s deterministic
 * one). Two legs, both idempotent:
 *
 * - QUEUE (at the step's seal): every case is claimed AT ONCE — Redis NX +
 *   a queued ledger line (no runId, `queuedFrom` = the discovery run). Ant is
 *   the ONLY holder of this list (there is no source to re-ask, unlike a
 *   poll), so a case the activation has no room for is queued, never dropped.
 * - DRAIN (`case-drain` control job): fires queued cases as `concurrency`
 *   admits — kicked after the queue leg and after every run of the activation
 *   seals (a freed slot), re-armed while cases remain, re-kicked by the
 *   reconciler when it finds queued lines with no arm. Never throws.
 */

import { discoveryStepIndex, resolveRunConcurrency, type PipelineRunItem, type RunRecord } from '@ant/shared';
import { randomUUID } from 'crypto';
import type { PipelineCaseDrainJobData, PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import { deriveActivationsRoot } from '../../../core/pipelines/paths';
import { appendItemClaim, foldItemClaims, readItemClaims, type PipelineItemClaim } from '../../../core/pipelines/store';
import { loadFireAuthority } from './fire';
import { claimValue, ensureItemLedger, isDeadClaim } from './itemLedger';
import { appendEvent, tenantCtx } from './runStore';
import { COMPONENT, type PipelineRunOps } from './types';

/** Re-arm cadence while queued cases wait for room (a slot freeing kicks the drain sooner). */
export const CASE_DRAIN_DELAY_MS = 60_000;
/** One drain in flight per activation; a lapsed holder cannot free a successor's lock. */
export const CASE_DRAIN_LOCK_TTL_S = 120;

export function caseDrainArmId(owner: PipelineOwner, projectId: string): string {
  return `case-drain-${owner.organizationId}-${owner.userId}-${projectId}`;
}

/** Immediate drain — after the queue leg and after a run seals (its slot is free). */
export async function kickCaseDrain(ctx: PipelineRunOps, owner: PipelineOwner, run: Pick<RunRecord, 'pipelineId' | 'projectId' | 'activationSnapshot'>): Promise<void> {
  await ctx.deps.scheduleQueue.addNow({
    kind: 'case-drain',
    owner,
    pipelineId: run.pipelineId,
    pipelineScope: run.activationSnapshot?.pipelineScope ?? 'user',
    projectId: run.projectId,
  });
}

/**
 * Claim every discovered case up front. A key the ledger already holds
 * (queued, running or done) is skipped silently — that is the idempotency a
 * retried discovery step, or a source that keeps listing a handled case,
 * relies on. Fail-CLOSED on the projection (same posture as the poller).
 */
export async function queueDiscoveredCases(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  run: RunRecord,
  stepId: string,
  cases: readonly PipelineRunItem[],
): Promise<void> {
  const { organizationId, userId } = owner;
  const { projectId, pipelineId } = run;
  const actRoot = deriveActivationsRoot(tenantCtx(ctx.deps, owner));
  await ensureItemLedger(ctx.deps.stateStore, actRoot, owner, projectId, pipelineId);
  const now = new Date().toISOString();
  let queued = 0;
  let skipped = 0;
  for (const item of cases) {
    const itemKey = REDIS_KEYS.PIPE.ITEM(organizationId, userId, projectId, pipelineId, item.key);
    const value = claimValue(undefined, now);
    if (!(await ctx.deps.stateStore.tryAcquireLock(itemKey, value, REDIS_TTL.PIPE.ITEM))) {
      skipped += 1;
      continue;
    }
    try {
      await appendItemClaim(actRoot, projectId, pipelineId, { key: item.key, claimedAt: now, queuedFrom: run.runId, item });
      queued += 1;
    } catch (e) {
      // The disk line is the record — without it the projection would claim a case no drain can ever find.
      await ctx.deps.stateStore.releaseLockIfOwner(itemKey, value).catch(() => {});
      skipped += 1;
      logger.warn(`[Pipeline] fan-out queue line failed: ${item.key} (${pipelineId})`, { component: COMPONENT }, e);
    }
  }
  await appendEvent(ctx.deps, owner, projectId, {
    ts: now,
    event: 'cases_claimed',
    runId: run.runId,
    stepId,
    detail: { discovered: cases.length, queued, skipped },
  });
  logger.info(`[Pipeline] fan-out ${run.runId}/${stepId}: ${cases.length} cases, ${queued} queued, ${skipped} already claimed`, { component: COMPONENT });
  if (queued > 0) await kickCaseDrain(ctx, owner, run);
}

export async function handleCaseDrain(ctx: PipelineRunOps, data: PipelineCaseDrainJobData): Promise<void> {
  const { owner, pipelineId, projectId } = data;
  const { organizationId, userId } = owner;
  const authority = await loadFireAuthority(ctx, owner, pipelineId, projectId, 'drain');
  if (!authority) return;
  const { def, actRoot, activation } = authority;
  const at = discoveryStepIndex(def);
  if (at === undefined) {
    logger.info(`[Pipeline] drain skipped — ${pipelineId} has no discovers step (stale arm)`, { component: COMPONENT });
    return;
  }
  const discoveryStepId = def.steps[at].id;
  const lockKey = REDIS_KEYS.PIPE.CASE_DRAIN_LOCK(organizationId, userId, projectId);
  const lockToken = randomUUID();
  if (!(await ctx.deps.stateStore.tryAcquireLock(lockKey, lockToken, CASE_DRAIN_LOCK_TTL_S))) {
    logger.info(`[Pipeline] drain skipped — another drain holds ${projectId}`, { component: COMPONENT });
    return;
  }
  try {
    await ensureItemLedger(ctx.deps.stateStore, actRoot, owner, projectId, pipelineId);
    // Queued lines in discovery order, plus the heal: a case whose fire DIED
    // between promoting the claim and committing the run (started line, no
    // run doc, no run log, past grace) is re-queued — the poller's dead-claim
    // heal, except that here Ant holds the list, so re-admission is a line.
    const now = new Date().toISOString();
    const queued: PipelineItemClaim[] = [];
    for (const claim of foldItemClaims(readItemClaims(actRoot, projectId, pipelineId)).values()) {
      if (!claim.runId) {
        queued.push(claim);
        continue;
      }
      if (!claim.queuedFrom || !(await isDeadClaim(ctx.deps.stateStore, actRoot, projectId, claim))) continue;
      const requeued: PipelineItemClaim = { key: claim.key, claimedAt: now, queuedFrom: claim.queuedFrom, item: claim.item ?? { key: claim.key } };
      await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.ITEM(organizationId, userId, projectId, pipelineId, claim.key), claimValue(undefined, now), REDIS_TTL.PIPE.ITEM);
      await appendItemClaim(actRoot, projectId, pipelineId, requeued);
      logger.info(`[Pipeline] re-queued dead case claim: ${claim.key} (run ${claim.runId})`, { component: COMPONENT });
      queued.push(requeued);
    }
    if (queued.length === 0) return;
    // Soft pre-check — the fire path's slot reservation is the real gate.
    const live = await ctx.deps.stateStore.countSlots(REDIS_KEYS.PIPE.ACTIVE_RUNS(organizationId, userId, projectId));
    const room = Math.max(0, resolveRunConcurrency(def) - live);
    let enqueued = 0;
    for (const claim of queued.slice(0, room)) {
      if (!claim.queuedFrom) continue;
      await ctx.deps.scheduleQueue.addNow({
        kind: 'fire',
        owner,
        pipelineId,
        pipelineScope: activation.pipelineScope,
        projectId,
        firedBy: 'discovery',
        // Un-rounded: the fire NX key is the (parent run, case) identity, not this epoch.
        fireEpoch: Date.now(),
        item: claim.item ?? { key: claim.key },
        discoveryRunId: claim.queuedFrom,
        discoveryStepId,
      });
      enqueued += 1;
    }
    // Cases still waiting re-arm the drain; a run sealing meanwhile kicks it sooner.
    if (queued.length - enqueued > 0) {
      await ctx.deps.scheduleQueue.armDelayed(caseDrainArmId(owner, projectId), CASE_DRAIN_DELAY_MS, data);
    }
    logger.info(`[Pipeline] drain ${pipelineId} on ${projectId}: ${queued.length} queued, ${enqueued} fired (room ${room})`, { component: COMPONENT });
  } catch (e) {
    logger.warn(`[Pipeline] drain failed: ${pipelineId} on ${projectId}`, { component: COMPONENT }, e);
  } finally {
    await ctx.deps.stateStore.releaseLockIfOwner(lockKey, lockToken).catch(() => {});
  }
}
