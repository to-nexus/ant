/**
 * Pipeline reconciliation — disk (SSOT) → BullMQ Job Scheduler projection.
 * StaleJobRecovery template: boot-time run + 90s interval, self-serialized by
 * a cluster lock inside the function. CRUD routes upsert/remove synchronously;
 * this is the safety net that heals a missed write, a hand-edited YAML, or a
 * scheduler orphaned by a deleted definition.
 */

import * as fs from 'fs';
import * as path from 'path';
import { INDIVIDUAL_ORG_ID, type OrganizationKind, type PipelineActivation, type RunRecord } from '@ant/shared';
import { logger } from '../../utils/logger';
import type { StateStorePort } from '../../core/ports/stateStore';
import type { ScheduleQueuePort, PipelineOwner } from '../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';
import { PIPELINES_DIRNAME } from '../../core/pipelines/paths';
import { loadActivation, loadPipeline } from '../../core/pipelines/store';

const COMPONENT = 'PipelineReconciler';
const RECONCILE_LOCK_KEY = 'ant:lock:pipeline-reconcile';
const RECONCILE_LOCK_TTL = 60;

/** Owner sidecar written at save time — never inferred at fire time. */
export const PIPELINE_OWNER_FILE = 'owner.json';

export function schedulerIdFor(owner: PipelineOwner, pipelineId: string): string {
  return `pipe|${owner.organizationId}|${owner.userId}|${pipelineId}`;
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
    /* fall through to path inference */
  }
  return null;
}

/** Path fallback for hand-authored dirs: `{ws}/{org}/{user}/.ant/pipelines/{id}`. */
function inferOwnerFromPath(workspacesPath: string, pipelineDir: string): PipelineOwner | null {
  const rel = path.relative(workspacesPath, pipelineDir).split(path.sep);
  if (rel.length < 4 || rel[0].startsWith('..')) return null;
  const [organizationId, userId] = rel;
  const organizationKind: OrganizationKind =
    organizationId === INDIVIDUAL_ORG_ID ? 'individual' : organizationId === 'local' ? 'local' : 'individual';
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
    const wanted = new Map<
      string,
      { owner: PipelineOwner; pipelineId: string; cron: string; tz?: string; activation: PipelineActivation }
    >();
    /** 1:1 healing — project → earliest-activated winner (hand-edited conflicts). */
    const projectWinners = new Map<string, { schedulerId: string; activatedAt: string }>();

    for (const { dir, owner, pipelineId } of scanPipelineDirs(deps.workspacesPath)) {
      try {
        const def = loadPipeline(path.dirname(dir), pipelineId);
        const activation = loadActivation(path.dirname(dir), pipelineId);
        if (!activation) continue;
        const schedulerId = schedulerIdFor(owner, pipelineId);
        const projectKey = `${owner.organizationId}:${owner.userId}:${activation.projectId}`;
        const incumbent = projectWinners.get(projectKey);
        if (incumbent && incumbent.activatedAt <= activation.activatedAt) {
          // Disk conflict (two activations naming one project): earliest wins;
          // the loser is logged and NOT scheduled/projected — SSOT is never
          // silently mutated.
          logger.warn(
            `[Pipeline] activation conflict on project ${activation.projectId}: ${schedulerId} loses to ${incumbent.schedulerId}`,
            { component: COMPONENT },
          );
          continue;
        }
        if (incumbent) {
          wanted.delete(incumbent.schedulerId);
          logger.warn(
            `[Pipeline] activation conflict on project ${activation.projectId}: ${incumbent.schedulerId} loses to ${schedulerId}`,
            { component: COMPONENT },
          );
        }
        projectWinners.set(projectKey, { schedulerId, activatedAt: activation.activatedAt });
        wanted.set(schedulerId, {
          owner,
          pipelineId,
          cron: def.on.schedule.cron,
          tz: def.on.schedule.tz,
          activation,
        });
      } catch (e) {
        // Invalid definition/sidecar: never scheduled; the editor surfaces the error.
        logger.warn(`[Pipeline] skipping invalid pipeline dir: ${dir}`, { component: COMPONENT }, e);
      }
    }

    for (const [schedulerId, entry] of wanted) {
      await deps.scheduleQueue.upsertCron(schedulerId, entry.cron, entry.tz, {
        kind: 'fire',
        owner: entry.owner,
        pipelineId: entry.pipelineId,
        firedBy: 'cron',
      });
      // Refresh the activation projections — this is what keeps the job-start
      // mutual-exclusion gate alive (TTL > interval; lapse fails OPEN).
      const { owner, pipelineId, activation } = entry;
      await deps.stateStore.setKeyWithTTL(
        REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, pipelineId),
        JSON.stringify(activation),
        REDIS_TTL.PIPE.ACTIVATION,
      );
      await deps.stateStore.setKeyWithTTL(
        REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, activation.projectId),
        pipelineId,
        REDIS_TTL.PIPE.ACTIVATION,
      );
      // Overlap-guard healing: a coordinator crash between acquire and
      // finalize would otherwise block the pipeline until the 30d TTL.
      await healOverlapGuard(deps.stateStore, owner, pipelineId);
    }

    const registered = await deps.scheduleQueue.listCronIds();
    for (const id of registered) {
      if (id.startsWith('pipe|') && !wanted.has(id)) {
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
  pipelineId: string,
): Promise<void> {
  const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, pipelineId);
  const runId = await stateStore.getKey(activeKey);
  if (!runId) return;
  const raw = await stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
  const run = raw ? (JSON.parse(raw) as RunRecord) : null;
  const terminal =
    !run || ['completed', 'failed', 'partial', 'cancelled', 'expired'].includes(run.status);
  if (terminal) {
    await stateStore.deleteKey(activeKey).catch(() => {});
    logger.info(`[Pipeline] healed stale overlap guard: ${pipelineId} (run ${runId})`, { component: COMPONENT });
  }
}

function scanPipelineDirs(workspacesPath: string): Array<{ dir: string; owner: PipelineOwner; pipelineId: string }> {
  const out: Array<{ dir: string; owner: PipelineOwner; pipelineId: string }> = [];
  for (const orgDir of listDirs(workspacesPath)) {
    for (const userDir of listDirs(orgDir)) {
      const root = path.join(userDir, PIPELINES_DIRNAME);
      for (const pipelineDir of listDirs(root)) {
        const pipelineId = path.basename(pipelineDir);
        const owner = readPipelineOwner(pipelineDir) ?? inferOwnerFromPath(workspacesPath, pipelineDir);
        if (!owner) continue;
        out.push({ dir: pipelineDir, owner, pipelineId });
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
