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
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import { PIPELINE_ACTIVATIONS_DIRNAME } from '../../core/pipelines/paths';
import { resolveDefRoot } from '../../core/pipelines/scopeRoots';
import { loadActivationByProject, loadAvailability, loadPipeline } from '../../core/pipelines/store';

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

    for (const { dir, owner, projectId } of scanActivationDirs(deps.workspacesPath)) {
      try {
        const activation = loadActivationByProject(path.dirname(dir), projectId);
        if (!activation) continue;
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
      await healOverlapGuard(deps.stateStore, owner, projectId);
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

/** DEL the `ant:pipe:active` guard when its runId's doc is missing or terminal. */
async function healOverlapGuard(
  stateStore: StateStorePort,
  owner: PipelineOwner,
  projectId: string,
): Promise<void> {
  const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, projectId);
  const runId = await stateStore.getKey(activeKey);
  if (!runId) return;
  const raw = await stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
  const run = raw ? (JSON.parse(raw) as RunRecord) : null;
  const terminal =
    !run || ['completed', 'failed', 'partial', 'cancelled'].includes(run.status);
  if (terminal) {
    await stateStore.deleteKey(activeKey).catch(() => {});
    logger.info(`[Pipeline] healed stale overlap guard: ${projectId} (run ${runId})`, { component: COMPONENT });
  }
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
