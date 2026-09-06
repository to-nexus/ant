/**
 * Approver-of DISCOVERY index — Redis projection mapping an org member to the
 * activations that name them a gate approver (`{ownerUserId}|{projectId}`
 * entries, gate-agnostic: the consumer re-reads the owner's activation.json
 * and filters per stepId there). Advisory by contract: resolve authority and
 * run reads always re-verify against the disk SSOT, so a stale entry grants
 * nothing — which is what lets it be TTL-bounded and reconciler-rebuilt.
 */

import type { PipelineActivation } from '@ant/shared';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis';
import type { StateStorePort } from '../ports/stateStore';

type KV = Pick<StateStorePort, 'getKey' | 'setKeyWithTTL' | 'deleteKey'>;

export function approverIndexEntry(ownerUserId: string, projectId: string): string {
  return `${ownerUserId}|${projectId}`;
}

export function parseApproverIndexEntry(entry: string): { ownerUserId: string; projectId: string } | null {
  const sep = entry.indexOf('|');
  if (sep <= 0 || sep === entry.length - 1) return null;
  return { ownerUserId: entry.slice(0, sep), projectId: entry.slice(sep + 1) };
}

/** Union of every gate's roster — the index is activation-grained on purpose. */
export function approverUnion(activation: Pick<PipelineActivation, 'approvers'> | null | undefined): string[] {
  if (!activation?.approvers) return [];
  return [...new Set(Object.values(activation.approvers).flat())];
}

export async function readApproverIndex(store: KV, organizationId: string, userId: string): Promise<string[]> {
  try {
    const raw = await store.getKey(REDIS_KEYS.PIPE.APPROVER_OF(organizationId, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

async function writeApproverIndex(store: KV, organizationId: string, userId: string, entries: string[]): Promise<void> {
  const key = REDIS_KEYS.PIPE.APPROVER_OF(organizationId, userId);
  if (entries.length === 0) {
    await store.deleteKey(key).catch(() => {});
    return;
  }
  await store.setKeyWithTTL(key, JSON.stringify(entries), REDIS_TTL.PIPE.APPROVER_OF);
}

/**
 * Reconcile ONE activation's entry across its previous and next rosters —
 * activate / approvers-PUT / deactivate all funnel here. Best-effort: an index
 * write failure never blocks the disk write it mirrors.
 */
export async function syncApproverIndexForActivation(
  store: KV,
  organizationId: string,
  ownerUserId: string,
  projectId: string,
  prevApprovers: string[],
  nextApprovers: string[],
): Promise<void> {
  const entry = approverIndexEntry(ownerUserId, projectId);
  const next = new Set(nextApprovers);
  const touched = new Set([...prevApprovers, ...nextApprovers]);
  for (const approverId of touched) {
    try {
      const entries = await readApproverIndex(store, organizationId, approverId);
      const has = entries.includes(entry);
      if (next.has(approverId) && !has) {
        await writeApproverIndex(store, organizationId, approverId, [...entries, entry]);
      } else if (!next.has(approverId) && has) {
        await writeApproverIndex(store, organizationId, approverId, entries.filter((e) => e !== entry));
      } else if (next.has(approverId)) {
        // Refresh the TTL so a live roster never lapses between reconciler passes.
        await writeApproverIndex(store, organizationId, approverId, entries);
      }
    } catch {
      /* advisory index — the reconciler rebuild heals it */
    }
  }
}

/** Full rebuild write for one (org, approver) — the reconciler's leg. */
export async function replaceApproverIndex(
  store: KV,
  organizationId: string,
  userId: string,
  entries: string[],
): Promise<void> {
  await writeApproverIndex(store, organizationId, userId, [...new Set(entries)]);
}
