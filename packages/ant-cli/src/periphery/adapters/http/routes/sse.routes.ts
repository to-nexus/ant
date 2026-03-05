import { Router, Request, Response } from 'express';
import { 
  SSEService, 
  KanbanService, 
  ChatService, 
  ProjectService,
  WorkflowStateService
} from '../services';
import { UserContext } from '../../../../core/types/user';
import { extractUserContext } from './helpers/userContext';
import { logger } from '../../../../utils/logger';
import type { StateStorePort } from '../../../../core/ports/stateStore';

/**
 * Unified SSE Routes
 * Single SSE endpoint that consolidates all real-time updates
 */
export function createSSERoutes(deps: {
  sseService: SSEService;
  kanbanService: KanbanService;
  chatService: ChatService;
  projectService: ProjectService;
  workflowStateService: WorkflowStateService;
  stateStore?: StateStorePort;
  gitWatcherService?: any;  // ✅ Git watcher service
  // workspaceRoot: string;  // ❌ 제거 - 사용하지 않음
  jobToProject?: Map<string, { projectId: string; featureName: string }>;
  jobs?: Map<string, any>;
  taskQueueSnapshots?: Map<string, any>;
}): Router {
  const router = Router();
  
  /**
   * GET /projects/:id/features/:feature/stream
   * Unified SSE endpoint for all real-time updates
   */
  router.get('/projects/:id/features/:feature/stream', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const job = (req.query.job as string) || 'code';
    logger.debug(`Client connecting (job: ${job})`, { component: 'SSE', projectId, featureName });
    
    // ✅ Resolve user context consistently.
    // NOTE: EventSource cannot set headers, so frontend should pass user-email as query param.
    // This helper keeps that as priority #1, with fallbacks for other call sites.
    const userContext: UserContext = extractUserContext(req);
    logger.debug(`User context resolved`, { component: 'SSE', projectId, featureName, organizationId: userContext.organizationId, userId: userContext.userId });
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    // Register client (await ensures Redis Pub/Sub subscription is active before initial state)
    const t0 = Date.now();
    await deps.sseService.registerClient(projectId, featureName, res, userContext);
    logger.debug(`Client registered (total: ${deps.sseService.getClientCount(projectId, featureName, userContext)})`, { component: 'SSE', projectId, featureName });
    logger.info(`[SSE:timing] registerClient=${Date.now() - t0}ms`, { component: 'SSE', projectId, featureName });

    // Send initial states in parallel (Redis subscription is guaranteed active after registerClient).
    // Previously these were sequential awaits, causing fileTree to arrive 4-5s late because
    // getKanbanData reads EFS synchronously (readFileSync) before fileTree could be sent.
    // Now each fetch runs independently and sends as soon as ready.
    try {
      const tStates = Date.now();

      await Promise.all([
        // 1. Kanban (EFS readFileSync + Redis — can be slow)
        deps.kanbanService.getKanbanData(
          projectId,
          featureName,
          job,
          deps.jobToProject,
          deps.jobs,
          deps.taskQueueSnapshots,
          userContext
        ).then(kanbanData => {
          logger.info(`[SSE:timing] kanban=${Date.now() - tStates}ms`, { component: 'SSE', projectId, featureName });
          deps.sseService.sendInitialState(res, 'kanban', kanbanData);
        }).catch(err => {
          logger.warn(`Failed to send initial kanban`, { component: 'SSE', projectId, featureName }, err);
        }),

        // 2. Chat (Redis/EFS — can be slow)
        deps.chatService.getMessagesAsync(projectId, featureName, userContext).then(chatMessages => {
          logger.info(`[SSE:timing] chat=${Date.now() - tStates}ms`, { component: 'SSE', projectId, featureName });
          deps.sseService.sendInitialState(res, 'chat', {
            type: 'initial_state',
            messages: chatMessages,
            projectId,
            featureName
          });
        }).catch(err => {
          logger.warn(`Failed to send initial chat`, { component: 'SSE', projectId, featureName }, err);
        }),

        // 3. FileTree — Redis cache (~5ms), no wait for kanban/chat
        (async () => {
          let fileTree: any[] | null = null;
          let cacheHit = false;
          if (deps.stateStore) {
            try {
              fileTree = await deps.stateStore.getFileTreeCache(userContext.userId, projectId, featureName);
              if (fileTree) cacheHit = true;
            } catch (err) {
              logger.warn(`Failed to read fileTree cache from Redis`, { component: 'SSE', projectId, featureName }, err);
            }
          }
          if (!fileTree) {
            fileTree = await deps.projectService.getFileTree(projectId, featureName, userContext);
            if (deps.stateStore && fileTree) {
              deps.stateStore.setFileTreeCache(userContext.userId, projectId, featureName, fileTree).catch(() => {});
            }
          }
          logger.info(`[SSE:timing] fileTree=${Date.now() - tStates}ms (cacheHit=${cacheHit})`, { component: 'SSE', projectId, featureName });
          deps.sseService.sendInitialState(res, 'fileTree', {
            type: 'initial',
            tree: fileTree
          });
        })().catch(err => {
          logger.warn(`Failed to send initial fileTree`, { component: 'SSE', projectId, featureName }, err);
        }),

        // 4. Unseen Artifacts (Redis SMEMBERS — fast)
        deps.stateStore
          ? deps.stateStore.getUnseenArtifacts(userContext.userId, projectId, featureName).then(unseenPaths => {
              logger.info(`[SSE:timing] unseenArtifacts=${Date.now() - tStates}ms`, { component: 'SSE', projectId, featureName });
              deps.sseService.sendInitialState(res, 'unseenArtifacts', {
                type: 'initial',
                paths: unseenPaths
              });
            }).catch(err => {
              logger.warn(`Failed to send initial unseen artifacts`, { component: 'SSE', projectId, featureName }, err);
            })
          : Promise.resolve(),
      ]);

      logger.info(`[SSE:timing] all initial states sent total=${Date.now() - tStates}ms`, { component: 'SSE', projectId, featureName });
    } catch (error) {
      logger.warn(`Failed to send initial states`, { component: 'SSE', projectId, featureName }, error);
    }
    
    // ✅ Start watching Git changes
    if (deps.gitWatcherService && userContext) {
      const sseClientChecker = () => deps.sseService.getClientCount(projectId, featureName, userContext) > 0;
      deps.gitWatcherService.watchGitChanges(projectId, featureName, userContext, sseClientChecker);
    }
    
    // Heartbeat: real SSE data event (not comment) so ALB counts it as traffic.
    // 10s interval is well within typical ALB idle-timeout defaults.
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: Date.now() })}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 10000);
    
    // Handle disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      logger.debug(`Client disconnected`, { component: 'SSE', projectId, featureName });
    });
  });
  
  /**
   * GET /jobs/:jobId/workflow/stream
   * Workflow SSE endpoint (per-job)
   */
  router.get('/jobs/:jobId/workflow/stream', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    logger.debug(`Workflow client connecting`, { component: 'SSE', jobId });
    
    // ✅ Resolve user context consistently (query + header + auth).
    const userContext: UserContext = extractUserContext(req);
    logger.debug(`Workflow user context resolved`, { component: 'SSE', jobId, organizationId: userContext.organizationId, userId: userContext.userId });
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    // Register workflow client (await ensures Redis Pub/Sub subscription is active)
    await deps.sseService.registerWorkflowClient(jobId, res, userContext);
    
    // Send initial workflow state (if exists) - Redis subscription now guaranteed active
    const initialState = await deps.workflowStateService.getInitialState(jobId);
    if (initialState) {
      // activeActors is already an array (serialized for Redis)
      deps.sseService.sendInitialState(res, 'workflow', initialState);
      logger.debug(`Sent initial workflow state`, { component: 'SSE', jobId });
    }
    logger.debug(`Workflow client registered`, { component: 'SSE', jobId });
    
    // Heartbeat: real SSE data event (not comment) so ALB counts it as traffic
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: Date.now() })}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 10000);
    
    // Handle disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      logger.debug(`Workflow client disconnected`, { component: 'SSE', jobId });
    });
  });
  
  return router;
}

