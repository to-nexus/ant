import { Router, Request, Response } from 'express';
import * as path from 'path';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { cleanupStaleRedisJobs, broadcastKanbanReset } from './helpers/sessionCleanup';
import { FileSessionAdapter } from '../../session/FileSessionAdapter';
import { logger } from '../../../../utils/logger';
import type { ChatService, KanbanService } from '../services';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { clearCanonicalDirectory } from '../../../../core/utils/sessionPaths';

/**
 * Feature log routes
 *
 * Exposes read-only access to the session-redesign JSONL sources:
 * - `feature.jsonl` breadcrumbs — navigation timeline
 * - `feature.jsonl` user_turn / user_turn_meta — tier badge data
 *
 * Chat history (chat.jsonl) is NOT served here — the UI fetches chat
 * messages via `/chat/messages`, which routes through
 * `ChatService.getMessagesAsync` so the streaming scratchpad overlay is
 * applied on top of the durable log.
 *
 * Live updates flow through the SSE workflow/chat streams.
 */
export function createFeatureLogRoutes(deps: {
  workspaceResolver?: any;
  /**
   * Optional ChatService — when present, `/context/reset` reuses
   * `chatService.clearMessagesAsync(..., 'full')` for the Redis chat
   * session purge + draft image cleanup + `messages_cleared` SSE
   * broadcast. Disk wipe (feature.jsonl / chat.jsonl / architect json /
   * planner json) is handled separately via `clearCanonicalDirectory`
   * in this handler and does NOT depend on ChatService.
   */
  chatService?: ChatService;
  /** KanbanService for cache invalidation + kanban SSE broadcast. */
  kanbanService?: KanbanService;
  /** StateStorePort for Redis job cleanup + kanban pub/sub. */
  stateStore?: StateStorePort;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): void };
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
   *   1. cleanupStaleRedisJobs × ['code','design','learn','plan'] — mark
   *      paused/running Redis jobs for every job type as failed and evict
   *      their kanban memory. Mirrors the Job tab X cleanup.
   *   2. chatService.clearMessagesAsync(scope='full') — delete the Redis
   *      chat session, purge inputs/assets/gen/drafts, broadcast
   *      `messages_cleared` SSE. (No disk collapse here; the SessionManager
   *      full-scope path performs Redis/drafts/SSE only.)
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

      // 1. Redis job cleanup (paused/running → failed, kanban memory evicted)
      for (const jt of jobTypes) {
        try {
          await cleanupStaleRedisJobs(deps.stateStore, deps.kanbanService, projectId, featureName, jt);
        } catch (err) {
          logger.warn(`Hard reset: cleanupStaleRedisJobs failed for ${jt}`, { component: 'FeatureLog' }, err);
        }
      }

      // 2. Chat session Redis + drafts + messages_cleared SSE
      //    (disk collapse intentionally not run — stage 3 replaces it with
      //    physical unlink of every session file.)
      if (deps.chatService) {
        try {
          await deps.chatService.clearMessagesAsync(projectId, featureName, userContext, 'full');
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
