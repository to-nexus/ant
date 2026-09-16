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
import { INDIVIDUAL_ORG_ID, type OrganizationKind, type RunRecord } from '@ant/shared';
import { logger } from '../../utils/logger';
import type { StateStorePort } from '../../core/ports/stateStore';
import type { ScheduleQueuePort, PipelineOwner, PipelineFireJobData } from '../../core/ports/scheduler';
import { REDIS_DOMAINS, REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import { approverIndexEntry, approverUnion, replaceApproverIndex } from '../../core/pipelines/approverIndex';
import { PIPELINE_ACTIVATIONS_DIRNAME } from '../../core/pipelines/paths';
import { resolveDefRoot } from '../../core/pipelines/scopeRoots';
import { loadActivationByProject, loadAvailability, loadPipeline } from '../../core/pipelines/store';
import { pruneRunSessionFiles } from './pipelineRun/sessionRetention';

const COMPONENT = 'PipelineReconciler';
const RECONCILE_LOCK_KEY = 'ant:lock:pipeline-reconcile';
const RECONCILE_LOCK_TTL = 60;

/** Authorship sidecar written at definition-create time — never the fire identity. */
export const PIPELINE_OWNER_FILE = 'owner.json';

export function schedulerIdFor(owner: PipelineOwner, projectId: string): string {
  return `pipe|${owner.organizationId}|${owner.userId}|${projectId}`;
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
      { fire: PipelineFireJobData; schedule?: { cron: string; tz?: string }; activatedAt: string }
    >();

    // Approver-of discovery index rebuild — collected across the same scan,
    // written after it (`{org}\n{approverId}` → activation entries).
    const approverIndex = new Map<string, Set<string>>();

    for (const { dir, owner, projectId } of scanActivationDirs(deps.workspacesPath)) {
      try {
        const activation = loadActivationByProject(path.dirname(dir), projectId);
        if (!activation) continue;
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
      // Refresh the activation projections — this is what keeps the job-start
      // mutual-exclusion gate alive (TTL > interval; lapse fails OPEN).
      const { owner, pipelineId, projectId } = entry.fire;
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
      // Overlap-guard healing: a coordinator crash between acquire and
      // finalize would otherwise block the activation until the 30d TTL.
      const liveRunIds = await healOverlapGuard(deps.stateStore, owner, projectId);
      // Sealed run files accumulate one per run — keep the newest K per stem,
      // judged against the healed live set so a live run's file is never touched.
      if (deps.containerPathOf) {
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
      if (id.startsWith('pipe|') && !scheduled.has(id)) {
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
 * activation's (and the account's) slot until the 30d TTL. Returns the
 * activation's live run ids after healing.
 */
async function healOverlapGuard(
  stateStore: StateStorePort,
  owner: PipelineOwner,
  projectId: string,
): Promise<Set<string>> {
  const { organizationId, userId } = owner;
  const activeRunsKey = REDIS_KEYS.PIPE.ACTIVE_RUNS(organizationId, userId, projectId);
  const slotsKey = REDIS_KEYS.PIPE.RUN_SLOTS(organizationId, userId);
  const isLive = async (runId: string): Promise<boolean> => {
    const raw = await stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
    const run = raw ? (JSON.parse(raw) as RunRecord) : null;
    return !!run && !['completed', 'failed', 'partial', 'cancelled'].includes(run.status);
  };
  const live = new Set<string>();
  for (const runId of await stateStore.listSlots(activeRunsKey)) {
    if (await isLive(runId)) {
      live.add(runId);
      continue;
    }
    await stateStore.releaseSlot(activeRunsKey, runId).catch(() => {});
    await stateStore.releaseSlot(slotsKey, REDIS_KEYS.PIPE.RUN_SLOT_MEMBER(projectId, runId)).catch(() => {});
    logger.info(`[Pipeline] healed stale live-run slot: ${projectId} (run ${runId})`, { component: COMPONENT });
  }
  const prefix = `${projectId}:`;
  for (const member of await stateStore.listSlots(slotsKey)) {
    if (!member.startsWith(prefix)) continue;
    const runId = member.slice(prefix.length);
    if (await isLive(runId)) continue;
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
    if (await isLive(legacyRunId)) {
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
