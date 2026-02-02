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
    const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';
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
    
    // Register client
    deps.sseService.registerClient(projectId, featureName, res, userContext);
    logger.debug(`Client registered (total: ${deps.sseService.getClientCount(projectId, featureName, userContext)})`, { component: 'SSE', projectId, featureName });
    
    // Send initial states
    try {
      // 1. Send initial Kanban state
      const kanbanData = await deps.kanbanService.getKanbanData(
        projectId,
        featureName,
        job,
        deps.jobToProject,
        deps.jobs,
        deps.taskQueueSnapshots,
        userContext  // ✅ Pass user context
      );
      deps.sseService.sendInitialState(res, 'kanban', kanbanData);
      
      // 2. Send initial Chat messages
      const chatMessages = deps.chatService.getMessages(projectId, featureName, userContext);  // ✅ Pass user context
      deps.sseService.sendInitialState(res, 'chat', { 
        type: 'initial_state', 
        messages: chatMessages,
        projectId,      // ✅ Include for frontend filtering
        featureName     // ✅ Include for frontend filtering
      });
      
      // 3. Send initial FileTree
      const fileTree = await deps.projectService.getFileTree(projectId, featureName, userContext);  // ✅ Pass user context
      deps.sseService.sendInitialState(res, 'fileTree', { 
        type: 'initial', 
        tree: fileTree 
      });
      logger.debug(`Initial states sent`, { component: 'SSE', projectId, featureName });
    } catch (error) {
      logger.warn(`Failed to send initial states`, { component: 'SSE', projectId, featureName }, error);
    }
    
    // ✅ Start watching Git changes
    if (deps.gitWatcherService && userContext) {
      const sseClientChecker = () => deps.sseService.getClientCount(projectId, featureName, userContext) > 0;
      deps.gitWatcherService.watchGitChanges(projectId, featureName, userContext, sseClientChecker);
    }
    
    // Keep connection alive
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(':ping\n\n');
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 30000);
    
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
    
    // Register workflow client
    deps.sseService.registerWorkflowClient(jobId, res);
    
    // Send initial workflow state (if exists) - now async from Redis
    const initialState = await deps.workflowStateService.getInitialState(jobId);
    if (initialState) {
      // activeActors is already an array (serialized for Redis)
      deps.sseService.sendInitialState(res, 'workflow', initialState);
      logger.debug(`Sent initial workflow state`, { component: 'SSE', jobId });
    }
    logger.debug(`Workflow client registered`, { component: 'SSE', jobId });
    
    // Keep connection alive
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(':ping\n\n');
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 30000);
    
    // Handle disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      logger.debug(`Workflow client disconnected`, { component: 'SSE', jobId });
    });
  });
  
  return router;
}

