import { Router, Request, Response } from 'express';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { FileSessionAdapter } from '../../session/FileSessionAdapter';
import type { LogJobType } from '@ant/shared';
import { logger } from '../../../../utils/logger';

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

  return router;
}
