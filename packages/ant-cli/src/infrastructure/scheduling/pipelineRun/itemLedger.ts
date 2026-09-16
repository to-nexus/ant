/**
 * The fetch trigger's claim ledger — disk is SSOT (`items/index.jsonl`, one
 * line per claimed item), Redis `ant:pipe:item:*` NX keys are its rebuildable
 * projection. `ensureItemLedger` rebuilds the projection when the
 * `items-built` marker is absent (boot, TTL lapse, new activation); the
 * poller is fail-CLOSED until it has run — a duplicate case costs credits and
 * a delayed poll costs nothing.
 *
 * A DEAD claim — older than the grace window with neither a run doc nor a run
 * log — is a fire that never produced a run (crash between claim and commit);
 * it is excluded from the rebuild and healed by the poller so the item is
 * seen again.
 */

import type { PipelineOwner } from '../../../core/ports/scheduler';
import type { StateStorePort } from '../../../core/ports/stateStore';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { hasRunLog, readItemClaims, type PipelineItemClaim } from '../../../core/pipelines/store';
import { logger } from '../../../utils/logger';
import { COMPONENT } from './types';

/** A claim younger than this is trusted even without a run doc (the fire is still committing). */
export const ITEM_CLAIM_GRACE_MS = 10 * 60 * 1000;

export type ItemLedgerStore = Pick<StateStorePort, 'exists' | 'getKey' | 'deleteKey' | 'tryAcquireLock' | 'setKeyWithTTL'>;

export function claimValue(runId: string, claimedAt: string): string {
  return JSON.stringify({ runId, claimedAt });
}

export function parseClaimValue(raw: string | null): { runId: string; claimedAt: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { runId?: unknown; claimedAt?: unknown };
    return typeof v.runId === 'string' && typeof v.claimedAt === 'string' ? { runId: v.runId, claimedAt: v.claimedAt } : null;
  } catch {
    return null;
  }
}

/** True when the claim is past grace and its run left no trace in Redis or on disk. */
export async function isDeadClaim(
  store: Pick<StateStorePort, 'getKey'>,
  actRoot: string,
  projectId: string,
  claim: Pick<PipelineItemClaim, 'runId' | 'claimedAt'>,
  now = Date.now(),
): Promise<boolean> {
  if (now - Date.parse(claim.claimedAt) < ITEM_CLAIM_GRACE_MS) return false;
  if (await store.getKey(REDIS_KEYS.PIPE.RUN(claim.runId))) return false;
  return !hasRunLog(actRoot, projectId, claim.runId);
}

/** Rebuild the claim projection from disk when the marker is absent. Returns whether a rebuild ran. */
export async function ensureItemLedger(
  store: ItemLedgerStore,
  actRoot: string,
  owner: PipelineOwner,
  projectId: string,
): Promise<boolean> {
  const { organizationId, userId } = owner;
  const marker = REDIS_KEYS.PIPE.ITEMS_BUILT(organizationId, userId, projectId);
  if (await store.exists(marker)) return false;
  let restored = 0;
  for (const claim of readItemClaims(actRoot, projectId)) {
    if (await isDeadClaim(store, actRoot, projectId, claim)) continue;
    if (await store.tryAcquireLock(REDIS_KEYS.PIPE.ITEM(organizationId, userId, projectId, claim.key), claimValue(claim.runId, claim.claimedAt), REDIS_TTL.PIPE.ITEM)) {
      restored += 1;
    }
  }
  await store.setKeyWithTTL(marker, new Date().toISOString(), REDIS_TTL.PIPE.ITEMS_BUILT);
  if (restored > 0) logger.info(`[Pipeline] rebuilt ${restored} item claims for ${projectId}`, { component: COMPONENT });
  return true;
}
