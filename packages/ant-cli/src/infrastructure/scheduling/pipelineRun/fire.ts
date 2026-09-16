/**
 * Cron/manual/event/fetch fire handling — activation authority, missed-fire
 * and overlap policy, the account-wide concurrent-run slot, the fetch item
 * claim, run creation.
 */

import {
  DEFAULT_PIPELINE_CAPS,
  MAX_CHAIN_DEPTH,
  resolveRunConcurrency,
  type PipelineActivation,
  type PipelineDef,
  type RunRecord,
} from '@ant/shared';
import type { PipelineFireJobData, PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { generateHumanId } from '../../../utils/humanId';
import { logger } from '../../../utils/logger';
import { buildInitialSteps, planAdvance } from '../../../core/pipelines/ChainExecutor';
import { deriveActivationsRoot } from '../../../core/pipelines/paths';
import { resolveDefRoot } from '../../../core/pipelines/scopeRoots';
import { appendItemClaim, loadActivationByProject, loadAvailability, loadPipeline, readRunIndex } from '../../../core/pipelines/store';
import { claimValue } from './itemLedger';
import { appendEvent, commitRun, tenantCtx } from './runStore';
import { COMPONENT, type PipelineRunOps } from './types';

/** A cron fire older than this is "missed" (worker downtime) — `onMissed` decides. */
const STALE_FIRE_MS = 10 * 60 * 1000;
const MAX_OVERLAP_REQUEUES = 60; // 60 × 60s = 1h of queueing before giving up

export interface FireAuthority {
  activation: PipelineActivation;
  def: PipelineDef;
  defRoot: string;
  actRoot: string;
}

/**
 * The activation is the fire authority — shared by the fire path and the
 * fetch poller. Null = skip (logged): no activation (orphan scheduler — the
 * reconciler removes it), a project that switched pipelines (stale), a
 * definition that no longer resolves at the PINNED scope, or a disabled
 * sidecar (the availability machine forbids this live; hand edits happen).
 */
export function loadFireAuthority(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  pipelineId: string,
  projectId: string,
  verb: 'fire' | 'poll' = 'fire',
): FireAuthority | null {
  const actRoot = deriveActivationsRoot(tenantCtx(ctx.deps, owner));
  let activation: PipelineActivation | null;
  try {
    activation = loadActivationByProject(actRoot, projectId);
  } catch (e) {
    logger.warn(`[Pipeline] ${verb} skipped — activation invalid: ${projectId}`, { component: COMPONENT }, e);
    return null;
  }
  if (!activation) {
    logger.info(`[Pipeline] ${verb} skipped — not activated: ${projectId}`, { component: COMPONENT });
    return null;
  }
  if (activation.pipelineId !== pipelineId) {
    logger.info(
      `[Pipeline] ${verb} skipped — project ${projectId} now runs ${activation.pipelineId}, not ${pipelineId}`,
      { component: COMPONENT },
    );
    return null;
  }
  // Definition resolves ONLY at the activation's pinned scope.
  const defRoot = resolveDefRoot(tenantCtx(ctx.deps, owner), activation.pipelineScope);
  let def: PipelineDef;
  try {
    def = loadPipeline(defRoot, pipelineId);
  } catch (e) {
    logger.warn(`[Pipeline] ${verb} skipped — definition invalid: ${pipelineId}`, { component: COMPONENT }, e);
    return null;
  }
  try {
    if (!loadAvailability(defRoot, pipelineId).enabled) {
      logger.warn(`[Pipeline] ${verb} skipped — pipeline disabled: ${pipelineId}`, { component: COMPONENT });
      return null;
    }
  } catch (e) {
    logger.warn(`[Pipeline] ${verb} skipped — availability unreadable: ${pipelineId}`, { component: COMPONENT }, e);
    return null;
  }
  return { activation, def, defRoot, actRoot };
}

export async function handleFire(ctx: PipelineRunOps, data: PipelineFireJobData, intendedFireAt: number): Promise<void> {
  const { owner, pipelineId, projectId } = data;
  const authority = loadFireAuthority(ctx, owner, pipelineId, projectId);
  if (!authority) return;
  const { activation, def, actRoot } = authority;

  // Chain-depth loop guard (caps doctrine: enforce at fire, skip + log).
  if ((data.chainDepth ?? 0) > MAX_CHAIN_DEPTH) {
    logger.warn(
      `[Pipeline] chained fire skipped — depth ${data.chainDepth} exceeds ${MAX_CHAIN_DEPTH}: ${pipelineId} on ${projectId}`,
      { component: COMPONENT },
    );
    return;
  }

  // A fetch fire is one claimed item — without one there is nothing to run.
  if (data.firedBy === 'fetch' && !data.item) {
    logger.warn(`[Pipeline] fetch fire skipped — no item: ${pipelineId} on ${projectId}`, { component: COMPONENT });
    return;
  }

  const fireEpoch = data.fireEpoch ?? Math.floor(intendedFireAt / 60_000) * 60_000;

  // Missed-fire policy (cron only; manual/event/fetch fires are always "now").
  if (data.firedBy === 'cron' && Date.now() - intendedFireAt > STALE_FIRE_MS) {
    if ((def.on?.schedule?.onMissed ?? 'skip') === 'skip') {
      logger.info(`[Pipeline] missed fire skipped: ${pipelineId} @ ${new Date(fireEpoch).toISOString()}`, { component: COMPONENT });
      return;
    }
  }

  // Fire idempotency (attempts:3 on the control queue + multi-replica). A poll
  // fires N items in the same instant, so a fetch fire's identity is the item.
  const firedKey = REDIS_KEYS.PIPE.FIRED(
    owner.organizationId,
    owner.userId,
    projectId,
    data.item ? `${fireEpoch}:${encodeURIComponent(data.item.key)}` : fireEpoch,
  );
  if (!(await ctx.deps.stateStore.acquireLock(firedKey, REDIS_TTL.PIPE.FIRED))) return;

  const runId = generateHumanId();

  // Per-ACTIVATION live-run slot — the definition's `concurrency` (1 today) is
  // the cap, judged and reserved in ONE step on a ZSET whose member is the run
  // (the same pipeline may run concurrently on other projects). Slots full ⇒
  // the overlap policy: `skip` drops the fire, `queue` re-arms it. Reserved
  // BEFORE the account slot so a queued re-arm never churns the account set.
  const activeRunsKey = REDIS_KEYS.PIPE.ACTIVE_RUNS(owner.organizationId, owner.userId, projectId);
  const admitted = await ctx.deps.stateStore.reserveSlot(
    activeRunsKey,
    runId,
    resolveRunConcurrency(def),
    REDIS_TTL.PIPE.ACTIVE,
  );
  if (!admitted) {
    const overlap = def.on?.schedule?.overlap ?? 'skip';
    // Release the fire NX so a queued re-arm (same fireEpoch) can pass it.
    await ctx.deps.stateStore.releaseLock(firedKey).catch(() => {});
    if (overlap === 'queue' && (data.requeues ?? 0) < MAX_OVERLAP_REQUEUES) {
      await ctx.deps.scheduleQueue.armDelayed(
        `fire-requeue-${owner.organizationId}-${owner.userId}-${projectId}-${fireEpoch}`,
        60_000,
        { ...data, fireEpoch, requeues: (data.requeues ?? 0) + 1 },
      );
    } else {
      // A fetch item is never queued: unclaimed, the next poll sees it again.
      logger.info(`[Pipeline] overlap skip: ${pipelineId} on ${projectId}`, { component: COMPONENT });
    }
    return;
  }

  // Cap: bound the activator's simultaneously-live runs across all of their
  // activations. Counted and reserved in ONE step — the previous shape read a
  // count, compared it, and only reserved much later, so two activations
  // firing at once both passed an N-1 cap (L-031). Same primitive, same
  // reasoning as the SSE connection slot (M-005). Member is the RUN, so N live
  // runs of one activation each hold a slot (a projectId member let them share one).
  const slotKey = REDIS_KEYS.PIPE.RUN_SLOTS(owner.organizationId, owner.userId);
  const reserved = await ctx.deps.stateStore.reserveSlot(
    slotKey,
    REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, runId),
    DEFAULT_PIPELINE_CAPS.maxConcurrentRuns,
    REDIS_TTL.PIPE.ACTIVE,
  );
  const releaseSlots = async () => {
    await ctx.deps.stateStore.releaseSlot(activeRunsKey, runId).catch(() => {});
    await ctx.deps.stateStore.releaseLock(firedKey).catch(() => {});
  };
  if (!reserved) {
    logger.warn(
      `[Pipeline] fire skipped — maxConcurrentRuns reached (${DEFAULT_PIPELINE_CAPS.maxConcurrentRuns}): ${pipelineId}`,
      { component: COMPONENT },
    );
    await releaseSlots();
    return;
  }

  // The item CLAIM — after both slots, so a full activation never claims what
  // it cannot run (the item stays in the source for the next poll). Redis NX is
  // the race arbiter; the disk ledger line is the record the projection is
  // rebuilt from. Either failing gives everything back, in reverse.
  const startedAt = new Date().toISOString();
  if (data.item) {
    const itemKey = REDIS_KEYS.PIPE.ITEM(owner.organizationId, owner.userId, projectId, data.item.key);
    const claimed = await ctx.deps.stateStore.tryAcquireLock(itemKey, claimValue(runId, startedAt), REDIS_TTL.PIPE.ITEM);
    if (!claimed) {
      logger.info(`[Pipeline] fetch fire skipped — item already claimed: ${data.item.key} (${pipelineId})`, { component: COMPONENT });
      await ctx.deps.stateStore.releaseSlot(slotKey, REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, runId)).catch(() => {});
      await releaseSlots();
      return;
    }
    try {
      await appendItemClaim(actRoot, projectId, { key: data.item.key, runId, claimedAt: startedAt });
    } catch (e) {
      logger.warn(`[Pipeline] fetch fire aborted — claim ledger append failed: ${data.item.key}`, { component: COMPONENT }, e);
      await ctx.deps.stateStore.releaseLockIfOwner(itemKey, claimValue(runId, startedAt)).catch(() => {});
      await ctx.deps.stateStore.releaseSlot(slotKey, REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, runId)).catch(() => {});
      await releaseSlots();
      return;
    }
  }

  // Cross-run watermark, frozen at fire so every step of this run sees the
  // same value ({{run.prevSuccess.*}}): the newest COMPLETED run of this
  // pipeline on this activation. Meaningless per item — a fetch run has none.
  let prevSuccessFireEpoch: number | undefined;
  if (!data.item) {
    try {
      prevSuccessFireEpoch = readRunIndex(actRoot, projectId, 50, pipelineId).find((e) => e.status === 'completed')?.fireEpoch;
    } catch {
      prevSuccessFireEpoch = undefined;
    }
  }

  const run: RunRecord = {
    runId,
    pipelineId,
    projectId,
    firedBy: data.firedBy,
    fireEpoch,
    status: 'running',
    steps: buildInitialSteps(def),
    startedAt,
    defSnapshot: def,
    activationSnapshot: activation,
    ...(prevSuccessFireEpoch !== undefined && { prevSuccessFireEpoch }),
    ...(data.chainDepth !== undefined && { chainDepth: data.chainDepth }),
    ...(data.item && { item: data.item }),
  };

  await appendEvent(ctx.deps, owner, projectId, { ts: run.startedAt, event: 'fired', runId, detail: { firedBy: run.firedBy, fireEpoch, projectId } });
  if (data.item) {
    await appendEvent(ctx.deps, owner, projectId, { ts: run.startedAt, event: 'item_claimed', runId, detail: { key: data.item.key } });
  }
  const plan = planAdvance(def, run);
  await commitRun(ctx.deps, owner, plan.run);
  await ctx.executeDispatches(owner, def, plan.run, plan.dispatches);
}
