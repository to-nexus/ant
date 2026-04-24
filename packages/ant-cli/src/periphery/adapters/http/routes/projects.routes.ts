import { Router, Request, Response } from 'express';
import type {
  GitUserOperation,
  GitUserOperationKind,
  GitStateResponse,
  GitOperationError as GitOperationErrorShape,
} from '@ant/shared';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { validateBody, createProjectSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';
import { GitOperationError } from '../services/GitService/errors';
import type { GitStateBroadcaster } from '../../../../core/realtime/GitStateBroadcaster';

function handleGitError(res: Response, error: any, context: string, projectId: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof GitOperationError) {
    // Expected operational errors (no remote, not initialized, etc.) — no stack trace needed
    logger.warn(`${context} failed: ${message}`, { component: 'Projects', projectId });
    res.status(error.statusCode).json({ success: false, error: message });
  } else {
    logger.warn(`${context} failed: ${message}`, { component: 'Projects', projectId }, error);
    res.status(500).json({ success: false, error: message });
  }
}

function handleStructuredGitError(
  res: Response,
  error: any,
  context: string,
  projectId: string,
): void {
  if (error instanceof GitOperationError) {
    logger.warn(`${context} failed: ${error.message}`, { component: 'Projects', projectId });
    const payload: { success: false; error: GitOperationErrorShape } = {
      success: false,
      error: error.toShape(),
    };
    res.status(error.statusCode).json(payload);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.warn(`${context} failed: ${message}`, { component: 'Projects', projectId }, error);
  res.status(500).json({
    success: false,
    error: {
      kind: 'unknown',
      message,
      retryable: true,
      suggestedAction: null,
    } as GitOperationErrorShape,
  });
}

const GIT_USER_OP_KINDS: ReadonlySet<GitUserOperationKind> = new Set([
  'publish',
  'push',
  'pull',
  'fetch',
  'sync',
  'commit',
  'discard',
  'clone',
]);

function isGitUserOpKind(kind: string): kind is GitUserOperationKind {
  return GIT_USER_OP_KINDS.has(kind as GitUserOperationKind);
}

/**
 * Project CRUD operations
 */
export function createProjectsRoutes(deps: {
  projectService: ProjectService;
  gitWatcherService?: { retryDeferredWatchers(projectId: string): void };
  gitStateBroadcaster?: GitStateBroadcaster;
}): Router {
  const router = Router();
  
  // List projects
  router.get('/projects', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const projects = await deps.projectService.listProjects(userContext);
      
      if (req.user) {
        logger.debug(`Listed ${projects.length} projects`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id });
      }
      
      res.json(projects);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Projects');
    }
  });
  
  // Create a new project
  router.post('/projects', validateBody(createProjectSchema), async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Project ID is required and must be a string' });
      }
      
      const userContext = extractUserContext(req);
      
      if (req.user) {
        logger.info(`Creating project '${id}'`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id, projectId: id });
      }
      
      await deps.projectService.createProject(id, userContext);
      res.json({ success: true, id });
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        res.status(409).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Delete a project
  router.delete('/projects/:id', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      await deps.projectService.deleteProject(projectId, userContext);
      res.json({ success: true, message: `Project ${projectId} deleted` });
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Rename a project
  router.put('/projects/:id/rename', async (req: Request, res: Response) => {
    try {
      const oldId = req.params.id;
      const { newId } = req.body;
      
      if (!newId || typeof newId !== 'string') {
        return res.status(400).json({ error: 'newId is required and must be a string' });
      }
      
      const userContext = extractUserContext(req);
      
      if (req.user) {
        logger.info(`Renaming project '${oldId}' to '${newId}'`, { component: 'Projects', organizationId: req.organization?.id, userId: req.user.id, projectId: oldId });
      }
      
      await deps.projectService.renameProject(oldId, newId, userContext);
      res.json({ success: true, oldId, newId });
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: error.message });
      } else if (error.message === 'A project with the new name already exists') {
        res.status(409).json({ error: error.message });
      } else {
        res.status(400).json({ error: error.message });
      }
    }
  });
  
  // Get project config
  router.get('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      const config = await deps.projectService.getProjectConfig(projectId, userContext);
      res.json(config);
    } catch (error: any) {
      if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Update project config
  router.put('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = req.body;
      const userContext = extractUserContext(req);
      
      await deps.projectService.updateProjectConfig(projectId, config, userContext);
      
      // Return the saved config for immediate UI update
      const savedConfig = await deps.projectService.getProjectConfig(projectId, userContext);
      res.json(savedConfig);
    } catch (error: any) {
      if (error.message.includes('Missing required fields')) {
        res.status(400).json({ error: error.message });
      } else if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Get session for a project (skeleton)
  router.get('/projects/:id/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const userContext = extractUserContext(req);
      
      const sessionData = await deps.projectService.getSession(projectId, 'skeleton', undefined, userContext);
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found') {
        res.json(null);
      } else {
        sendErrorResponse(res, 500, error, 'Projects');
      }
    }
  });
  
  // Clone status polling — bridges the gap for callers that kick off a
  // clone and need to confirm the working tree has materialized. The
  // actual clone dispatch lives at `POST /projects/:id/git/ops/clone`.
  router.get('/projects/:id/clone/status', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const cloned = await deps.projectService.checkCloneStatus(projectId, userContext);
      res.json({ cloned });
    } catch (error: any) {
      handleGitError(res, error, 'Clone status check', projectId);
    }
  });

  // Note: POST /projects/:id/features/:featureName/checkout has been removed.
  // With Git worktrees, each feature has its own working directory with the correct
  // branch already checked out. Branch switching is handled at worktree creation time
  // by WorktreeService.createWorktree().

  // =====================================
  // Greenfield Git API (target surface)
  //
  // Unified endpoints replacing the ten-endpoint surface above. Once the
  // FE migration completes, the legacy endpoints are removed and these
  // two are the sole git REST surface.
  // =====================================

  // Canonical snapshot + PAT probe for a (project, feature). `?fresh=true`
  // bypasses the remoteExists cache so the Setup menu sees an authoritative
  // probe result at open time.
  router.get('/projects/:id/git/state', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const userContext = extractUserContext(req);
      const featureName = req.query.feature as string | undefined;
      const fresh = req.query.fresh === 'true';

      const [snapshot, pat] = await Promise.all([
        deps.projectService.getGitSnapshot(projectId, userContext, featureName, { fresh }),
        deps.projectService.getGitPat(userContext),
      ]);

      const payload: GitStateResponse = { snapshot, pat };
      res.json(payload);
    } catch (error: any) {
      handleStructuredGitError(res, error, 'Git state', projectId);
    }
  });

  // Single entry point for user-initiated Git operations. Path carries the
  // user-op kind; body carries the discriminant-specific fields (message/
  // files/feature). The dispatched GitOperation's `onSuccess` hook
  // uniformly publishes the `gitState` SSE event, retries deferred
  // watchers, and triggers indexing when applicable.
  router.post('/projects/:id/git/ops/:userOp', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const userOpRaw = req.params.userOp;

    if (!isGitUserOpKind(userOpRaw)) {
      return res.status(400).json({
        success: false,
        error: {
          kind: 'unknown',
          message: `Unknown git user op: ${userOpRaw}`,
          retryable: false,
          suggestedAction: null,
        } as GitOperationErrorShape,
      });
    }
    const userOp: GitUserOperation['kind'] = userOpRaw;

    let userContext;
    try {
      userContext = extractUserContext(req);
    } catch (error: any) {
      return handleStructuredGitError(res, error, `Git op ${userOp}`, projectId);
    }

    const operation = deps.projectService.resolveGitOperation(userOp, {
      broadcaster: deps.gitStateBroadcaster,
      watcher: deps.gitWatcherService,
    });
    if (!operation) {
      return res.status(400).json({
        success: false,
        error: {
          kind: 'unknown',
          message: `Unsupported git user op: ${userOp}`,
          retryable: false,
          suggestedAction: null,
        } as GitOperationErrorShape,
      });
    }

    // Slow operations (publish/clone) can exceed proxy idle timeouts — emit
    // a keep-alive heartbeat while the operation runs to keep the connection
    // warm.
    const isSlowOp = userOp === 'publish' || userOp === 'clone' || userOp === 'sync';
    let heartbeat: NodeJS.Timeout | null = null;
    if (isSlowOp) {
      res.setHeader('Content-Type', 'application/json');
      heartbeat = setInterval(() => res.write(' '), 15000);
    }

    logger.info(`Git op ${userOp}`, {
      component: 'Projects',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId,
    });

    try {
      const input = (req.body ?? {}) as Record<string, unknown>;
      const result = await operation.execute(projectId, userContext, input);
      if (heartbeat) clearInterval(heartbeat);
      if (isSlowOp) {
        res.end(JSON.stringify({ success: true, result }));
      } else {
        res.json({ success: true, result });
      }
    } catch (error: any) {
      if (heartbeat) clearInterval(heartbeat);
      if (isSlowOp) {
        const errorPayload = error instanceof GitOperationError
          ? error.toShape()
          : {
              kind: 'unknown' as const,
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
              suggestedAction: null,
            };
        logger.warn(`Git op ${userOp} failed: ${errorPayload.message}`, {
          component: 'Projects',
          projectId,
        });
        res.end(JSON.stringify({ success: false, error: errorPayload }));
        return;
      }
      handleStructuredGitError(res, error, `Git op ${userOp}`, projectId);
    }
  });

  return router;
}

