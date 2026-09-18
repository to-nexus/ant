/**
 * The ONE read of "is this project activated, and with what" for the request
 * path. `activation.json` on disk stays the record (doc 46 §1); the Redis
 * projection (`ant:pipe:actv`) is a VISIBILITY BRIDGE for the window in which
 * another pod's NFS client has not yet seen a file that exists on the server
 * — a negative lookup cached at `activatable-projects` or the chat-lock read
 * answered ENOENT for a just-written activation, and the deactivate route
 * turned that into a 404 (2026-09-18 report). The deactivation tombstone
 * (`ant:pipe:deact`) outranks a projection older than it.
 */

import type { PipelineActivation } from '@ant/shared';
import { REDIS_KEYS } from '../../core/constants/redis';
import type { PipelineOwner } from '../../core/ports/scheduler';
import type { StateStorePort } from '../../core/ports/stateStore';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { deleteActivationRecord, loadActivationByProject } from '../../core/pipelines/store';

export interface DeactivationTombstone {
  pipelineId: string | null;
  /** ISO timestamp of the deactivate; a record activated at or before it is dead. */
  at: string;
}

export type ResolvedActivation =
  | { activation: PipelineActivation; source: 'disk' | 'projection'; unreadable: false }
  | { activation: null; source: null; unreadable: boolean };

export async function readDeactivationTombstone(
  stateStore: Pick<StateStorePort, 'getKey'>,
  owner: PipelineOwner,
  projectId: string,
): Promise<DeactivationTombstone | null> {
  try {
    const raw = await stateStore.getKey(REDIS_KEYS.PIPE.DEACTIVATED(owner.organizationId, owner.userId, projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeactivationTombstone>;
    return typeof parsed?.at === 'string' ? { pipelineId: parsed.pipelineId ?? null, at: parsed.at } : null;
  } catch {
    return null;
  }
}

/** `true` when the tombstone is at least as new as the record — the record is a not-yet-visible unlink. */
export function tombstoneCovers(tombstone: DeactivationTombstone | null, activation: Pick<PipelineActivation, 'activatedAt'>): boolean {
  if (!tombstone) return false;
  const at = Date.parse(tombstone.at);
  const activatedAt = Date.parse(activation.activatedAt);
  if (Number.isNaN(at)) return false;
  return Number.isNaN(activatedAt) || at >= activatedAt;
}

export async function resolveActivation(
  stateStore: Pick<StateStorePort, 'getKey'>,
  workspacesPath: string,
  owner: PipelineOwner,
  projectId: string,
): Promise<ResolvedActivation> {
  const actRoot = deriveActivationsRoot({ workspacesPath, ...owner });
  let onDisk: PipelineActivation | null;
  try {
    onDisk = loadActivationByProject(actRoot, projectId);
  } catch {
    return { activation: null, source: null, unreadable: true };
  }
  const tombstone = await readDeactivationTombstone(stateStore, owner, projectId);
  if (onDisk) {
    if (tombstoneCovers(tombstone, onDisk)) return { activation: null, source: null, unreadable: false };
    return { activation: onDisk, source: 'disk', unreadable: false };
  }
  let projected: PipelineActivation | null = null;
  try {
    const raw = await stateStore.getKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PipelineActivation>;
      if (typeof parsed?.pipelineId === 'string' && typeof parsed?.activatedAt === 'string') {
        projected = { ...parsed, projectId, pipelineScope: parsed.pipelineScope ?? 'user' } as PipelineActivation;
      }
    }
  } catch {
    projected = null;
  }
  if (projected && !tombstoneCovers(tombstone, projected)) {
    return { activation: projected, source: 'projection', unreadable: false };
  }
  return { activation: null, source: null, unreadable: false };
}

/**
 * The reconciler's leg of a deactivate: a record still on disk that a newer
 * tombstone covers is an unlink the deactivating pod could not see through
 * (NFS negative lookup) — finish it from a pod that sees the file. Schedulers
 * are the sweep's business (an unscheduled activation's ids are removed as
 * orphans), so this touches the record only.
 */
export function finishTombstonedDeactivation(actRoot: string, projectId: string): void {
  deleteActivationRecord(actRoot, projectId);
}
