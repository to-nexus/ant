/**
 * The case claim ledger — disk is SSOT (`items/{pipelineId}.jsonl`, one line
 * per claim event, one ledger per pipeline so two pipelines run in turn on
 * one project never shadow each other's keys), Redis `ant:pipe:item:*` NX
 * keys are its rebuildable projection. `ensureItemLedger` rebuilds the
 * projection when the `items-built` marker is absent (boot, TTL lapse, new
 * activation) and re-sets the TTL of every claim it keeps, so an item still
 * open in the source past the claim TTL is not re-fired; the poller and the
 * drain are fail-CLOSED until it has run — a duplicate case costs credits and
 * a delayed poll costs nothing.
 *
 * Two claim shapes fold by key, newest wins (`foldItemClaims`):
 * - STARTED (`runId` set) — a fetch fire, or a discovery case the fire path
 *   promoted. A DEAD one — older than the grace window with neither a run
 *   doc nor a run log — is a fire that never produced a run (crash between
 *   claim and commit); it is excluded from the rebuild and healed by the
 *   poller so the item is seen again.
 * - QUEUED (`runId` absent, `queuedFrom` set) — a discovering step's sealed
 *   case waiting for room under `concurrency`. Ant is this list's only
 *   holder (no source to re-ask), so a queued line is never dead: the
 *   `case-drain` fires it when a slot frees.
 */

import type { PipelineOwner } from '../../../core/ports/scheduler';
import type { StateStorePort } from '../../../core/ports/stateStore';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { foldItemClaims, hasRunLog, readItemClaims, type PipelineItemClaim } from '../../../core/pipelines/store';
import { logger } from '../../../utils/logger';
import { COMPONENT } from './types';

/** A claim younger than this is trusted even without a run doc (the fire is still committing). */
export const ITEM_CLAIM_GRACE_MS = 10 * 60 * 1000;

export type ItemLedgerStore = Pick<StateStorePort, 'exists' | 'getKey' | 'setKeyWithTTL'>;

/** The projection value: `{runId, claimedAt}` for a started claim, `{claimedAt}` for a queued one. */
export function claimValue(runId: string | undefined, claimedAt: string): string {
  return JSON.stringify({ ...(runId && { runId }), claimedAt });
}

export function parseClaimValue(raw: string | null): { runId?: string; claimedAt: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { runId?: unknown; claimedAt?: unknown };
    if (typeof v.claimedAt !== 'string') return null;
    return typeof v.runId === 'string' ? { runId: v.runId, claimedAt: v.claimedAt } : { claimedAt: v.claimedAt };
  } catch {
    return null;
  }
}

/** True when a STARTED claim is past grace and its run left no trace in Redis or on disk. A queued claim is waiting, never dead. */
export async function isDeadClaim(
  store: Pick<StateStorePort, 'getKey'>,
  actRoot: string,
  projectId: string,
  claim: Pick<PipelineItemClaim, 'runId' | 'claimedAt'>,
  now = Date.now(),
): Promise<boolean> {
  if (!claim.runId) return false;
  if (now - Date.parse(claim.claimedAt) < ITEM_CLAIM_GRACE_MS) return false;
  if (await store.getKey(REDIS_KEYS.PIPE.RUN(claim.runId))) return false;
  return !hasRunLog(actRoot, projectId, claim.runId);
}

/** Queued cases of one pipeline (newest line per key, no run yet) in discovery order — the drain's FIFO. */
export function readQueuedCases(actRoot: string, projectId: string, pipelineId: string): PipelineItemClaim[] {
  return [...foldItemClaims(readItemClaims(actRoot, projectId, pipelineId)).values()].filter((c) => !c.runId);
}

/** Rebuild one pipeline's claim projection from disk when the marker is absent. Returns whether a rebuild ran. */
export async function ensureItemLedger(
  store: ItemLedgerStore,
  actRoot: string,
  owner: PipelineOwner,
  projectId: string,
  pipelineId: string,
): Promise<boolean> {
  const { organizationId, userId } = owner;
  const marker = REDIS_KEYS.PIPE.ITEMS_BUILT(organizationId, userId, projectId);
  if (await store.exists(marker)) return false;
  let restored = 0;
  // SET (not NX): a kept claim gets a fresh TTL, and the newest ledger line
  // for a key wins — the same order the fire path wrote them in.
  for (const claim of readItemClaims(actRoot, projectId, pipelineId)) {
    if (await isDeadClaim(store, actRoot, projectId, claim)) continue;
    await store.setKeyWithTTL(REDIS_KEYS.PIPE.ITEM(organizationId, userId, projectId, pipelineId, claim.key), claimValue(claim.runId, claim.claimedAt), REDIS_TTL.PIPE.ITEM);
    restored += 1;
  }
  await store.setKeyWithTTL(marker, new Date().toISOString(), REDIS_TTL.PIPE.ITEMS_BUILT);
  if (restored > 0) logger.info(`[Pipeline] rebuilt ${restored} item claims for ${projectId}/${pipelineId}`, { component: COMPONENT });
  return true;
}
