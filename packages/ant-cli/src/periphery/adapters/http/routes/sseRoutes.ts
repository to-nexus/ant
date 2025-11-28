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
    
    console.log(`\n📡 [SSE] Client connecting: ${projectId}/${featureName} (job: ${job})`);
    
    // ✅ Extract user context from query parameter (for EventSource) or request (for regular auth)
    let userContext: UserContext;
    const userEmailQuery = req.query['user-email'] as string | undefined;
    
    if (userEmailQuery) {
      // EventSource sent user-email as query parameter
      console.log(`[SSE] 🔐 User email from query: ${userEmailQuery}`);
      const userId = userEmailQuery.split('@')[0];
      const domain = userEmailQuery.split('@')[1];
      userContext = {
        userId,
        organizationId: domain,
        workspacePath: ''
      };
    } else if (req.user && req.organization) {
      // Regular auth middleware
      userContext = {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''
      };
    } else {
      // Fallback for Local mode
      userContext = {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
    }
    
    console.log(`[SSE] User context:`, userContext);
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    // Register client
    deps.sseService.registerClient(projectId, featureName, res);
    console.log(`[SSE] Client registered. Total clients: ${deps.sseService.getClientCount(projectId, featureName)}`);
    
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
      console.log(`[SSE] Fetching file tree for ${projectId}/${featureName}...`);
      const fileTree = await deps.projectService.getFileTree(projectId, featureName, userContext);  // ✅ Pass user context
      console.log(`[SSE] File tree fetched: ${fileTree?.length || 0} items`);
      deps.sseService.sendInitialState(res, 'fileTree', { 
        type: 'initial', 
        tree: fileTree 
      });
      console.log(`[SSE] File tree sent to client`);
      
      console.log(`✅ [SSE] Initial states sent to ${projectId}/${featureName}`);
    } catch (error) {
      console.error(`❌ [SSE] Failed to send initial states:`, error);
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
      console.log(`🔌 [SSE] Client disconnected: ${projectId}/${featureName}`);
    });
  });
  
  /**
   * GET /jobs/:jobId/workflow/stream
   * Workflow SSE endpoint (per-job)
   */
  router.get('/jobs/:jobId/workflow/stream', (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    
    console.log(`\n📡 [SSE] Workflow client connecting: ${jobId}`);
    
    // ✅ Extract user context from query parameter (for EventSource) or request (for regular auth)
    let userContext: UserContext;
    const userEmailQuery = req.query['user-email'] as string | undefined;
    
    if (userEmailQuery) {
      // EventSource sent user-email as query parameter
      console.log(`[SSE Workflow] 🔐 User email from query: ${userEmailQuery}`);
      const userId = userEmailQuery.split('@')[0];
      const domain = userEmailQuery.split('@')[1];
      userContext = {
        userId,
        organizationId: domain,
        workspacePath: ''
      };
    } else if (req.user && req.organization) {
      // Regular auth middleware
      userContext = {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''
      };
    } else {
      // Fallback for Local mode
      userContext = {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
    }
    
    console.log(`[SSE Workflow] User context:`, userContext);
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    // Register workflow client
    deps.sseService.registerWorkflowClient(jobId, res);
    
    // Send initial workflow state (if exists)
    const initialState = deps.workflowStateService.getInitialState(jobId);
    if (initialState) {
      const serializedState = {
        ...initialState,
        activeActors: Array.from(initialState.activeActors)
      };
      deps.sseService.sendInitialState(res, 'workflow', serializedState);
      console.log(`✅ [SSE] Sent initial workflow state for ${jobId}`);
    }
    
    console.log(`✅ [SSE] Workflow client registered: ${jobId}`);
    
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
      console.log(`🔌 [SSE] Workflow client disconnected: ${jobId}`);
    });
  });
  
  return router;
}

