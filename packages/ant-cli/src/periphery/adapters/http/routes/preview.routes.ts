/**
 * Preview Routes
 * 
 * Handles preview server management (start, stop, status, logs).
 * Uses PreviewOrchestratorPort for abstraction over local/remote implementations.
 * 
 * Implementations:
 * - Local mode: LocalPreviewOrchestrator (wraps PreviewService)
 * - Cloud mode: RemotePreviewOrchestrator (worker-based)
 */

import { Router, Request, Response } from 'express';
import { PreviewOrchestratorPort, PreviewParams } from '../../../../core/ports/previewOrchestrator';
import { ProjectService } from '../services/ProjectService';
import { extractUserContext } from './helpers/userContext';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../../../utils/logger';

// ============================================
// Types
// ============================================

export interface PreviewRoutesDeps {
  projectService: ProjectService;
  previewOrchestrator: PreviewOrchestratorPort;
  workspaceResolver: WorkspaceResolver;
}

// ============================================
// Route Factory
// ============================================

/**
 * Create preview routes
 * 
 * @param deps - Dependencies including previewOrchestrator
 */
export function createPreviewRoutes(deps: PreviewRoutesDeps): Router {
  const router = Router();
  const { projectService, previewOrchestrator, workspaceResolver } = deps;

  /**
   * Resolve codebase path from project config
   */
  async function resolveCodebasePath(
    projectId: string,
    userContext: ReturnType<typeof extractUserContext>
  ): Promise<{ path: string; error?: string }> {
    const config = await projectService.getProjectConfig(projectId, userContext);

    if (config?.repoType === 'cloud') {
      const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
      return { path: path.join(projectPath, 'codebase') };
    }

    if (!config?.localPath) {
      return { path: '', error: 'Project localPath not configured' };
    }

    const resolvedPath = config.localPath.startsWith('~')
      ? path.join(os.homedir(), config.localPath.slice(1))
      : path.resolve(config.localPath);

    return { path: resolvedPath };
  }

  // ==========================================
  // Routes
  // ==========================================

  /**
   * POST /projects/:id/preview/start
   * Start preview for a project
   * 
   * Body params:
   *   - port?: number - Specific port to use
   *   - feature?: string - Feature name (default: 'main')
   */
  router.post('/projects/:id/preview/start', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = req.body?.feature || 'main';
      const port = req.body?.port;

      logger.warn(`[Preview] POST /preview/start - projectId=${projectId}, user=${userContext?.userId}`, {
        component: 'PreviewRoutes'
      });

      // Resolve codebase path
      const { path: codebasePath, error: pathError } = await resolveCodebasePath(projectId, userContext);
      if (pathError) {
        res.status(400).json({ error: pathError });
        return;
      }

      // Build params for orchestrator
      const params: PreviewParams = {
        tenantId: userContext.organizationId,
        userId: userContext.userId,
        projectId,
        feature,
        workspacePath: codebasePath,
        userContext,
        port
      };

      // Start via orchestrator
      const result = await previewOrchestrator.start(params);

      if (result.success) {
        res.json({
          success: true,
          message: 'Preview started',
          port: result.instance?.port,
          serverKey: result.instance?.instanceId,
          url: result.instance?.url,
          status: {
            running: true,
            ready: result.instance?.status === 'running',
            port: result.instance?.port,
            packages: result.instance?.packages,
            backendPort: result.instance?.backendPort,
            processCount: result.instance?.processCount
          },
          setupReasoning: result.setupReasoning,
          setupReason: result.setupReason,
          suggestedFix: result.suggestedFix,
          issues: result.issues
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          setupReasoning: result.setupReasoning,
          setupReason: result.setupReason,
          suggestedFix: result.suggestedFix,
          issues: result.issues
        });
      }
    } catch (error: any) {
      logger.error(`[Preview] Start error: ${error.message}`, { component: 'PreviewRoutes' }, error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /projects/:id/preview/stop
   * Stop preview for a project
   */
  router.post('/projects/:id/preview/stop', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = req.body?.feature || 'main';

      logger.warn(`[Preview] POST /preview/stop - projectId=${projectId}, user=${userContext?.userId}`, {
        component: 'PreviewRoutes'
      });

      const result = await previewOrchestrator.stop(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error: any) {
      logger.error(`[Preview] Stop error: ${error.message}`, { component: 'PreviewRoutes' }, error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /projects/:id/preview/status
   * Get preview status for a project
   */
  router.get('/projects/:id/preview/status', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = (req.query.feature as string) || 'main';

      // Get status from orchestrator
      const status = previewOrchestrator.getStatus(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );

      // Get logs
      const logs = previewOrchestrator.getLogs(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );

      if (!status) {
        res.json({
          running: false,
          ready: false,
          port: null,
          url: null,
          processCount: 0,
          backendPort: null,
          packages: [],
          issues: [],
          logs: []
        });
        return;
      }

      res.json({
        running: status.status === 'running' || status.status === 'starting',
        ready: status.status === 'running',
        port: status.port || null,
        url: status.url || null,
        processCount: status.processCount || 0,
        backendPort: status.backendPort || null,
        packages: status.packages || [],
        issues: [],
        logs: logs.slice(-50) // Last 50 logs
      });
    } catch (error: any) {
      logger.error(`[Preview] Status error: ${error.message}`, { component: 'PreviewRoutes' }, error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /projects/:id/preview/validate
   * Validate preview setup for a project
   */
  router.get('/projects/:id/preview/validate', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      const feature = (req.query.feature as string) || 'main';

      // Resolve codebase path
      const { path: codebasePath, error: pathError } = await resolveCodebasePath(projectId, userContext);
      if (pathError) {
        res.status(400).json({ error: pathError });
        return;
      }

      const result = await previewOrchestrator.validateSetup(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        codebasePath
      );

      res.json({
        valid: result.isValid,
        issues: result.issues
      });
    } catch (error: any) {
      logger.error(`[Preview] Validate error: ${error.message}`, { component: 'PreviewRoutes' }, error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Deprecated Endpoints
  // ==========================================

  router.get('/projects/:id/preview/logs', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream (unified SSE) instead'
    });
  });

  router.get('/projects/:id/preview/stream', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream (unified SSE) instead'
    });
  });

  return router;
}

// ==========================================
// Backward compatibility aliases (deprecated)
// ==========================================

/** @deprecated Use createPreviewRoutes instead */
export const createDevServerRoutes = createPreviewRoutes;
