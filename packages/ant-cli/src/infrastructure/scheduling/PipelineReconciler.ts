/**
 * Pipeline reconciliation — disk (SSOT) → BullMQ Job Scheduler projection.
 * StaleJobRecovery template: boot-time run + 90s interval, self-serialized by
 * a cluster lock inside the function. CRUD routes upsert/remove synchronously;
 * this is the safety net that heals a missed write, a hand-edited YAML, or a
 * scheduler orphaned by a deleted activation.
 *
 * The scheduling unit is the ACTIVATION: the scan walks
 * `{ws}/{org}/{user}/.ant/pipeline-activations/{projectId}/` — definition
 * dirs are never scanned for scheduling. A definition that no longer resolves
 * at the activation's pinned scope, fails validation, or is disabled is NOT
 * scheduled (logged; the API surfaces it as `broken`) — the activation file
 * itself is never auto-deleted.
 */

import * as fs from 'fs';
import * as path from 'path';
import { INDIVIDUAL_ORG_ID, parsePipelineDuration, type OrganizationKind, type RunRecord } from '@ant/shared';
import { logger } from '../../utils/logger';
import type { StateStorePort } from '../../core/ports/stateStore';
import type { ScheduleQueuePort, PipelineOwner, PipelineFireJobData, PipelineFetchPollJobData } from '../../core/ports/scheduler';
import { REDIS_DOMAINS, REDIS_KEYS, REDIS_TTL, parseRunSlotMember } from '../../core/constants/redis';
import { approverIndexEntry, approverUnion, replaceApproverIndex } from '../../core/pipelines/approverIndex';
import { PIPELINE_ACTIVATIONS_DIRNAME } from '../../core/pipelines/paths';
import { resolveDefRoot } from '../../core/pipelines/scopeRoots';
import { loadActivationByProject, loadAvailability, loadPipeline } from '../../core/pipelines/store';
import { finishTombstonedDeactivation, indexActivationProjection, readDeactivationTombstone, tombstoneCovers } from './resolveActivation';
import { pruneRunSessionFiles } from './pipelineRun/sessionRetention';
import { ensureItemLedger } from './pipelineRun/itemLedger';

const COMPONENT = 'PipelineReconciler';
const RECONCILE_LOCK_KEY = 'ant:lock:pipeline-reconcile';
const RECONCILE_LOCK_TTL = 60;
/**
 * A slot member whose run doc is missing is left alone this long after its
 * last reserve/refresh: the fire path holds both slots for a few round trips
 * (claim NX, ledger line) before `commitRun` writes the doc, and a reconcile
 * pass landing in that window must not free a live run's reservation.
 */
export const SLOT_HEAL_GRACE_MS = 5 * 60 * 1000;

/** Authorship sidecar written at definition-create time — never the fire identity. */
export const PIPELINE_OWNER_FILE = 'owner.json';

export function schedulerIdFor(owner: PipelineOwner, projectId: string): string {
  return `pipe|${owner.organizationId}|${owner.userId}|${projectId}`;
}

/** The fetch poller's scheduler id — same coordinates, its own prefix (both are swept). */
export function fetchSchedulerIdFor(owner: PipelineOwner, projectId: string): string {
  return `fetch|${owner.organizationId}|${owner.userId}|${projectId}`;
}

/** Scheduler ids the reconciler owns — anything else on the queue is another feature's. */
export function isPipelineSchedulerId(id: string): boolean {
  return id.startsWith('pipe|') || id.startsWith('fetch|');
}

export function readPipelineOwner(pipelineDir: string): PipelineOwner | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pipelineDir, PIPELINE_OWNER_FILE), 'utf-8'));
    if (raw?.userId && raw?.organizationId) {
      return {
        userId: raw.userId,
        organizationId: raw.organizationId,
        organizationKind: (raw.organizationKind ?? 'local') as OrganizationKind,
      };
    }
  } catch {
    /* absent/corrupt sidecar: authorship unknown */
  }
  return null;
}

/**
 * Activator coordinates from the activation dir's anchor org
 * (`{ws}/{org}/{user}/.ant/pipeline-activations/{projectId}`). Kind derives
 * from the org id: activations are anchored at the ACTIVE org context, so a
 * non-individual, non-local org id is a team org.
 */
function ownerFromActivationPath(workspacesPath: string, activationDir: string): PipelineOwner | null {
  const rel = path.relative(workspacesPath, activationDir).split(path.sep);
  if (rel.length < 4 || rel[0].startsWith('..')) return null;
  const [organizationId, userId] = rel;
  const organizationKind: OrganizationKind =
    organizationId === INDIVIDUAL_ORG_ID ? 'individual' : organizationId === 'local' ? 'local' : 'team';
  return { organizationId, userId, organizationKind };
}

export interface PipelineReconcilerDeps {
  stateStore: StateStorePort;
  scheduleQueue: ScheduleQueuePort;
  workspacesPath: string;
  /**
   * The activation project's universal container (`WorkspacePathResolver`
   * derivation, never re-spelled here). Absent = no session-file retention
   * pass (tests that only exercise scheduling).
   */
  containerPathOf?: (owner: PipelineOwner, projectId: string) => string;
}

export async function reconcilePipelines(deps: PipelineReconcilerDeps): Promise<void> {
  const acquired = await deps.stateStore.acquireLock(RECONCILE_LOCK_KEY, RECONCILE_LOCK_TTL);
  if (!acquired) return;
  try {
    // Every enabled+resolvable activation gets its projections refreshed —
    // the mutual-exclusion gate lives on `ant:pipe:proj` and fails OPEN on a
    // lapse, so a MANUAL-ONLY activation (no cron) must refresh too; only the
    // scheduler upsert is cron-gated.
    const wanted = new Map<
      string,
      { fire: PipelineFireJobData; schedule?: { cron: string; tz?: string }; fetchEveryMs?: number; activatedAt: string }
    >();

    // Approver-of discovery index rebuild — collected across the same scan,
    // written after it (`{org}\n{approverId}` → activation entries).
    const approverIndex = new Map<string, Set<string>>();

    for (const { dir, owner, projectId } of scanActivationDirs(deps.workspacesPath)) {
      try {
        const activation = loadActivationByProject(path.dirname(dir), projectId);
        if (!activation) continue;
        // A deactivate whose unlink this pod (or the deactivating pod) could
        // not see through lands here: finish the delete, never re-arm.
        if (tombstoneCovers(await readDeactivationTombstone(deps.stateStore, owner, projectId), activation)) {
          finishTombstonedDeactivation(path.dirname(dir), projectId);
          logger.info(`[Pipeline] finished tombstoned deactivation on ${projectId}`, { component: COMPONENT });
          continue;
        }
        for (const approverId of approverUnion(activation)) {
          const key = `${owner.organizationId}\n${approverId}`;
          const set = approverIndex.get(key) ?? new Set<string>();
          set.add(approverIndexEntry(owner.userId, projectId));
          approverIndex.set(key, set);
        }
        const defRoot = resolveDefRoot({ workspacesPath: deps.workspacesPath, ...owner }, activation.pipelineScope);
        const def = loadPipeline(defRoot, activation.pipelineId);
        if (!loadAvailability(defRoot, activation.pipelineId).enabled) {
          // Hand-disabled while activated (the API refuses this): unscheduled, surfaced as broken.
          logger.warn(
            `[Pipeline] activation on ${projectId} references disabled pipeline ${activation.pipelineId} — not scheduled`,
            { component: COMPONENT },
          );
          continue;
        }
        wanted.set(schedulerIdFor(owner, projectId), {
          fire: {
            kind: 'fire',
            owner,
            pipelineId: activation.pipelineId,
            pipelineScope: activation.pipelineScope,
            projectId,
            firedBy: 'cron',
          },
          ...(def.on?.schedule && { schedule: { cron: def.on.schedule.cron, tz: def.on.schedule.tz } }),
          ...(def.on?.fetch && { fetchEveryMs: parsePipelineDuration(def.on.fetch.every) ?? undefined }),
          activatedAt: activation.activatedAt,
        });
      } catch (e) {
        // Broken activation (unresolvable/invalid def or sidecar): never scheduled,
        // never auto-deleted — the API surfaces `broken` and the activator deactivates.
        logger.warn(`[Pipeline] skipping broken activation dir: ${dir}`, { component: COMPONENT }, e);
      }
    }

    const scheduled = new Set<string>();
    for (const [schedulerId, entry] of wanted) {
      if (entry.schedule) {
        await deps.scheduleQueue.upsertCron(schedulerId, entry.schedule.cron, entry.schedule.tz, entry.fire);
        scheduled.add(schedulerId);
      }
      const { owner, pipelineId, projectId } = entry.fire;
      if (entry.fetchEveryMs) {
        // A fetch activation polls on its own `every` scheduler; the claim
        // projection is rebuilt from the disk ledger whenever its marker lapsed.
        const fetchId = fetchSchedulerIdFor(owner, projectId);
        const poll: PipelineFetchPollJobData = { kind: 'fetch-poll', owner, pipelineId, pipelineScope: entry.fire.pipelineScope, projectId };
        await deps.scheduleQueue.upsertEvery(fetchId, entry.fetchEveryMs, poll);
        scheduled.add(fetchId);
        try {
          await ensureItemLedger(deps.stateStore, path.join(deps.workspacesPath, owner.organizationId, owner.userId, PIPELINE_ACTIVATIONS_DIRNAME), owner, projectId, pipelineId);
        } catch (e) {
          logger.warn(`[Pipeline] item ledger rebuild failed for ${projectId} (non-fatal)`, { component: COMPONENT }, e);
        }
      }
      // Refresh the activation projections — this is what keeps the job-start
      // mutual-exclusion gate alive (TTL > interval; lapse fails OPEN).
      await deps.stateStore.setKeyWithTTL(
        REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId),
        JSON.stringify({
          pipelineId,
          pipelineScope: entry.fire.pipelineScope,
          projectId,
          activatedAt: entry.activatedAt,
        }),
        REDIS_TTL.PIPE.ACTIVATION,
      );
      await deps.stateStore.setKeyWithTTL(
        REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId),
        pipelineId,
        REDIS_TTL.PIPE.ACTIVATION,
      );
      await indexActivationProjection(deps.stateStore, owner, projectId);
      // Overlap-guard healing: a coordinator crash between acquire and
      // finalize would otherwise block the activation until the 30d TTL.
      // Per-activation like its siblings — one Redis error must not end the pass.
      let liveRunIds: Set<string> | null = null;
      try {
        liveRunIds = await healOverlapGuard(deps.stateStore, owner, projectId);
      } catch (e) {
        logger.warn(`[Pipeline] live-run slot heal failed for ${projectId} (non-fatal)`, { component: COMPONENT }, e);
      }
      // Sealed run files accumulate one per run — keep the newest K per stem,
      // judged against the healed live set so a live run's file is never
      // touched; no healed set (heal failed) = no retention this pass.
      if (deps.containerPathOf && liveRunIds) {
        try {
          pruneRunSessionFiles(deps.containerPathOf(owner, projectId), liveRunIds);
        } catch (e) {
          logger.warn(`[Pipeline] run session retention failed for ${projectId} (non-fatal)`, { component: COMPONENT }, e);
        }
      }
    }

    // Approver-of index refresh (TTL-bounded like ACTIVATION — a roster whose
    // activation vanished simply lapses; entries are re-verified live anyway).
    for (const [key, entries] of approverIndex) {
      const [organizationId, approverId] = key.split('\n');
      await replaceApproverIndex(deps.stateStore, organizationId, approverId, [...entries]);
    }

    // Sweep against what was actually UPSERTED — a manual-only activation is
    // wanted (projections) but never scheduled, so its stale cron must go.
    const registered = await deps.scheduleQueue.listCronIds();
    for (const id of registered) {
      if (isPipelineSchedulerId(id) && !scheduled.has(id)) {
        await deps.scheduleQueue.removeCron(id);
        logger.info(`[Pipeline] removed orphan scheduler: ${id}`, { component: COMPONENT });
      }
    }
  } catch (err) {
    logger.warn('[Pipeline] reconciliation failed (non-fatal)', { component: COMPONENT }, err);
  } finally {
    await deps.stateStore.releaseLock(RECONCILE_LOCK_KEY).catch(() => {});
  }
}

/**
 * Release slot memberships whose run doc is missing or terminal — a
 * coordinator crash between reserve and finalize would otherwise hold the
 * activation's (and the account's) slot until the 30d TTL. A member with NO
 * doc is judged only past `SLOT_HEAL_GRACE_MS` from its last reserve/refresh
 * (derived from the member's expiry: every writer uses the ACTIVE TTL), so a
 * fire still committing keeps its slots. Returns the activation's live run
 * ids after healing (a member inside the grace counts as live).
 */
async function healOverlapGuard(
  stateStore: StateStorePort,
  owner: PipelineOwner,
  projectId: string,
): Promise<Set<string>> {
  const { organizationId, userId } = owner;
  const activeRunsKey = REDIS_KEYS.PIPE.ACTIVE_RUNS(organizationId, userId, projectId);
  const slotsKey = REDIS_KEYS.PIPE.RUN_SLOTS(organizationId, userId);
  const now = Date.now();
  const inGrace = (expiresAt: number): boolean => now - (expiresAt - REDIS_TTL.PIPE.ACTIVE * 1000) < SLOT_HEAL_GRACE_MS;
  const isLive = async (runId: string, expiresAt: number): Promise<boolean> => {
    const raw = await stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
    if (!raw) return inGrace(expiresAt);
    const run = JSON.parse(raw) as RunRecord;
    return !['completed', 'failed', 'partial', 'cancelled'].includes(run.status);
  };
  const live = new Set<string>();
  for (const { member: runId, expiresAt } of await stateStore.listSlotsWithExpiry(activeRunsKey)) {
    if (await isLive(runId, expiresAt)) {
      live.add(runId);
      continue;
    }
    await stateStore.releaseSlot(activeRunsKey, runId).catch(() => {});
    await stateStore.releaseSlot(slotsKey, REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, runId)).catch(() => {});
    logger.info(`[Pipeline] healed stale live-run slot: ${projectId} (run ${runId})`, { component: COMPONENT });
  }
  for (const { member, expiresAt } of await stateStore.listSlotsWithExpiry(slotsKey)) {
    const parsed = parseRunSlotMember(member);
    // Another project's member is not this activation's to judge.
    if (parsed?.projectId !== projectId) continue;
    if (await isLive(parsed.runId, expiresAt)) continue;
    await stateStore.releaseSlot(slotsKey, member).catch(() => {});
    logger.info(`[Pipeline] healed stale account slot: ${member}`, { component: COMPONENT });
  }
  // Migration shim (2026-09-16, delete after one release): the single-value
  // `ant:pipe:active:*` guard that preceded the slot set. A run live across the
  // deploy is admitted into both sets so the next fire cannot start a second
  // run on top of it; a terminal holder is simply dropped.
  const legacyKey = `${REDIS_DOMAINS.PIPE}:active:${organizationId}:${userId}:${projectId}`;
  const legacyRunId = await stateStore.getKey(legacyKey);
  if (legacyRunId) {
    if (await isLive(legacyRunId, 0)) {
      live.add(legacyRunId);
      await stateStore.reserveSlot(activeRunsKey, legacyRunId, Number.MAX_SAFE_INTEGER, REDIS_TTL.PIPE.ACTIVE);
      await stateStore.reserveSlot(
        slotsKey,
        REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, legacyRunId),
        Number.MAX_SAFE_INTEGER,
        REDIS_TTL.PIPE.ACTIVE,
      );
    }
    await stateStore.deleteKey(legacyKey).catch(() => {});
    logger.info(`[Pipeline] migrated legacy overlap guard: ${projectId} (run ${legacyRunId})`, { component: COMPONENT });
  }
  return live;
}

function scanActivationDirs(
  workspacesPath: string,
): Array<{ dir: string; owner: PipelineOwner; projectId: string }> {
  const out: Array<{ dir: string; owner: PipelineOwner; projectId: string }> = [];
  for (const orgDir of listDirs(workspacesPath)) {
    for (const userDir of listDirs(orgDir)) {
      const root = path.join(userDir, PIPELINE_ACTIVATIONS_DIRNAME);
      for (const activationDir of listDirs(root)) {
        const owner = ownerFromActivationPath(workspacesPath, activationDir);
        if (!owner) continue;
        out.push({ dir: activationDir, owner, projectId: path.basename(activationDir) });
      }
    }
  }
  return out;
}

function listDirs(parent: string): string[] {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(parent, e.name));
  } catch {
    return [];
  }
}
