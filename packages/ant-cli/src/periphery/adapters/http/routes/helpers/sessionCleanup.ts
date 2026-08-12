import * as fs from 'fs';
import * as path from 'path';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { KanbanService } from '../../services';
import type { KanbanData, SessionableJobType } from '@ant/shared';
import type { SessionRun, SessionRunStatus } from '../../../../../core/types/session';
import { logger } from '../../../../../utils/logger';
import {
  getSessionFilePathByJob,
  getAgentForJob,
  getSessionDebugDir,
  getAllSessionPaths,
  DEBUG_SUBDIRS,
} from '../../../../../core/utils/sessionPaths';
import { atomicWriteFile } from '../../../../../core/utils/atomicWriteFile';
import { wouldRegressRun } from '../../../../../core/utils/sessionRunGuard';
import { deleteArchivedState } from '../../../../../core/session/archive';

/**
 * Append (or upsert) a per-jobId kanban snapshot into the session file's
 * `runs[]` array so the Job-tab dropdown can restore the kanban for past
 * jobs whose Redis state has expired.
 *
 * Behavior:
 *   - If a `runs[i]` with the same `jobId` already exists, its
 *     `kanbanSnapshot`, `status`, and `completedAt` are overwritten.
 *   - Otherwise a minimal new run is appended (runId = runs.length + 1).
 *
 * Silent no-op when the session file is missing or malformed — this is a
 * best-effort UX enhancement, not a correctness requirement.
 */
export async function appendJobSnapshotToSession(
  featurePath: string,
  jobType: SessionableJobType,
  jobId: string,
  kanbanSnapshot: KanbanData,
  status: SessionRunStatus,
): Promise<void> {
  const sessionPath = getSessionFilePathByJob(featurePath, jobType);
  let raw: string;
  try {
    raw = await fs.promises.readFile(sessionPath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      logger.debug(
        `[SessionCleanup] No session file to append snapshot (jobId=${jobId}, jobType=${jobType})`,
      );
      return;
    }
    logger.warn(
      `[SessionCleanup] Failed to read session for snapshot append`,
      { component: 'SessionCleanup' },
      err,
    );
    return;
  }
  let session: any;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[SessionCleanup] Session file unparseable, skipping snapshot append`,
      { component: 'SessionCleanup' },
      err,
    );
    return;
  }
  // Identity guard: never persist a board built for a different jobId onto
  // this run. The snapshot's own `jobId` is stamped by the builder; a
  // mismatch means the source state belonged to another job (the shared
  // `session.state` slot is last-writer-wins).
  if (kanbanSnapshot?.jobId && kanbanSnapshot.jobId !== jobId) {
    logger.warn(
      `[SessionCleanup] Refusing snapshot write — jobId mismatch (target=${jobId}, snapshot=${kanbanSnapshot.jobId})`,
      { component: 'SessionCleanup' },
    );
    return;
  }

  const runs: SessionRun[] = Array.isArray(session.runs) ? session.runs : [];
  const completedAt = new Date().toISOString();
  const idx = runs.findIndex((r) => r.jobId === jobId);
  if (idx >= 0) {
    // Monotonicity guard (shared SSOT): refuse a write that would demote a
    // `completed` run or regress its completed count — a clobber from a
    // stale/earlier checkpoint re-finalizing this jobId (plain-dimming-flock
    // RCA), not legitimate progress.
    if (wouldRegressRun(runs[idx], status, kanbanSnapshot)) {
      logger.warn(
        `[SessionCleanup] Refusing snapshot write — would regress run ` +
          `(jobId=${jobId}, existing=${runs[idx].status}/` +
          `${runs[idx].kanbanSnapshot?.completed?.length ?? 0} done, ` +
          `incoming=${status}/${kanbanSnapshot?.completed?.length ?? 0} done)`,
        { component: 'SessionCleanup' },
      );
      return;
    }
    runs[idx] = { ...runs[idx], kanbanSnapshot, status, completedAt };
  } else {
    const job: any = jobType === 'plan' ? 'plan' : jobType;
    runs.push({
      runId: runs.length + 1,
      job,
      timestamp: completedAt,
      input: { type: 'text', summary: '' },
      output: {},
      jobId,
      kanbanSnapshot,
      status,
      completedAt,
    });
  }
  session.runs = runs;
  session.updatedAt = completedAt;
  try {
    await atomicWriteFile(sessionPath, JSON.stringify(session, null, 2));
    logger.debug(
      `[SessionCleanup] Appended kanban snapshot for jobId=${jobId} (${jobType})`,
    );
  } catch (err) {
    logger.warn(
      `[SessionCleanup] Failed to write session with appended snapshot`,
      { component: 'SessionCleanup' },
      err,
    );
  }
}

/**
 * Single writer of the session-file `interruption.dismissed` marker
 * (sharp-choking-glove RCA — implicit-continuation consent axis, orthogonal
 * to `canResume`).
 *
 * `dismissed=true` (dismiss flows): the next chat turn must NOT silently
 * continue this work (`deriveRestoreMode` → 'fresh'), while the explicit
 * `/resume` route stays available. `dismissed=false` (resume flow): the user
 * explicitly re-opened the work, so the marker is cleared.
 *
 * Scans all session files for the feature and patches the one whose
 * `state.jobId` matches. Returns true when a session was patched. Best-effort
 * — missing/unparseable sessions and sessions without an interruption are a
 * no-op (nothing to arm or disarm).
 */
export async function setSessionDismissed(
  kanbanService: KanbanService | undefined,
  featurePath: string,
  jobId: string,
  dismissed: boolean,
): Promise<boolean> {
  for (const entry of getAllSessionPaths(featurePath)) {
    let raw: string;
    try {
      raw = await fs.promises.readFile(entry.path, 'utf-8');
    } catch {
      continue;
    }
    let session: any;
    try {
      session = JSON.parse(raw);
    } catch {
      continue;
    }
    if (session?.state?.jobId !== jobId || !session.state.interruption) continue;
    if ((session.state.interruption.dismissed === true) === dismissed) return true; // idempotent
    session.state.interruption = {
      ...session.state.interruption,
      dismissed,
      metadata: dismissed
        ? { ...(session.state.interruption.metadata ?? {}), stoppedBy: 'dismiss' }
        : session.state.interruption.metadata,
    };
    session.updatedAt = new Date().toISOString();
    try {
      await atomicWriteFile(entry.path, JSON.stringify(session, null, 2));
    } catch (err) {
      logger.warn(
        `[SessionCleanup] Failed to persist interruption.dismissed=${dismissed} (jobId=${jobId})`,
        { component: 'SessionCleanup' },
        err,
      );
      return false;
    }
    kanbanService?.invalidateSessionCache(entry.path);
    logger.info(
      `[SessionCleanup] interruption.dismissed=${dismissed} persisted (jobId=${jobId}, ${entry.agent}/${entry.job})`,
    );
    return true;
  }
  logger.debug(
    `[SessionCleanup] No session with interruption found for dismissed=${dismissed} (jobId=${jobId})`,
  );
  return false;
}

/**
 * Seal every Redis record tied to a terminal job — the Redis half of the
 * SSOT transaction boundary enforced by `finalizeTerminalJob`.
 *
 * Cleanup surface (best-effort, non-fatal on individual failures):
 *  - Redis: jobStatus (+ jobsByFeature SET srem via deleteJobStatus),
 *    taskQueue (+ checkpoint), workflow state, user-stopped flag, mapping,
 *    kill reason
 *  - In-memory: kanbanService.clearJobMemory (evicts per-job kanban cache)
 *
 * Does NOT touch:
 *  - `runs[]` in the session file — by the time we seal, the terminal run
 *    is already appended via `appendJobSnapshotToSession`
 *  - `feature.jsonl` — the terminal job's turns stay as history
 *  - debug artifacts on disk — explicit destructive routes (`job delete`,
 *    `context reset`, `feature delete`) own disk cleanup
 *
 * Silent when stateStore is missing (local-mode without state store does
 * not happen in practice — factory always wires RedisStateStore).
 */
export async function sealJobRedisState(
  stateStore: StateStorePort | undefined,
  kanbanService: KanbanService | undefined,
  jobId: string,
  // For the user_stopped finalize path, keep the userStopped flag alive so the
  // running child's poll backup + JobWorker's poll + the pre-spawn guard stay
  // armed until the child is truly terminal. The flag is cleared independently
  // on resume (JobWorker.processJob) and confirmed terminal exit
  // (JobExecutionManager); its 1h TTL caps any leak.
  preserveUserStopped: boolean = false,
): Promise<void> {
  if (stateStore) {
    const ops = [
      stateStore.deleteJobStatus(jobId),
      stateStore.deleteTaskQueue(jobId),
      stateStore.deleteWorkflowState(jobId),
      ...(preserveUserStopped ? [] : [stateStore.clearUserStopped(jobId)]),
      stateStore.deleteJobMapping(jobId),
      stateStore.deleteKillReason(jobId),
    ];
    const results = await Promise.allSettled(ops);
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn(
          `[SessionCleanup] Redis seal op failed for jobId=${jobId}`,
          { component: 'SessionCleanup' },
          r.reason,
        );
      }
    }
  }
  if (kanbanService) {
    try {
      await kanbanService.clearJobMemory(jobId);
    } catch (err) {
      logger.warn(
        `[SessionCleanup] kanbanService.clearJobMemory failed`,
        { component: 'SessionCleanup' },
        err,
      );
    }
  }
}

/**
 * Remove per-job debug artifacts from disk.
 *
 * This helper is intentionally NOT part of `sealJobRedisState` because
 * finalize paths must preserve debug evidence for post-mortem analysis.
 * Call this only from explicit destructive user flows (trash-can delete,
 * feature reset/delete).
 */
export async function scrubJobDebugArtifacts(
  featurePath: string,
  jobType: SessionableJobType,
  jobId: string,
): Promise<void> {
  if (!featurePath) return;

  const agent = getAgentForJob(jobType);
  const debugSubdirs = DEBUG_SUBDIRS[agent] ?? [];
  for (const subdir of debugSubdirs) {
    const debugDir = getSessionDebugDir(featurePath, agent, subdir);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(debugDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes(jobId)) continue;
      try {
        await fs.promises.unlink(path.join(debugDir, entry.name));
      } catch (err) {
        logger.warn(
          `[SessionCleanup] Failed to unlink debug file`,
          { component: 'SessionCleanup' },
          err,
        );
      }
    }
  }
}

/**
 * Remove a single jobId's footprint from the session file — used by the
 * UI trash-can path (`DELETE /features/:feature/jobs/:jobId`) after the
 * Redis half is sealed. Does NOT touch Redis.
 *
 * Cleanup surface (best-effort, non-fatal on individual failures):
 *  - Session file: drop matching `runs[]` entry; clear `state` if it is
 *    still pinned to this jobId
 *  - KanbanService session cache invalidation
 *
 * Note: `feature.jsonl` collapse via `FileSessionAdapter.collapseByJobId`
 * is handled by the route handler so this helper stays dependency-light.
 */
export async function deleteJobRunFromSession(
  kanbanService: KanbanService | undefined,
  featurePath: string,
  jobType: SessionableJobType,
  jobId: string,
): Promise<void> {
  // Superseded-state archive rides the job's lifecycle — deleting the job
  // deletes its archived resume state too.
  await deleteArchivedState(featurePath, jobId).catch(() => {});
  const sessionPath = getSessionFilePathByJob(featurePath, jobType);
  let raw: string | null = null;
  try {
    raw = await fs.promises.readFile(sessionPath, 'utf-8');
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      logger.warn(
        `[SessionCleanup] Failed to read session for jobId removal`,
        { component: 'SessionCleanup' },
        err,
      );
    }
    return;
  }
  let session: any;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `[SessionCleanup] Session unparseable during jobId removal`,
      { component: 'SessionCleanup' },
      err,
    );
    return;
  }
  let mutated = false;
  if (Array.isArray(session.runs)) {
    const before = session.runs.length;
    session.runs = session.runs.filter((r: SessionRun) => r.jobId !== jobId);
    if (session.runs.length !== before) mutated = true;
  }
  if (session.state?.jobId === jobId) {
    session.state = {
      ...session.state,
      jobId: null,
      jobTiming: null,
      currentTask: null,
      taskQueue: [],
      completedTasks: [],
      completedTasksDetails: [],
      interruption: null,
    };
    mutated = true;
  }
  if (mutated) {
    session.updatedAt = new Date().toISOString();
    try {
      await atomicWriteFile(sessionPath, JSON.stringify(session, null, 2));
    } catch (err) {
      logger.warn(
        `[SessionCleanup] Failed to write session after jobId removal`,
        { component: 'SessionCleanup' },
        err,
      );
    }
  }
  if (kanbanService) {
    kanbanService.invalidateSessionCache(sessionPath);
  }
}

export async function broadcastKanbanReset(
  stateStore: StateStorePort | undefined,
  kanbanService: KanbanService | undefined,
  projectId: string,
  featureName: string,
  jobType: SessionableJobType,
  userContext: { organizationId?: string; userId?: string } | undefined,
): Promise<void> {
  if (!kanbanService || !stateStore || !userContext?.organizationId || !userContext?.userId) {
    return;
  }
  try {
    kanbanService.invalidateSessionCacheByFeature(userContext as any, projectId, featureName, jobType);
    const kanbanData = await kanbanService.getKanbanData(
      projectId,
      featureName,
      jobType,
      undefined,
      undefined,
      undefined,
      userContext as any,
    );
    const { getRealtimeBroadcastChannel } = await import(
      '../../../../../infrastructure/state/redisConstants'
    );
    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    await stateStore.publish(channel, {
      projectId,
      featureName,
      type: 'kanban',
      data: kanbanData,
      userContext,
    });
  } catch (err) {
    logger.warn(
      `Failed to broadcast kanban update after reset (${jobType})`,
      { component: 'SessionCleanup' },
      err,
    );
  }
}
