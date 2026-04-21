import { Router, Request, Response } from 'express';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { FileSessionAdapter } from '../../session/FileSessionAdapter';
import type { LogJobType } from '@ant/shared';
import { logger } from '../../../../utils/logger';
import type { ChatService } from '../services';

const VALID_JOB_TYPES: LogJobType[] = ['code', 'design', 'plan', 'learn', 'ask', 'inline-ask'];

function parseJobTypes(raw: unknown): LogJobType[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const valid = parts.filter((p): p is LogJobType => (VALID_JOB_TYPES as string[]).includes(p));
  return valid.length > 0 ? valid : undefined;
}

/**
 * Feature log routes
 *
 * Exposes read-only access to the session-redesign JSONL sources:
 * - `trace.jsonl` — UI rendering SSOT (chat history, activity feed)
 * - `feature.jsonl` breadcrumbs — navigation timeline
 *
 * These endpoints are intended for UI initial-load only. Live updates
 * continue to flow through the SSE workflow/chat streams.
 */
export function createFeatureLogRoutes(deps: {
  workspaceResolver?: any;
  /**
   * Optional ChatService — when present, `/context/reset` delegates to
   * `chatService.clearMessagesAsync` so Reset shares the SSOT pipeline
   * with the §16.2 Clear path (Redis session purge + local cache reset
   * + trace.jsonl / feature.jsonl collapse + draft image cleanup +
   * `messages_cleared` SSE broadcast). When absent the endpoint falls
   * back to a direct FileSessionAdapter.collapseAll so the feature-log
   * collapse still succeeds, but the extra scratchpad / SSE effects are
   * skipped. Wiring happens in `routes/index.ts`.
   */
  chatService?: ChatService;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): void };
}): Router {
  const router = Router();

  /**
   * GET /projects/:id/features/:feature/trace
   *
   * Query params:
   * - sinceTs (ISO 8601) — return only lines strictly after this timestamp
   * - jobTypes (comma-separated) — filter by jobType (e.g. "code,design")
   *
   * Response: { lines: TraceLine[] }
   */
  router.get('/projects/:id/features/:feature/trace', async (req: Request, res: Response) => {
    try {
      if (!deps.workspaceResolver) {
        res.status(503).json({ error: 'Workspace resolver not available' });
        return;
      }
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const sinceTs = typeof req.query.sinceTs === 'string' ? req.query.sinceTs : undefined;
      const jobTypes = parseJobTypes(req.query.jobTypes);

      // agent is only used to resolve classic session files — trace.jsonl lives at the feature root.
      const adapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
      const lines = await adapter.loadAllTrace({ sinceTs, jobTypes });

      res.json({ lines });
    } catch (error: any) {
      logger.error('Feature trace load error', { component: 'FeatureLog' }, error);
      sendErrorResponse(res, 500, error, 'FeatureLog');
    }
  });

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
   * Hard Reset (§17) — aligns with the §16.2 "Clear·Reset 양방향 sync"
   * SSOT so that Reset triggers the same cleanup pipeline as Clear:
   *   1. Delete the Redis chat session + local scratchpad cache
   *      (prevents pending user messages / live currentMessage from
   *      resurfacing on the next SSE initial_state rebuild).
   *   2. Collapse every prior line in `feature.jsonl` + `trace.jsonl`
   *      and append a `user_reset` boundary so subsequent
   *      `loadSinceBoundary` calls return empty. Original lines stay
   *      on disk (`collapsed=true`) for audit / recovery.
   *   3. Purge `{featurePath}/inputs/assets/gen/drafts/` so stale
   *      image drafts don't survive the reset.
   *   4. Broadcast `messages_cleared` over SSE so every connected tab
   *      and the FE feature-log slice wipe their caches in sync (the
   *      handler in `chatSseHandler.ts` clears both `chatMessages` and
   *      the feature-log slice per §16.2 Defect C fix).
   *
   * The endpoint awaits (1)+(2)+(3) before responding so the
   * immediately-following UI re-fetch of `/trace` / `/breadcrumbs` /
   * `/user-turn-meta` observes the post-collapse state.
   *
   * Fallback: if `chatService` was not provided (rare — only if the
   * composition root skipped Chat wiring), the handler drops back to a
   * direct FileSessionAdapter.collapseAll so the file-level reset
   * still happens, accepting that scratchpad / SSE effects are lost in
   * that degraded configuration.
   *
   * Body (optional): { reason?: string }  default: 'user_reset'
   * Response: { success: true, reason, jobId, turnId }
   *   - `jobId` / `turnId` are opaque audit identifiers; the FE does
   *     not consume them, but they're returned for log correlation.
   */
  router.post('/projects/:id/features/:feature/context/reset', async (req: Request, res: Response) => {
    try {
      if (!deps.workspaceResolver && !deps.chatService) {
        res.status(503).json({ error: 'Workspace resolver not available' });
        return;
      }
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);

      const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const reason = rawReason === '' ? 'user_reset' : rawReason;
      const now = Date.now();
      const jobId = `reset-${now}`;
      const turnId = `t-reset-${now.toString(16)}`;

      if (deps.chatService) {
        // SSOT path — shared pipeline with DELETE /chat/messages.
        await deps.chatService.clearMessagesAsync(projectId, featureName, userContext);
        // ChatService.clearMessagesAsync may delete draft images from
        // disk; the file tree is push-based so we must notify.
        deps.fileTreeNotifier?.notifyFileTreeUpdate(projectId, featureName, userContext);
      } else {
        // Degraded fallback — direct file-level collapse only.
        const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
        const adapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
        await adapter.collapseAll(reason, jobId, turnId);
      }

      logger.info(
        `Feature context reset (project=${projectId}, feature=${featureName}, reason=${reason}, path=${deps.chatService ? 'chat-service' : 'file-only'})`,
        { component: 'FeatureLog' },
      );
      res.json({ success: true, reason, jobId, turnId });
    } catch (error: any) {
      logger.error('Feature context reset error', { component: 'FeatureLog' }, error);
      sendErrorResponse(res, 500, error, 'FeatureLog');
    }
  });

  return router;
}
