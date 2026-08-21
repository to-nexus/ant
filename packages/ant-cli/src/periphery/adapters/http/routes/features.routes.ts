import { Router, Request, Response } from 'express';
import { registerFeatureParamDecoders } from './helpers/featureParam';
import { randomBytes } from 'crypto';
import { ProjectService, ChatService, KanbanService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import type { StateStorePort, JobStatusData } from '../../../../core/ports/stateStore';
import type { SessionableJobType, KanbanData } from '@ant/shared';
import { SESSIONABLE_JOB_TYPES, isSessionableJobType } from '@ant/shared';
import type { SessionRun } from '../../../../core/types/session';
import { FileSessionAdapter } from '../../session/FileSessionAdapter';
import { getAgentForJob, getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';
import {
  sealJobRedisState,
  scrubJobDebugArtifacts,
  deleteJobRunFromSession,
  broadcastKanbanReset,
} from './helpers/sessionCleanup';
import {
  collectUniversalRuns,
  findUniversalSessionFileByJobId,
  deleteUniversalRunFromSession,
} from './helpers/universalRuns';
import { resolveUniversalContainerPath } from '../../../../core/customAgents/universalContainer';
import { getInfrastructureFactory } from '../../../../infrastructure/adapters/InfrastructureFactory';
import * as fs from 'fs';
import { GitOperationError } from '../services/GitService/errors';
import { FeatureDeletionError } from '../services/ProjectService/errors';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { toBaseRelative, readTextContainedBase } from '../../../../core/config/containedIo';

/**
 * Read a session JSON file, binding the read to a base descent when the path is
 * inside the multi-tenant workspace base — a reparented feature root must not
 * return another tenant's session runs to this HTTP response (H-017). Returns
 * null when missing; out-of-base (repoType:local) keeps the raw read.
 */
async function readSessionUtf8OrNull(absPath: string): Promise<string | null> {
  const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), absPath);
  if (br) {
    const read = readTextContainedBase(br);
    if (!read.ok) {
      if (read.reason === 'missing') return null;
      throw new Error(`session read failed: ${read.reason}`);
    }
    return read.text;
  }
  try {
    return await fs.promises.readFile(absPath, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Allowed job types for the per-jobId history / restore / delete endpoints —
 * the full sessionable set (code/design/learn/plan/visual). Every job that
 * persists a session file under `sessions/{agent}/` is listed in the Job-tab
 * dropdown. plan/visual render no kanban board (plan produces a PRD), but they
 * still hold a persisted `runs[]` history and must survive as selectable rows
 * across `currentJobId` transitions — the dropdown is a jobId selector, not a
 * board-only surface.
 */
const JOB_TAB_JOB_TYPES = SESSIONABLE_JOB_TYPES;

function asJobTabType(value: unknown): SessionableJobType | null {
  return typeof value === 'string' && isSessionableJobType(value) ? value : null;
}

/**
 * Map a BullMQ job status to the dropdown row badge state.
 * Unknown values fall through as the raw string for forward-compatibility.
 */
function summarizeRunStatus(status: string | undefined): string {
  if (!status) return 'unknown';
  return status;
}

/**
 * Feature CRUD operations + per-jobId history / restore / delete.
 *
 * The legacy `DELETE /projects/:id/features/:feature/session?job={jobType}`
 * (jobType-scoped reset) was removed in favour of per-jobId deletion via
 * the dropdown. Tab-level "remove job" no longer exists; users delete
 * individual job ids instead.
 */
export function createFeaturesRoutes(deps: {
  projectService: ProjectService;
  chatService?: ChatService;
  kanbanService?: KanbanService;
  stateStore?: StateStorePort;
  workspaceResolver?: any;
}): Router {
  const router = Router();
  registerFeatureParamDecoders(router);

  /**
   * Resolve the feature's on-disk root. On a universal project the
   * `universal` pseudo-feature maps to `{project}/universal` (the container),
   * NOT `{project}/features/universal` — the canonical resolver is
   * universal-unaware and would fabricate a phantom plane there (the
   * pre-fix history/restore/DELETE all read that phantom path and found
   * nothing). `resolveUniversalContainerPath` self-guards on
   * featureName + projectType, so canonical features are untouched; partial
   * resolvers (tests) without `getProjectPath` fall through to the
   * canonical path.
   */
  function resolveFeaturePathInfo(
    userContext: any,
    projectId: string,
    featureName: string,
  ): { path: string; isUniversalContainer: boolean } {
    const resolver = deps.workspaceResolver ?? (deps.projectService as any).workspaceResolver;
    try {
      const projectPath = resolver.getProjectPath?.(userContext, projectId);
      if (projectPath) {
        const container = resolveUniversalContainerPath(projectPath, featureName);
        if (container) return { path: container, isUniversalContainer: true };
      }
    } catch {
      /* canonical fallback */
    }
    return { path: resolver.getFeaturePath(userContext, projectId, featureName), isUniversalContainer: false };
  }

  function getFeaturePath(userContext: any, projectId: string, featureName: string): string {
    return resolveFeaturePathInfo(userContext, projectId, featureName).path;
  }

  // Get features for a project
  router.get('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      // Creation-ordered (oldest first) — the same ordering the branchBase
      // reassignment rule uses, so FE dropdown and BE auto-apply agree.
      const features = await deps.projectService.listFeaturesDetailed(projectId, userContext);

      const formattedFeatures = features.map((f) => ({
        name: f.name,
        createdAt: f.createdAt.toISOString(),
      }));

      res.json(formattedFeatures);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  // Create a new feature
  router.post('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { featureName, language } = req.body;

      if (!featureName) {
        res.status(400).json({ error: 'featureName is required' });
        return;
      }

      const userContext = extractUserContext(req);

      await deps.projectService.createFeature(projectId, featureName, userContext, language);
      
      if (req.user) {
        logger.debug(`[Features] Created feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, featureName });
    } catch (error: any) {
      if (error.message === 'Feature already exists') {
        res.status(409).json({ error: error.message });
      } else if (error instanceof GitOperationError) {
        // `gitError` carries the classification (auth / conflict / …) so the
        // wizard can route a PAT failure to the Configure-PAT dialog. Feature
        // creation converges the anchor's origin, so GitAuthError is reachable
        // here, not just from the git-ops route.
        res.status(error.statusCode).json({ error: error.message, gitError: error.toShape() });
      } else {
        sendErrorResponse(res, 500, error, 'Features');
      }
    }
  });
  
  // Delete a feature — delegates the entire 5-phase cascade to
  // `ProjectService.deleteFeature` so progress can be broadcast as
  // `featureDeletionPhase` SSE events.
  //
  // Returns:
  //   - 200: { success: true, message }
  //   - 404: { error: 'Feature not found' }
  //   - 409: { kind: 'featureDeletion', stage, error, hint, canForceCleanup: true, correlationId }
  //          → user can retry with ?force=true to opt out of strict gating
  //   - 500: { kind: 'featureDeletion', stage, error, hint, leftovers?, canForceCleanup: false, correlationId }
  //          → force already attempted; surface the underlying failure
  router.delete('/projects/:id/features/:feature', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const force = req.query.force === 'true' || req.query.force === '1';
    try {
      const userContext = extractUserContext(req);

      await deps.projectService.deleteFeature(projectId, featureName, userContext, { force });

      if (req.user) {
        logger.debug(`[Features] Deleted feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }

      res.json({
        success: true,
        message: `Feature ${featureName} deleted`,
      });
    } catch (error: any) {
      if (error?.message === 'Feature not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof FeatureDeletionError) {
        const correlationId = randomBytes(4).toString('hex');
        const shape = error.toShape();
        const statusCode = shape.canForceCleanup ? 409 : 500;
        logger.warn(
          `[Features] DELETE failed at stage='${shape.stage}' (force=${force}) [cid:${correlationId}]`,
          { component: 'Features', projectId },
          { stage: shape.stage, featureName, message: shape.message, leftovers: shape.leftovers },
        );
        res.status(statusCode).json({
          error: shape.message,
          ...shape,
          correlationId,
        });
        return;
      }
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  // Get session for a specific feature
  router.get('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';
      const userContext = extractUserContext(req);
      
      const sessionData = await deps.projectService.getSession(projectId, featureName, job, userContext);
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found' || error.message.includes('not found')) {
        res.json(null);
      } else {
        sendErrorResponse(res, 500, error, 'Features');
      }
    }
  });
  
  // Legacy `POST /projects/:id/features/:feature/reset-job` was removed —
  // it wiped `session.state` without touching Redis or `runs[]`, leaving
  // the three stores inconsistent (violated the SSOT invariant). The UI
  // never called it, and Hard Reset (`POST /context/reset`) plus the
  // per-jobId trash-can (`DELETE /jobs/:jobId`) now cover both "wipe this
  // feature" and "wipe this run" with the SSOT-safe finalize path.

  /**
   * GET /projects/:id/features/:feature/jobs?type={jobType}
   *
   * Lists past job ids for the same feature × jobType, most-recent first.
   * Sources are merged from:
   *   1. Redis `listJobsByFeature` (live + recently completed jobs that
   *      Redis still retains)
   *   2. The session file's `runs[]` array (historical runs whose Redis
   *      state has expired but whose kanban snapshot was persisted by
   *      `JobCleanupManager.broadcastFinalUpdate`)
   *
   * Duplicates (same jobId in both sources) prefer the Redis entry since
   * it carries the live status. Ordering uses
   * `(completedAt ?? startedAt ?? timestamp)` descending.
   */
  router.get('/projects/:id/features/:feature/jobs', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      // Feature-wide by default: list every sessionable job of the feature
      // (code/design/learn/plan/visual) in one list, each entry tagged with its
      // own type. An explicit `?type=` narrows to a single type (back-compat);
      // omitting it returns all JOB_TAB_JOB_TYPES. Only `ask`/`inline-ask`
      // (no persisted session) are absent.
      const requestedType = req.query.type !== undefined ? asJobTabType(req.query.type) : undefined;
      if (req.query.type !== undefined && !requestedType) {
        res.status(400).json({ error: `Invalid job type. Allowed: ${JOB_TAB_JOB_TYPES.join(', ')}` });
        return;
      }
      const types: readonly SessionableJobType[] = requestedType ? [requestedType] : JOB_TAB_JOB_TYPES;
      const userContext = extractUserContext(req);

      type HistoryEntry = {
        jobId: string;
        type: SessionableJobType;
        status: string;
        startedAt?: string;
        completedAt?: string;
        live: boolean;
        /**
         * Final kanban snapshot captured when the job was sealed. Present
         * for completed runs whose snapshot was persisted to `runs[]` by
         * `JobCleanupManager.broadcastFinalUpdate`. Absent for live jobs
         * and for historical runs that predate snapshot persistence — the
         * FE shows badges only when this is present.
         */
        kanbanSnapshot?: KanbanData;
        /** Universal only — `{agentId}/{customJobId}` for row labeling. */
        customJobRef?: string;
      };

      const merged = new Map<string, HistoryEntry>();

      // (1) Redis — **live (running/paused) jobs only**.
      //
      // Defense-in-depth filter: under the SSOT lifecycle refactor, Redis
      // should never contain terminal (completed/failed) job records — the
      // seal pipeline (sealJobRedisState) DELs every job record the moment
      // it transitions to terminal. The `status === 'running' || 'paused'`
      // filter below therefore protects against:
      //   - Pre-refactor records created before seal was wired (swept away
      //     by StaleJobRecovery Phase 3 on the next server boot).
      //   - A seal race where `updateJobStatus(terminal)` landed but the
      //     DEL pipeline crashed before completing.
      // Session `runs[]` is the SSOT for completed history; Redis is the
      // live-state store only.
      if (deps.stateStore) {
        try {
          const redisJobs = await deps.stateStore.listJobsByFeature(userContext, projectId, featureName);
          for (const j of redisJobs) {
            if (!(types as readonly string[]).includes(j.type)) continue;
            // `includes` over a widened string[] doesn't narrow `j.type`, but
            // the guard guarantees membership in JOB_TAB_JOB_TYPES ⊆ SessionableJobType.
            const entryType = j.type as SessionableJobType;
            const isLive = j.status === 'running' || j.status === 'paused';
            if (!isLive) continue;
            merged.set(j.jobId, {
              jobId: j.jobId,
              type: entryType,
              status: summarizeRunStatus(j.status),
              startedAt: j.startedAt ?? j.timestamp,
              completedAt: j.completedAt,
              live: true,
            });
          }
        } catch (err) {
          logger.warn(
            `Failed to list Redis jobs for history`,
            { component: 'Features' },
            err,
          );
        }
      }

      // (2) Session runs[] — SSOT for completed history. Live entries from
      //     (1) are backfilled with `kanbanSnapshot` when the same jobId
      //     has already been sealed to runs[] (Redis keeps only live
      //     taskQueue snapshots, not the final sealed kanban).
      // Resilience: a featurePath-resolution failure must not 500 the route —
      // fall back to the Redis live entries already collected (parity with the
      // pre-feature-wide behavior, which caught this in the session-merge try).
      let featurePath: string | null = null;
      let isUniversalContainer = false;
      try {
        const info = resolveFeaturePathInfo(userContext, projectId, featureName);
        featurePath = info.path;
        isUniversalContainer = info.isUniversalContainer;
      } catch (err) {
        logger.warn(`Failed to resolve feature path for history`, { component: 'Features' }, err);
      }
      for (const t of featurePath ? types : []) {
        try {
          if (t === 'universal') {
            // Universal runs live per-(agentId, customJobId) inside the
            // container — never under sessions/universal/universal.json.
            // Canonical features have no container, so skip the probe.
            if (!isUniversalContainer) {
              // Explicit type request + no container = a universal project
              // whose config.json did not read as `projectType: 'universal'`.
              // Distinguishes "history empty" from "container unresolved".
              if (requestedType === 'universal') {
                logger.debug(
                  `[Features] Universal history skipped — container unresolved for ${projectId}/${featureName}`,
                );
              }
              continue;
            }
            for (const r of await collectUniversalRuns(featurePath!)) {
              const existing = merged.get(r.jobId!);
              if (existing) {
                if (r.kanbanSnapshot && !existing.kanbanSnapshot) {
                  existing.kanbanSnapshot = r.kanbanSnapshot as KanbanData;
                }
                if (!existing.customJobRef) existing.customJobRef = r.customJobRef;
                continue;
              }
              merged.set(r.jobId!, {
                jobId: r.jobId!,
                type: t,
                status: r.status ?? 'completed',
                startedAt: r.timestamp,
                completedAt: r.completedAt ?? r.timestamp,
                live: false,
                kanbanSnapshot: (r.kanbanSnapshot as KanbanData | undefined) ?? undefined,
                customJobRef: r.customJobRef,
              });
            }
            continue;
          }
          const sessionPath = getSessionFilePathByJob(featurePath!, t);
          const raw = await readSessionUtf8OrNull(sessionPath);
          if (raw) {
            const parsed = JSON.parse(raw);
            const runs: SessionRun[] = Array.isArray(parsed?.runs) ? parsed.runs : [];
            for (const r of runs) {
              if (!r.jobId) continue;
              const existing = merged.get(r.jobId);
              if (existing) {
                if (r.kanbanSnapshot && !existing.kanbanSnapshot) {
                  existing.kanbanSnapshot = r.kanbanSnapshot as KanbanData;
                }
                continue;
              }
              merged.set(r.jobId, {
                jobId: r.jobId,
                type: t,
                status: r.status ?? 'completed',
                startedAt: r.timestamp,
                completedAt: r.completedAt ?? r.timestamp,
                live: false,
                kanbanSnapshot: (r.kanbanSnapshot as KanbanData | undefined) ?? undefined,
              });
            }
          }
        } catch (err) {
          logger.warn(
            `Failed to merge session runs for history (${t})`,
            { component: 'Features' },
            err,
          );
        }
      }

      const entries = Array.from(merged.values());
      entries.sort((a, b) => {
        const at = (a.completedAt ?? a.startedAt ?? '').toString();
        const bt = (b.completedAt ?? b.startedAt ?? '').toString();
        return bt.localeCompare(at);
      });

      res.json({ jobs: entries });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Features');
    }
  });

  /**
   * GET /projects/:id/features/:feature/kanban
   *
   * Single owner of the kanban GET path — dispatches on query shape:
   *
   * A. `?job={jobType}` (no jobId) — jobType board (session + Redis hybrid via
   *    `KanbanService.getKanbanData`). Absorbed from the legacy
   *    `kanban.routes.ts`, whose registration was shadowed by this route and
   *    therefore permanently returned 400 to the FE board fetch.
   *
   * B. `?jobId={jobId}&type={jobType}` — restores the kanban view for a single
   *    (possibly past) jobId. Resolution order:
   *   1. Live: Redis live snapshot (`KanbanService.getKanbanData(jobType)`)
   *      when the requested jobId matches the active session jobId for
   *      this jobType.
   *   2. Snapshot: session file `runs[i].kanbanSnapshot` for the matching
   *      `runs[i].jobId`.
   *   3. Empty: returns a blank kanban so the UI clears the board.
   */
  router.get('/projects/:id/features/:feature/kanban', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const jobId = (req.query.jobId as string | undefined)?.trim();

      // ---- Branch A: jobType board (no jobId) ----
      if (!jobId) {
        const job = asJobTabType(req.query.job ?? req.query.type ?? 'code');
        if (!job) {
          res.status(400).json({ error: `Invalid job type. Allowed: ${JOB_TAB_JOB_TYPES.join(', ')}` });
          return;
        }
        if (!deps.kanbanService) {
          res.status(503).json({ error: 'kanbanService unavailable' });
          return;
        }
        const boardUserContext = extractUserContext(req);
        const kanbanData = await deps.kanbanService.getKanbanData(
          projectId, featureName, job,
          undefined, undefined, undefined,
          boardUserContext,
        );
        res.json(kanbanData);
        return;
      }

      // ---- Branch B: per-jobId restore ----
      const requestedType = asJobTabType(req.query.type ?? 'code');
      if (!requestedType) {
        res.status(400).json({ error: `Invalid job type. Allowed: ${JOB_TAB_JOB_TYPES.join(', ')}` });
        return;
      }
      const userContext = extractUserContext(req);

      // (1) Live path — only when the requested jobId is the current
      //     session's active jobId for this jobType. Otherwise the
      //     KanbanService's hybrid logic would silently return the live
      //     state of a different jobId.
      if (deps.kanbanService && deps.stateStore) {
        try {
          const jobStatus = await deps.stateStore.getJobStatus(jobId);
          if (jobStatus && jobStatus.type === requestedType &&
              (jobStatus.status === 'running' || jobStatus.status === 'paused')) {
            const kanbanData = await deps.kanbanService.getKanbanData(
              projectId, featureName, requestedType,
              undefined, undefined, undefined,
              userContext,
            );
            if (kanbanData?.jobId === jobId) {
              res.json(kanbanData);
              return;
            }
          }
        } catch (err) {
          logger.warn(
            `Failed to fetch live kanban for jobId=${jobId}`,
            { component: 'Features' },
            err,
          );
        }
      }

      // (2) Snapshot from session file
      try {
        const { path: featurePath, isUniversalContainer } = resolveFeaturePathInfo(
          userContext, projectId, featureName,
        );
        if (requestedType === 'universal') {
          // Universal: locate the per-(agentId, customJobId) file that
          // references this run instead of the (nonexistent) jobType file.
          if (isUniversalContainer) {
            const ref = await findUniversalSessionFileByJobId(featurePath, jobId);
            if (ref) {
              const refRaw = await readSessionUtf8OrNull(ref.path);
              const parsed = refRaw ? JSON.parse(refRaw) : {};
              const runs: SessionRun[] = Array.isArray(parsed?.runs) ? parsed.runs : [];
              const match = runs.find((r) => r.jobId === jobId);
              if (match?.kanbanSnapshot) {
                res.json(match.kanbanSnapshot);
                return;
              }
            }
          }
        } else {
          const sessionPath = getSessionFilePathByJob(featurePath, requestedType);
          const raw = await readSessionUtf8OrNull(sessionPath);
          const parsed = raw ? JSON.parse(raw) : {};
          const runs: SessionRun[] = Array.isArray(parsed?.runs) ? parsed.runs : [];
          const match = runs.find((r) => r.jobId === jobId);
          if (match?.kanbanSnapshot) {
            res.json(match.kanbanSnapshot);
            return;
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          logger.warn(
            `Failed to read session snapshot for jobId=${jobId}`,
            { component: 'Features' },
            err,
          );
        }
      }

      // (3) Empty fallback
      res.json({
        jobId,
        todo: [],
        inProgress: [],
        completed: [],
        isEstimating: false,
        dataSource: 'session',
        jobType: requestedType,
        agent: getAgentForJob(requestedType),
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Features');
    }
  });

  /**
   * DELETE /projects/:id/features/:feature/jobs/:jobId
   *
   * Per-jobId "full wipe" — the per-row trash icon in the Job-tab dropdown.
   *
   * Refuses (409) when the target job is currently running or paused
   * (active surface) so deletion never races with a live worker. The user
   * stops the job first, then deletes.
   *
   * Cleanup surface (best-effort, non-fatal on individual failures):
   *  - Redis: status / logs / taskQueue (+ checkpoint) / workflow / mapping
   *    / userStopped + jobsByFeature index entry
   *  - BullMQ: removes any queue residue (waiting/delayed)
   *  - Disk: unlinks debug files containing the jobId, removes the jobId's
   *    `runs[]` entry from the session file
   *  - feature.jsonl: collapses jobId-tagged lines via
   *    `FileSessionAdapter.collapseByJobId`
   *  - Realtime: rebroadcasts the kanban so all open tabs stay in sync
   */
  router.delete('/projects/:id/features/:feature/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const jobId = req.params.jobId;
      const userContext = extractUserContext(req);

      let jobType: SessionableJobType | null = null;
      let jobStatus: JobStatusData | null = null;

      if (deps.stateStore) {
        try {
          jobStatus = await deps.stateStore.getJobStatus(jobId);
        } catch (err) {
          logger.warn(
            `Failed to read job status before deletion`,
            { component: 'Features' },
            err,
          );
        }
      }

      if (jobStatus) {
        if (jobStatus.status === 'running' || jobStatus.status === 'paused') {
          res.status(409).json({
            error: 'Job is active',
            message: `Cannot delete an active job (status=${jobStatus.status}). Stop the job first.`,
            jobId,
            jobStatus: jobStatus.status,
          });
          return;
        }
        jobType = asJobTabType(jobStatus.type);
      }

      // Fallback type from query when Redis status is gone.
      if (!jobType) {
        jobType = asJobTabType(req.query.type ?? 'code') ?? 'code';
      }

      // Removes BullMQ queue residue (no-op for jobs that have already settled).
      try {
        const factory = getInfrastructureFactory();
        const jobQueue = factory.getJobQueue();
        await jobQueue.cancel(jobId);
      } catch (err) {
        logger.warn(
          `Failed to remove BullMQ residue for jobId=${jobId}`,
          { component: 'Features' },
          err,
        );
      }

      // Three-step cleanup: seal Redis, scrub debug artifacts explicitly,
      // then drop the runs[]
      // entry + session state pointer. Order matters: sealing first guarantees
      // the history API can't resurrect this job between steps.
      const featurePath = getFeaturePath(userContext, projectId, featureName);
      await sealJobRedisState(
        deps.stateStore,
        deps.kanbanService,
        jobId,
      );
      await scrubJobDebugArtifacts(featurePath, jobType, jobId);
      if (jobType === 'universal') {
        // Universal: drop the run from its per-(agentId, customJobId) file
        // without injecting canonical task-state resets (checklist ≠ tasks).
        await deleteUniversalRunFromSession(deps.kanbanService, featurePath, jobId);
      } else {
        await deleteJobRunFromSession(
          deps.kanbanService,
          featurePath,
          jobType,
          jobId,
        );
      }

      // Collapse feature.jsonl lines tied to this jobId so future prompts
      // (resolve → plan/direct) no longer inject its turns as context.
      try {
        const agent = getAgentForJob(jobType);
        const adapter = new FileSessionAdapter(featurePath, agent, projectId, featureName);
        await adapter.collapseByJobId(jobId);
      } catch (err) {
        logger.warn(
          `Failed to collapse feature.jsonl for jobId=${jobId}`,
          { component: 'Features' },
          err,
        );
      }

      // Refresh the kanban so every connected tab clears stale state for this
      // jobType. Universal has no board (checklist surface) and KanbanService
      // is universal-unaware — the broadcast would be pure noise, skip it.
      if (jobType !== 'universal') {
        await broadcastKanbanReset(
          deps.stateStore,
          deps.kanbanService,
          projectId,
          featureName,
          jobType,
          userContext,
        );
      }

      logger.debug(`[Features] Deleted job ${jobId} (${jobType})`);
      res.json({ success: true, jobId });
    } catch (error: any) {
      logger.error('Error deleting job', { component: 'Features' }, error);
      sendErrorResponse(res, 500, error, 'Features');
    }
  });
  
  return router;
}
