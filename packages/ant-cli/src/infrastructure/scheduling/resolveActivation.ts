/**
 * The ONE read of "is this project activated, and with what" for the request
 * path. `activation.json` on disk stays the record (doc 46 §1); the Redis
 * projection (`ant:pipe:actv`) is a VISIBILITY BRIDGE for the window in which
 * another pod's NFS client has not yet seen a file that exists on the server
 * — a negative lookup cached at `activatable-projects` or the chat-lock read
 * answered ENOENT for a just-written activation, and the deactivate route
 * turned that into a 404 (2026-09-18 report). The deactivation tombstone
 * (`ant:pipe:deact`) outranks a projection older than it.
 *
 * The LIST paths have the same blind spot one level up — a readdir on that
 * pod enumerates nothing for the project — so `listAccountActivationsResolved`
 * applies the per-project rule to the enumeration, finding the projections
 * through the `ant:pipe:actv-idx` index every projection writer maintains.
 */

import type { PipelineActivation } from '@ant/shared';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import type { PipelineOwner } from '../../core/ports/scheduler';
import type { StateStorePort } from '../../core/ports/stateStore';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { deleteActivationRecord, listAccountActivations, loadActivationByProject } from '../../core/pipelines/store';

/** The index is a set, not a budget — the cap only exists because the slot primitive takes one. */
const ACTIVATION_INDEX_LIMIT = 100_000;

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
 * Every writer of the `ant:pipe:actv` projection also indexes the project,
 * so the LIST readers below can find projections a readdir cannot. Best
 * effort: the projection stays a bridge, and a missed index entry only means
 * the disk view wins for that project.
 */
export async function indexActivationProjection(
  stateStore: Pick<StateStorePort, 'reserveSlot'>,
  owner: PipelineOwner,
  projectId: string,
): Promise<void> {
  try {
    await stateStore.reserveSlot(REDIS_KEYS.PIPE.ACTIVATION_INDEX(owner.organizationId, owner.userId), projectId, ACTIVATION_INDEX_LIMIT, REDIS_TTL.PIPE.ACTIVATION);
  } catch {
    /* index is best effort — the disk view stands */
  }
}

export async function unindexActivationProjection(
  stateStore: Pick<StateStorePort, 'releaseSlot'>,
  owner: PipelineOwner,
  projectId: string,
): Promise<void> {
  try {
    await stateStore.releaseSlot(REDIS_KEYS.PIPE.ACTIVATION_INDEX(owner.organizationId, owner.userId), projectId);
  } catch {
    /* a stale index entry resolves to nothing once its projection is gone */
  }
}

/**
 * The ONE enumeration of an account's activations for the list paths — the
 * per-project {@link resolveActivation} contract applied to a readdir: disk
 * records the tombstone covers are dropped, and a project the index names but
 * this pod's readdir cannot see is answered from its projection. Fails OPEN
 * to the disk view when Redis is unreachable.
 */
export async function listAccountActivationsResolved(
  stateStore: Pick<StateStorePort, 'getKey' | 'listSlots'>,
  workspacesPath: string,
  owner: PipelineOwner,
): Promise<PipelineActivation[]> {
  const actRoot = deriveActivationsRoot({ workspacesPath, ...owner });
  const out: PipelineActivation[] = [];
  const seen = new Set<string>();
  for (const activation of listAccountActivations(actRoot)) {
    seen.add(activation.projectId);
    if (tombstoneCovers(await readDeactivationTombstone(stateStore, owner, activation.projectId), activation)) continue;
    out.push(activation);
  }
  let indexed: string[] = [];
  try {
    indexed = await stateStore.listSlots(REDIS_KEYS.PIPE.ACTIVATION_INDEX(owner.organizationId, owner.userId));
  } catch {
    indexed = [];
  }
  for (const projectId of indexed) {
    if (seen.has(projectId)) continue;
    const resolved = await resolveActivation(stateStore, workspacesPath, owner, projectId);
    if (resolved.activation) out.push(resolved.activation);
  }
  return out.sort((a, b) => a.projectId.localeCompare(b.projectId));
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
