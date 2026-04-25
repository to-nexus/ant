import { Router, Request, Response } from 'express';
import * as path from 'path';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { broadcastKanbanReset } from './helpers/sessionCleanup';
import { finalizeTerminalJob } from '../express/lifecycle/finalizeTerminalJob';
import { FileSessionAdapter } from '../../session/FileSessionAdapter';
import { logger } from '../../../../utils/logger';
import type { ChatService, KanbanService } from '../services';
import type { InterruptionDetails } from '../../../../core/types';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { clearCanonicalDirectory } from '../../../../core/utils/sessionPaths';

/**
 * Feature log routes
 *
 * Exposes read-only access to the session-redesign JSONL sources:
 * - `feature.jsonl` breadcrumbs — navigation timeline
 * - `feature.jsonl` user_turn / user_turn_meta — tier badge data
 *
 * Chat history (chat.jsonl) is NOT served here — the UI hydrates from
 * the SSE `chat_initial_state` event, backed by
 * `ChatService.loadEventsAsync` + `loadTurnBuffersAsync` (chat-SSOT §5).
 *
 * Live updates flow through the SSE workflow/chat streams.
 */
export function createFeatureLogRoutes(deps: {
  workspaceResolver?: any;
  /**
   * Optional ChatService — when present, `/context/reset` reuses
   * `chatService.clearEventsAsync(scope='full')` for the Redis chat
   * turn-buffer purge + `events_cleared` SSE broadcast. Disk wipe
   * (feature.jsonl / chat.jsonl / architect json /
   * planner json) is handled separately via `clearCanonicalDirectory`
   * in this handler and does NOT depend on ChatService.
   */
  chatService?: ChatService;
  /** KanbanService for cache invalidation + kanban SSE broadcast. */
  kanbanService?: KanbanService;
  /** StateStorePort for Redis job cleanup + kanban pub/sub. */
  stateStore?: StateStorePort;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> };
  /** Wired by RouteConfigurator — required for Hard Reset to finalize jobs via SSOT helpers. */
  cleanupJobState?: (
    jobId: string,
    projectId?: string,
    featureName?: string,
    interruptionReason?: InterruptionDetails,
    explicitJobType?: 'design' | 'code' | 'learn' | 'plan' | 'visual',
    userContext?: any,
  ) => Promise<void>;
  stateTracker?: any;
}): Router {
  const router = Router();

  /**
   * GET /projects/:id/features/:feature/breadcrumbs
   *
   * Response: { breadcrumbs: FeatureBreadcrumbLine[] }
   */
  router.get('/projects/:id/features/:feature/breadcrumbs', async (req: Request, res: Response) => {
    try {
      if (!deps.workspaceResolver) {
        res.status(503).json({ error: 'Workspace resolver not available' });
        return;
      }
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const adapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
      const breadcrumbs = await adapter.loadAllBreadcrumbs();

      res.json({ breadcrumbs });
    } catch (error: any) {
      logger.error('Feature breadcrumbs load error', { component: 'FeatureLog' }, error);
      sendErrorResponse(res, 500, error, 'FeatureLog');
    }
  });

  /**
   * GET /projects/:id/features/:feature/user-turn-meta
   *
   * Returns user_turn + user_turn_meta lines from `feature.jsonl`, keyed on
   * the caller side by `turnId` (the UI tier badge merges mode with the
   * corresponding meta to render `mode · executionTier · reason`).
   *
   * Response: { userTurns: FeatureUserTurnLine[], userTurnMetas: FeatureUserTurnMetaLine[] }
   */
  router.get('/projects/:id/features/:feature/user-turn-meta', async (req: Request, res: Response) => {
    try {
      if (!deps.workspaceResolver) {
        res.status(503).json({ error: 'Workspace resolver not available' });
        return;
      }
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const adapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
      const { userTurns, userTurnMetas } = await adapter.loadFeatureTurnMeta();

      res.json({ userTurns, userTurnMetas });
    } catch (error: any) {
      logger.error('Feature user-turn-meta load error', { component: 'FeatureLog' }, error);
      sendErrorResponse(res, 500, error, 'FeatureLog');
    }
  });

  /**
   * POST /projects/:id/features/:feature/context/reset
   *
   * Hard Reset — wipes this feature's sessions from disk and Redis so the
   * next job starts from a blank state. Five-stage pipeline:
   *
   *   1. Per-job SSOT finalize via `listJobsByFeature`:
   *      - Live jobs (running/paused) → `finalizeTerminalJob(failed,
   *        interruption=user_stopped)` which acquires idempotency locks,
   *        seals Redis, and broadcasts the terminal kanban snapshot.
   *      - Any already-terminal remnant → still run a defensive seal via
   *        the same helper (its seal phase is idempotent).
   *   2. chatService.clearEventsAsync(scope='full') — drop every active
   *      Redis TURN_BUFFER for the feature and broadcast an
   *      `events_cleared` SSE. (No disk collapse here; the full-scope
   *      path performs Redis turn-buffer purge + SSE only — disk wipe
   *      happens in stage 3.)
   *   3. clearCanonicalDirectory(sessions/, 'sessions') — actually delete
   *      feature.jsonl, chat.jsonl, sessions/architect/*.json,
   *      sessions/planner/*.json. Canonical subdirectory structure is
   *      preserved (debug/runtime stay as empty dirs, files inside go).
   *   4. broadcastKanbanReset × jobType — invalidate KanbanService cache
   *      and publish a fresh (empty) kanban snapshot so every open tab
   *      resets its view in sync.
   *   5. fileTreeNotifier.notifyFileTreeUpdate — file tree is push-based
   *      and must be explicitly notified of the bulk deletions.
   *
   * Requires workspaceResolver. Absent kanbanService/stateStore causes (1)
   * and (4) to become silent no-ops; the disk wipe still proceeds.
   *
   * Body (optional): { reason?: string }  default: 'user_reset'
   * Response: { success: true, reason }
   */
  router.post('/projects/:id/features/:feature/context/reset', async (req: Request, res: Response) => {
    try {
      if (!deps.workspaceResolver) {
        res.status(503).json({ error: 'Workspace resolver not available' });
        return;
      }
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);

      const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const reason = rawReason === '' ? 'user_reset' : rawReason;

      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const jobTypes: Array<'code' | 'design' | 'learn' | 'plan'> = ['code', 'design', 'learn', 'plan'];

      // 1. SSOT cascade seal for every job tied to this feature. We finalize
      //    (not pause) because the feature's sessions are about to be wiped
      //    — no resumable artifact would survive anyway. finalize's snapshot
      //    append + broadcast runs BEFORE the disk wipe (stage 3), so the
      //    transient runs[] entry is created and then removed in one flow.
      //    skipSessionPatch is NOT set here because `broadcastFinalUpdate`
      //    emits the final kanban for any open SSE tabs.
      if (deps.stateStore) {
        try {
          const jobs = await deps.stateStore.listJobsByFeature(projectId, featureName);
          for (const job of jobs) {
            const interruption: InterruptionDetails = {
              reason: 'user_stopped',
              message: 'Feature context reset',
              canResume: false,
              timestamp: new Date().toISOString(),
              metadata: { stoppedBy: 'hard_reset' },
            };
            const jt = (job.type || 'code') as 'code' | 'design' | 'learn' | 'plan' | 'visual';
            try {
              if (deps.cleanupJobState && deps.stateTracker) {
                await finalizeTerminalJob(
                  {
                    cleanupJobState: deps.cleanupJobState,
                    stateTracker: deps.stateTracker,
                    kanbanService: deps.kanbanService,
                  },
                  {
                    jobId: job.jobId,
                    finalStatus: 'failed',
                    projectId,
                    featureName,
                    jobType: jt,
                    userContext: job.userContext as { userId: string; organizationId: string } | undefined ?? userContext,
                    interruption,
                    featurePath,
                    skipSessionPatch: true,
                  },
                );
              } else {
                // Fallback: lifecycle deps not wired — bare seal via the
                // helper is still reachable through the legacy path below.
                logger.warn(
                  `Hard reset: cleanupJobState/stateTracker missing — skipping SSOT finalize for ${job.jobId}`,
                  { component: 'FeatureLog' },
                );
              }
            } catch (err) {
              logger.warn(
                `Hard reset: finalize failed for ${job.jobId}`,
                { component: 'FeatureLog' },
                err,
              );
            }
          }
        } catch (err) {
          logger.warn('Hard reset: listJobsByFeature failed', { component: 'FeatureLog' }, err);
        }
      }

      // 2. Chat session Redis + drafts + messages_cleared SSE
      //    (disk collapse intentionally not run — stage 3 replaces it with
      //    physical unlink of every session file.)
      if (deps.chatService) {
        try {
          await deps.chatService.clearEventsAsync(projectId, featureName, 'full', userContext);
        } catch (err) {
          logger.warn('Hard reset: chat scratchpad cleanup failed', { component: 'FeatureLog' }, err);
        }
      }

      // 3. Physical disk wipe — unlink every file under {featurePath}/sessions/
      //    while preserving canonical subdirectory structure (architect/,
      //    architect/debug/*, architect/runtime/*, planner/, planner/debug/*).
      const sessionsPath = path.join(featurePath, 'sessions');
      try {
        await clearCanonicalDirectory(sessionsPath, 'sessions');
      } catch (err) {
        logger.error('Hard reset: clearCanonicalDirectory failed', { component: 'FeatureLog' }, err);
        // Fall through — we still want to broadcast the kanban reset so
        // the UI reflects whatever state ended up on disk.
      }

      // 4. Kanban cache invalidation + fresh snapshot broadcast per jobType
      for (const jt of jobTypes) {
        await broadcastKanbanReset(deps.stateStore, deps.kanbanService, projectId, featureName, jt, userContext);
      }

      // 5. File tree push notification (tree is push-based; bulk deletions
      //    above wouldn't be observed by the FE otherwise)
      deps.fileTreeNotifier?.notifyFileTreeUpdate(projectId, featureName, userContext);

      logger.info(
        `Feature context reset (project=${projectId}, feature=${featureName}, reason=${reason})`,
        { component: 'FeatureLog' },
      );
      res.json({ success: true, reason });
    } catch (error: any) {
      logger.error('Feature context reset error', { component: 'FeatureLog' }, error);
      sendErrorResponse(res, 500, error, 'FeatureLog');
    }
  });

  return router;
}
