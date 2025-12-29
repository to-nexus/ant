import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import { 
  HttpServerPort, 
  JobExecutionPort, 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry,
  TaskQueueUpdatePort,
  FileTreeUpdatePort,
  WorkflowStateUpdatePort
} from '../../../core/ports';
import type { InterruptionDetails } from '../../../core/types';
import { UserContext } from '../../../core/types/user';
import * as fs from 'fs';
import * as path from 'path';
import { 
  KanbanService,
  SessionService, 
  DevServerService, 
  ProjectService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService,
  SSEService
} from './services';
import {
  createJobRoutes,
  createKanbanRoutes,
  createDevServerRoutes,
  createWorkflowRoutes,
  createSSERoutes,
  createAuthRoutes,
  createIDERoutes,
  createCloudIDERoutes,  // ✅ Cloud IDE routes
  createApiRoutes  // ✅ NEW: Unified API routes
} from './routes';
import { createDevServerProxyMiddleware } from './middleware/devServerProxy';
import { FileJobPrerequisitesAdapter } from '../prerequisites/FileJobPrerequisitesAdapter';
import { WorkspaceResolver, LocalWorkspaceResolver, CloudWorkspaceResolver } from '../../../infrastructure/workspace/WorkspaceResolver';
import { WorkspaceServiceAdapter } from '../../../infrastructure/workspace/WorkspaceServiceAdapter';
import { WorkspaceServicePort } from '../../../core/ports/workspace';
import { AuthService } from '../../../infrastructure/auth/AuthService';
import { GitHubAuthService } from '../auth/GitHubAuthService';
import { PortManager } from '../../../infrastructure/networking/PortManager';
import { InMemoryPortRegistry } from '../../../infrastructure/networking/InMemoryPortRegistry';
import { PortRegistryPort } from '../../../core/ports/portRegistry';
import { IDEService } from '../ide/IDEService';
import { logger } from '../../../utils/logger';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer
 * Implements HttpServerPort and JobExecutionPort using Express framework.
 * 
 * Coordinates services and routes, delegating business logic to service layer.
 */
export class ExpressServerAdapter implements HttpServerPort, JobExecutionPort, TaskQueueUpdatePort, FileTreeUpdatePort, WorkflowStateUpdatePort {
  private app: Express;
  private server: any;
  private running: boolean = false;
  
  // Singleton instance for global access
  private static instance: ExpressServerAdapter | null = null;
  
  // Mode configuration
  private readonly mode: 'local' | 'cloud';
  private readonly workspacesPath: string;  // ✅ Physical workspaces directory path
  private readonly cloudUrl: string;
  private readonly workspaceService: WorkspaceServicePort;  // ✅ Multi-tenant workspace service
  private readonly workspaceResolver: WorkspaceResolver;  // ✅ Adapter for legacy services
  private readonly authService?: AuthService;
  private readonly portManager: PortManager;  // ✅ Dynamic port allocation
  private readonly portRegistry: PortRegistryPort;  // ✅ Port mapping storage
  private readonly ideService: IDEService;  // ✅ IDE container management
  
  // Services
  private kanbanService: KanbanService;
  private sessionService: SessionService;
  private gitWatcherService: any;  // ✅ Git watcher service
  private devServerService: DevServerService;
  private projectService: ProjectService;
  private chatService: ChatService;
  private graphMetadataService: GraphMetadataService;
  private workflowStateService: WorkflowStateService;
  private sseService: SSEService;  // ✅ Unified SSE service
  private githubAuthService: GitHubAuthService;  // ✅ GitHub Auth service
  private jobPrerequisitesAdapter: FileJobPrerequisitesAdapter;
  
  // Job tracking (agent execution instances)
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private sseResponses: Map<string, Set<Response>> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private currentJobId: string | null = null;
  
  // Kanban tracking (Task Board tasks - maintained for coordination between services)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
    completedTasks: any[];  // ✅ Add completed tasks to live snapshot
    recursionCount?: number;  // ✅ Current recursion iteration
    recursionLimit?: number;  // ✅ Maximum recursion limit
  }> = new Map();
  private jobToProject: Map<string, { 
    projectId: string; 
    featureName: string; 
    jobType: 'design' | 'code' | 'learn';
    userContext?: UserContext;  // ✅ Store user context for Cloud mode path resolution
  }> = new Map();
  private userStoppedJobs: Set<string> = new Set();  // ✅ Track user-stopped jobs to prevent duplicate cleanup
  
  /**
   * Get current job ID (for CLI subprocess)
   * First tries environment variable, then falls back to instance
   */
  static getCurrentJobId(): string | null {
    // ✅ Priority 1: Environment variable (for child processes)
    if (process.env.ANT_JOB_ID) {
      return process.env.ANT_JOB_ID;
    }
    // Priority 2: Instance (for parent process)
    return ExpressServerAdapter.instance?.currentJobId || null;
  }
  
  /**
   * Check if job is completed (all tasks done)
   */
  private isJobCompleted(sessionState: any): boolean {
    // Job is completed if:
    // 1. No tasks remaining in queue AND
    // 2. No current task AND
    // 3. Has completed tasks OR has jobTiming.completedAt
    const hasNoRemainingWork = 
      (!sessionState.taskQueue || sessionState.taskQueue.length === 0) &&
      !sessionState.currentTask;
    
    const hasCompletionMarker = 
      (sessionState.completedTasks && sessionState.completedTasks.length > 0) ||
      sessionState.jobTiming?.completedAt;
    
    return hasNoRemainingWork && hasCompletionMarker;
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   * Note: This manages Task Board tasks, not job execution
   */
  updateTaskQueue(
    jobId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  ): void {
    logger.debug(`updateTaskQueue`, {
      component: 'ExpressServerAdapter',
      jobId
    }, {
      currentTask: currentTask?.name || null,
      queueLength: queue.length,
      completedTasks: completedTasks !== undefined ? completedTasks.length : undefined,
      recursionCount,
      recursionLimit
    });
    
    // ✅ CRITICAL: Preserve existing completed tasks if not provided
    const existingSnapshot = this.taskQueueSnapshots.get(jobId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    logger.debug(`finalCompletedTasks length=${finalCompletedTasks.length}`, { component: 'ExpressServerAdapter', jobId });
    
    // ✅ Read recursion limit from environment variable (fallback: existing > 50)
    const MIN_RECURSION_LIMIT = 5;
    const envRecursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const defaultRecursionLimit = (isNaN(envRecursionLimit) || envRecursionLimit < MIN_RECURSION_LIMIT) 
      ? 50  // Default fallback
      : envRecursionLimit;
    
    // Update local snapshot for coordination
    this.taskQueueSnapshots.set(jobId, { 
      currentTask: currentTask ? {
        ...currentTask,
        tokenUsage: tokenUsage || currentTask.tokenUsage  // ✅ Real-time token usage
      } : null,
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || defaultRecursionLimit
    });
    
    // ✅ Broadcast immediately to Kanban clients via SSE service
    const mapping = this.jobToProject.get(jobId);
    if (mapping) {
      const jobStatus = this.jobs.get(jobId);
      const task = jobStatus?.task;
      const jobType: 'design' | 'code' | 'learn' = 
        (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
      
      this.kanbanService.getKanbanData(
        mapping.projectId, 
        mapping.featureName,
        jobType,
        this.jobToProject,
        this.jobs,
        this.taskQueueSnapshots,
        mapping.userContext  // ✅ Pass user context for Cloud mode
      ).then(kanbanData => {
        this.sseService.broadcast(mapping.projectId, mapping.featureName, 'kanban', kanbanData, mapping.userContext);
      });
    }
  }
  
  /**
   * Clean up job state when stopped (called when job is terminated)
   * 
   * @param interruptionReason - Optional interruption details to save to session
   */
  async cleanupJobState(
    jobId: string, 
    projectId?: string, 
    featureName?: string,
    interruptionReason?: InterruptionDetails,
    explicitJobType?: 'design' | 'code' | 'learn',
    userContext?: { userId: string; organizationId: string; workspacePath: string }
  ): Promise<void> {
    logger.info(`cleanupJobState`, { component: 'ExpressServerAdapter', jobId }, {
      projectId,
      featureName,
      interruptionReason: interruptionReason?.reason,
      explicitJobType
    });
    
    // ✅ Get mapping before deletion (includes jobType!)
    let mapping = this.jobToProject.get(jobId);
    
    // ✅ If mapping not found in Map (e.g., after page refresh), use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { 
        projectId, 
        featureName, 
        jobType: explicitJobType || 'code',  // Fallback to explicit or default
        userContext  // ✅ CRITICAL: Include userContext for Cloud mode
      };
      logger.debug(`Using provided mapping`, { component: 'ExpressServerAdapter', jobId }, mapping);
    }
    
    // Get current snapshot to return in-progress task to queue
    const snapshot = this.taskQueueSnapshots.get(jobId);
    
    // ✅ CRITICAL: Determine job type (priority: mapping > explicit > jobStatus > default)
    const jobStatus = this.jobs.get(jobId);
    const jobType = mapping?.jobType || explicitJobType || (jobStatus?.task as 'design' | 'code' | 'learn') || 'code';
    const jobTypeSource = mapping?.jobType ? 'mapping' : explicitJobType ? 'explicit' : jobStatus?.task ? 'jobStatus' : 'default';
    logger.debug(`Job type determined: ${jobType} (source: ${jobTypeSource})`, { component: 'ExpressServerAdapter', jobId });
    
    // ✅ End workflow tracking
    this.workflowStateService.endJob(jobId);
    
    // ✅ Finalize any active chat message (converts streaming file cards to completed with cancelled flag)
    if (mapping && this.chatService) {
      this.chatService.finalizeCurrentMessage(mapping.projectId, mapping.featureName || 'skeleton', true);  // cancelled: true
    }
    
  // ✅ Move in-progress task back to queue in session file
  if (mapping) {
    try {
      // ✅ Use WorkspaceResolver to get correct path (Cloud/Local)
      const effectiveUserContext = userContext || mapping.userContext || {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
      
      const featurePath = this.workspaceResolver.getFeaturePath(
        effectiveUserContext,
        mapping.projectId,
        mapping.featureName || 'skeleton'
      );
      const sessionPath = path.join(featurePath, 'sessions', `${jobType}.json`);
      logger.debug(`Session file resolved`, { component: 'ExpressServerAdapter', jobId }, { sessionPath });
      
      const sessionData = await this.sessionService.readSessionData(
        mapping.projectId, 
        mapping.featureName || 'skeleton',
        jobType,
        effectiveUserContext  // ✅ Pass user context
      );
      
      // ✅ CRITICAL: Always broadcast, even if no session file exists yet
      // This ensures UI shows the stopped state immediately
      let shouldBroadcast = true;
      
      if (sessionData?.state) {
        // Check if there's a currentTask to move back (either from snapshot or session file)
        const taskToReturn = snapshot?.currentTask || sessionData.state.currentTask;
        
        if (taskToReturn) {
          // Mark task as interrupted
          const interruptedTask = {
            ...taskToReturn,
            interrupted: true
          };
          
          // ✅ Put currentTask back at the front of the queue (filter out duplicates)
          const existingQueue = sessionData.state.taskQueue || [];
          const filteredQueue = existingQueue.filter((task: any) => task.id !== taskToReturn.id);
          const updatedQueue = [
            interruptedTask,
            ...filteredQueue
          ];
          
          // ✅ CRITICAL: Only update taskQueue, preserve ALL other fields
          // This includes pausedDueToLimit, tasksRemaining, completedTasksDetails, etc.
          sessionData.state = {
            ...sessionData.state,  // ✅ Preserve all existing fields
            taskQueue: updatedQueue,
            currentTask: undefined  // Remove currentTask
          };
          
          logger.debug(`Moved interrupted task back to queue`, { component: 'ExpressServerAdapter', jobId }, { taskName: interruptedTask.name });
        } else {
          logger.debug(`No currentTask to return`, { component: 'ExpressServerAdapter', jobId });
          
          // ✅ Even if no task to return, preserve all state fields
          sessionData.state = {
            ...sessionData.state
          };
        }
        
        // ✨ Update jobTiming with pausedAt
        if (sessionData.state.jobTiming) {
          sessionData.state.jobTiming = {
            ...sessionData.state.jobTiming,
            pausedAt: new Date().toISOString()
          };
          logger.debug(`Updated jobTiming.pausedAt`, { component: 'ExpressServerAdapter', jobId });
        }
        
        // ✅ NEW: Save interruption details if provided
        if (interruptionReason) {
          sessionData.state.interruption = interruptionReason;
          logger.debug(`Saved interruption reason: ${interruptionReason.reason}`, { component: 'ExpressServerAdapter', jobId });
          
          // ✅ NOTE: Keep jobId in session (needed for UI display)
          // Auto-restore prevention is handled by frontend userStoppedJobId check
        }
        
        // ✅ Log preserved state for debugging
        logger.debug(`Preserving session state`, { component: 'ExpressServerAdapter', jobId }, {
          sessionJobId: sessionData.state.jobId,
          hasInterruption: !!sessionData.state.interruption,
          interruptionReason: sessionData.state.interruption?.reason,
          recursionCount: sessionData.state.recursionCount,
          recursionLimit: sessionData.state.recursionLimit,
          completedTasksDetailsCount: sessionData.state.completedTasksDetails?.length || 0
        });
        
        // Write updated session (preserving ALL fields including pausedDueToLimit, completedTasksDetails)
        await fs.promises.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      } else {
        // ✅ No session file yet - create minimal session with interruption if provided
        logger.debug(`No session file found - creating minimal session with interruption`, { component: 'ExpressServerAdapter', jobId });
        
        if (interruptionReason) {
          const minimalSession = {
            sessionId: crypto.randomUUID(),
            projectId: mapping.projectId,
            featureName: mapping.featureName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            turns: [],
            state: {
              taskQueue: [],
              completedTasks: [],
              completedTasksDetails: [],
              interruption: interruptionReason
            }
          };
          
          // Ensure directory exists
          await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
          await fs.promises.writeFile(sessionPath, JSON.stringify(minimalSession, null, 2), 'utf-8');
          logger.debug(`Created minimal session with interruption: ${interruptionReason.reason}`, { component: 'ExpressServerAdapter', jobId });
        }
      }
      
      // Broadcast final update to notify UI that job has stopped
      if (shouldBroadcast) {
        logger.debug(`Broadcasting final Kanban update`, { component: 'ExpressServerAdapter', jobId });
        this.kanbanService.getKanbanData(
          mapping.projectId, 
          mapping.featureName,
          jobType,
          this.jobToProject,
          this.jobs,
          this.taskQueueSnapshots,
          effectiveUserContext  // ✅ Use effectiveUserContext (supports fallback mapping)
        ).then(kanbanData => {
          this.sseService.broadcast(mapping.projectId, mapping.featureName, 'kanban', kanbanData, effectiveUserContext);
          
          // ✅ CRITICAL: Clear live data AFTER broadcast (so UI can see final state)
          this.taskQueueSnapshots.delete(jobId);
          this.jobToProject.delete(jobId);
          this.jobs.delete(jobId);
          
          if (this.currentJobId === jobId) {
            this.currentJobId = null;
          }
        }).catch(err => {
          logger.warn(`Failed to broadcast Kanban update`, { component: 'ExpressServerAdapter', jobId }, err);
          
          // ✅ Clean up even if broadcast fails
          this.taskQueueSnapshots.delete(jobId);
          this.jobToProject.delete(jobId);
          this.jobs.delete(jobId);
          
          if (this.currentJobId === jobId) {
            this.currentJobId = null;
          }
        });
      } else {
        // ✅ If not broadcasting, still need to clear data
        this.taskQueueSnapshots.delete(jobId);
        this.jobToProject.delete(jobId);
        this.jobs.delete(jobId);
        
        if (this.currentJobId === jobId) {
          this.currentJobId = null;
        }
      }
      
      // ✅ Add cancelled message to chat if interruption occurred
      if (interruptionReason && mapping.projectId && mapping.featureName) {
        this.chatService.addCancelledMessage(
          mapping.projectId,
          mapping.featureName,
          jobId,
          interruptionReason.reason,
          interruptionReason.message,
          effectiveUserContext  // ✅ Use effectiveUserContext (supports fallback mapping)
        );
        logger.debug(`Added cancelled message to chat (reason: ${interruptionReason.reason})`, { component: 'ExpressServerAdapter', jobId });
      }
    } catch (error) {
      logger.error(`Error in cleanupJobState`, { component: 'ExpressServerAdapter', jobId }, error);
    }
  } else {
    logger.warn(`No mapping found, cannot broadcast Kanban update`, { component: 'ExpressServerAdapter', jobId });
  }
  logger.debug(`cleanupJobState completed`, { component: 'ExpressServerAdapter', jobId });
  }
  
  constructor(
    mode: 'local' | 'cloud' = 'local', 
    workspacesPath: string, 
    cloudUrl: string = 'https://ant.nexus.ai',
    workspaceService: WorkspaceServicePort  // ✅ NEW: Inject WorkspaceService
  ) {
    this.app = express();
    
    // Mode configuration
    this.mode = mode;
    this.workspacesPath = workspacesPath;
    this.cloudUrl = cloudUrl;
    this.workspaceService = workspaceService;  // ✅ Store WorkspaceService
    
    // ✅ Create WorkspaceResolver adapter for legacy services
    this.workspaceResolver = new WorkspaceServiceAdapter(workspaceService, workspacesPath);
    
    // ✅ Initialize PortManager, PortRegistry, and IDEService
    this.portManager = new PortManager();
    this.portRegistry = new InMemoryPortRegistry();
    this.ideService = new IDEService(this.portManager, this.portRegistry);
    this.ideService.startIdleChecker();  // Auto-shutdown idle containers
    
    // Initialize AuthService for Cloud mode
    if (mode === 'cloud') {
      this.authService = new AuthService();
    }
    
    logger.info(`Initialized in ${mode.toUpperCase()} mode`, { component: 'ExpressServerAdapter' }, {
      workspacesPath: this.workspacesPath,
      workspaceService: this.workspaceService.constructor.name,
      portManager: this.portManager.constructor.name,
      portRegistry: this.portRegistry.constructor.name,
      ideService: this.ideService.constructor.name
    });
    
    // Initialize services
    // ✅ Services now use WorkspaceResolver for path generation
    this.kanbanService = new KanbanService(this.workspacesPath, this.workspaceResolver);
    this.githubAuthService = new GitHubAuthService(this.workspacesPath);  // ✅ Initialize GitHub Auth service
    this.sseService = new SSEService();
    this.gitWatcherService = new (require('./services/GitWatcherService').GitWatcherService)(this.sseService, this.workspaceResolver);  // ✅ Initialize Git watcher
    this.chatService = new ChatService(this.workspacesPath, this.sseService, this.workspaceResolver);  // ✅ Initialize ChatService first
    this.projectService = new ProjectService(this.workspaceResolver, this.githubAuthService, this.chatService, this.sseService, this.ideService);  // ✅ Inject IDEService for project deletion cleanup
    this.devServerService = new DevServerService(
      this.portManager,  // ✅ Pass PortManager for dynamic port allocation
      this.portRegistry,  // ✅ Pass PortRegistry for port mapping storage
      {
        onStatusChange: (projectId) => {
          // DevServer status broadcasting removed
        }
      },
      this.sseService  // ✅ Pass SSEService for unified SSE management
    );
    
    this.sessionService = new SessionService(this.workspacesPath, {
      onSessionChange: async (projectId, featureName, jobType) => {
        setTimeout(async () => {
          // ✅ CRITICAL: Check if live data exists before broadcasting session data
          // This prevents race condition where session watcher broadcasts stale data
          // while decompose/plan nodes have already updated live snapshot
          
          // ✅ Find userContext from jobToProject map
          let userContext: UserContext | undefined;
          for (const [jobId, mapping] of this.jobToProject.entries()) {
            if (mapping.projectId === projectId && mapping.featureName === featureName) {
              userContext = mapping.userContext;
              break;
            }
          }
          
          // Fallback for Local mode
          if (!userContext) {
            userContext = {
              userId: 'local',
              organizationId: 'local',
              workspacePath: ''
            };
          }
          
          const sessionData = await this.sessionService.readSessionData(projectId, featureName, jobType, userContext);
          const sessionJobId = sessionData?.state?.jobId;
          const hasLiveSnapshot = sessionJobId ? this.taskQueueSnapshots.has(sessionJobId) : false;
          
          if (hasLiveSnapshot) {
            logger.debug(`[SessionWatcher] Skipping broadcast - live snapshot exists for ${sessionJobId}`, { component: 'SessionWatcher', jobId: sessionJobId });
            // ✅ Still broadcast to trigger UI update, but getKanbanData will use live data
          }
          
          const kanbanData = await this.kanbanService.getKanbanData(
            projectId, 
            featureName,
            jobType,
            this.jobToProject,
            this.jobs,
            this.taskQueueSnapshots,
            userContext  // ✅ Pass user context for Cloud mode
          );
          this.sseService.broadcast(projectId, featureName, 'kanban', kanbanData, userContext);
          
          const fileTree = await this.projectService.getFileTree(projectId, featureName, userContext);
          this.sseService.broadcast(projectId, featureName, 'fileTree', { type: 'update', tree: fileTree }, userContext);
        }, 50);
      }
    }, this.workspaceResolver);  // ✅ Pass WorkspaceResolver to SessionService
    
    this.graphMetadataService = new GraphMetadataService();
    this.workflowStateService = new WorkflowStateService(this.sseService);
    this.chatService = new ChatService(this.workspacesPath, this.sseService, this.workspaceResolver);
    this.jobPrerequisitesAdapter = new FileJobPrerequisitesAdapter(this.workspaceResolver);
    
    this.setupMiddleware();
    this.setupRoutes();
    
    ExpressServerAdapter.instance = this;
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): ExpressServerAdapter | null {
    return ExpressServerAdapter.instance;
  }
  
  private setupMiddleware(): void {
    // ✅ Configure CORS to support credentials
    this.app.use(cors({
      origin: true,  // Allow the requesting origin (supports localhost:4200, etc.)
      credentials: true  // Allow credentials (cookies)
    }));

    // ✅ Avoid noisy 401s for browsers requesting a favicon on the platform origin (cloud auth mode).
    // Dev servers typically serve their own favicon under /dev/:serverKey/, but browsers still probe /favicon.ico.
    this.app.get('/favicon.ico', (_req: Request, res: Response) => {
      res.status(204).end();
    });
    
    // ✅ Dev Server Proxy Middleware (handles /dev/:serverKey requests)
    // IMPORTANT: Must be registered BEFORE body parsers, so we can stream the original request
    // body to upstream dev servers (fullstack API calls, file uploads, etc.).
    this.app.use(createDevServerProxyMiddleware({
      portRegistry: this.portRegistry,
      pathPrefix: '/dev',
      // ✅ Fullstack: allow /dev/:serverKey/api/* to target the backend port
      getBackendPort: ({ tenantId, userId, projectId, feature }) => {
        try {
          return this.devServerService.getDevServerStatus(tenantId, userId, projectId, feature).backendPort;
        } catch {
          return undefined;
        }
      }
    }));

    // Body parsers for Ant platform APIs (must come AFTER /dev proxy)
    this.app.use(express.json({ limit: '50mb' }));
    
    // Cloud mode: Add authentication middleware
    if (this.mode === 'cloud' && this.authService) {
      this.app.use(async (req: Request, res: Response, next: NextFunction) => {
        // Skip auth for public pages, auth endpoints, and metadata APIs
        const publicPaths = [
          '/api/health',
          '/api/system/config',              // ✅ System configuration (backendMode, recursionLimit)
          '/api/agents',  // Agent list is public
          '/',
          '/local',
          '/api/auth/signup',
          '/api/auth/signin',
          '/api/auth/signout',
          '/api/internal/task-queue',        // ✅ Internal endpoint for child processes (has ANT_USER_EMAIL env var)
          '/api/internal/file-tree-update',  // ✅ Internal endpoint for file tree updates
          '/api/figma/oauth/authorize',      // ✅ Figma OAuth start (needs userContext from query)
          '/api/figma/oauth/callback',       // ✅ Figma OAuth callback (userContext from state)
        ];
        
        // ✅ Specific internal endpoints that should skip auth (child processes)
        const internalEndpoints = [
          '/api/jobs/queue/next',             // Child process polling
          '/api/jobs/queue/complete',         // Child process completion
          '/api/internal/task-queue',         // Already in publicPaths but for clarity
          '/api/internal/file-tree-update',   // File tree update notifications
        ];
        
        // Skip auth for SSE endpoints (EventSource doesn't support headers)
        // TODO: Implement query-based auth for SSE endpoints
        const isSSEEndpoint = req.path.includes('/stream');
        
        // ✅ Skip auth for dev server proxy requests
        const isDevServerRequest = req.path.startsWith('/dev/');

        // ✅ Skip auth for IDE proxy requests (IDE itself does not attach headers)
        const isIDERequest = req.path.startsWith('/ide/');
        
        // Check if path should skip auth
        const isPublicPath = publicPaths.includes(req.path);
        const isInternalEndpoint = internalEndpoints.some(p => req.path.startsWith(p));
        const isGraphMetadata = req.path.includes('/graph-metadata');
        
        if (isPublicPath || isInternalEndpoint || isGraphMetadata || isSSEEndpoint || isDevServerRequest || isIDERequest) {
          return next();
        }
        
        try {
          // ✅ Check both header and query parameter for user email
          const emailFromHeader = req.headers['x-user-email'] as string;
          const emailFromQuery = req.query['user-email'] as string;
          const email = emailFromHeader || emailFromQuery;
          
          if (!email) {
            return res.status(401).json({ 
              error: 'Authentication required', 
              message: 'x-user-email header or user-email query parameter is required in cloud mode' 
            });
          }
          
          const authContext = await this.authService!.authenticate({ email });
          
          // Attach user context to request
          req.user = authContext.user;
          req.organization = authContext.organization;
          
          // ✅ Only log auth for non-polling endpoints (reduce noise)
          if (!req.path.includes('/projects') && !req.path.includes('/session') && !req.path.includes('/stream')) {
            logger.debug(`[Auth] ${authContext.user.id}@${authContext.organization.id}`, { component: 'Auth', organizationId: authContext.organization.id, userId: authContext.user.id });
          }
          
          next();
        } catch (error: any) {
          logger.warn(`[Auth] Authentication failed: ${error.message}`, { component: 'Auth' }, error);
          return res.status(401).json({ 
            error: 'Authentication failed', 
            message: error.message 
          });
        }
      });
    }
  }
  
  private setupRoutes(): void {
    // ========================================
    // Mode-specific Root Routes
    // ========================================
    
    if (this.mode === 'local') {
      // Local Mode: Redirect root to cloud
      this.app.get('/', (req: Request, res: Response) => {
        res.redirect(this.cloudUrl);
      });
    } else {
      // Cloud Mode: Show /local info page
      this.app.get('/local', (req: Request, res: Response) => {
        res.send(this.getLocalModeInfoPage());
      });
      
      // Cloud Mode: Root serves the main app (handled by ant-ui)
      this.app.get('/', (req: Request, res: Response) => {
        res.json({
          mode: 'cloud',
          message: 'ANT Works Cloud Service',
          documentation: '/local'
        });
      });
    }
    
    // ========================================
    // API Routes
    // ========================================
    
    // Internal API for task queue updates (from child processes)
    this.app.post('/api/internal/task-queue', express.json(), (req: Request, res: Response) => {
      const { taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit } = req.body;
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }
      this.updateTaskQueue(taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit);
      res.json({ success: true });
    });
    
    // ✅ Internal endpoint for file tree updates (called by child processes)
    this.app.post('/api/internal/file-tree-update', express.json(), (req: Request, res: Response) => {
      const { projectId, featureName } = req.body;
      if (!projectId || !featureName) {
        return res.status(400).json({ error: 'projectId and featureName are required' });
      }
      
      // Fire and forget - non-blocking
      this.notifyFileTreeUpdate(projectId, featureName)
        .catch(err => logger.warn('[FileTreeUpdate] Error', { component: 'FileTreeUpdate', projectId, featureName }, err));
      
      res.json({ success: true });
    });
    
    // Auth routes (Cloud Mode only - public, no auth middleware)
    if (this.mode === 'cloud' && this.authService) {
      const authRoutes = createAuthRoutes({
        authService: this.authService,
        workspaceResolver: this.workspaceResolver
      });
      this.app.use('/api', authRoutes);
    }
    
    // ✅ NEW: Unified API routes (health, agents, projects, features, files, chat, github, figma)
    const apiRoutes = createApiRoutes({
      projectService: this.projectService,
      chatService: this.chatService,
      githubAuthService: this.githubAuthService,  // ✅ Pass GitHub Auth service
      workspaceRoot: this.workspacesPath,  // ✅ Pass workspace root for Figma OAuth
      workspaceResolver: this.workspaceResolver  // ✅ Pass workspace resolver for Figma Files
    });
    this.app.use('/api', apiRoutes);
    
    // IDE routes (Local Mode only - opens local IDE apps)
    if (this.mode === 'local') {
      const ideRoutes = createIDERoutes();
      this.app.use('/api', ideRoutes);
    }
    
    // Cloud IDE routes (code-server containers)
    // ✅ Available in BOTH local & cloud mode (cloud mode needs this to ensure project-level isolation)
    const cloudIDERoutes = createCloudIDERoutes(this.ideService, this.workspaceResolver);
    this.app.use('/api/cloud-ide', cloudIDERoutes);
    
    // Kanban routes
    const kanbanRoutes = createKanbanRoutes({
      kanbanService: this.kanbanService,
      kanbanSSE: new Map(), // Legacy SSE - deprecated
      jobToProject: this.jobToProject,
      jobs: this.jobs,
      taskQueueSnapshots: this.taskQueueSnapshots,
      watchSessionFile: this.watchSessionFile.bind(this)
    });
    this.app.use('/api', kanbanRoutes);
    
    // Dev server routes
    const devServerRoutes = createDevServerRoutes({
      projectService: this.projectService,
      devServerService: this.devServerService,
      workspaceResolver: this.workspaceResolver  // ✅ Pass WorkspaceResolver for Cloud mode path resolution
    });
    this.app.use('/api', devServerRoutes);
    
    // Workflow routes (LangGraph visualization)
    const workflowRoutes = createWorkflowRoutes({
      graphMetadataService: this.graphMetadataService,
      workflowStateService: this.workflowStateService
    });
    this.app.use('/api', workflowRoutes);
    
    // ✅ Unified SSE routes (consolidates kanban, chat, fileTree, workflow)
    const sseRoutes = createSSERoutes({
      sseService: this.sseService,
      kanbanService: this.kanbanService,
      chatService: this.chatService,
      projectService: this.projectService,
      workflowStateService: this.workflowStateService,
      gitWatcherService: this.gitWatcherService,  // ✅ Pass Git watcher service
      jobToProject: this.jobToProject,
      jobs: this.jobs,
      taskQueueSnapshots: this.taskQueueSnapshots
    });
    this.app.use('/api', sseRoutes);
    
    // Job execution routes
    const jobRoutes = createJobRoutes({
      workspaceResolver: this.workspaceResolver,  // ✅ WorkspaceResolver 사용
      executeJob: this.executeJob.bind(this),
      getJobStatus: this.getJobStatus.bind(this),
      getLogs: this.getLogs.bind(this),
      logStreams: this.logStreams,
      sseResponses: this.sseResponses,
      logs: this.logs,
      childProcesses: this.childProcesses,
      jobs: this.jobs,
      jobToProject: this.jobToProject,  // ✅ For checking duplicate jobs per feature
      userStoppedJobs: this.userStoppedJobs,  // ✅ Track user-stopped jobs
      cleanupJobState: this.cleanupJobState.bind(this),
      workflowStateService: this.workflowStateService,  // ✅ CRITICAL: Pass for node tracking
      chatService: this.chatService  // ✅ For adding cancelled messages
    });
    this.app.use('/api', jobRoutes);
  }
  
  // =====================================
  // JobExecutionPort implementation
  // =====================================
  
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    // ✅ Validate required feature parameter first
    if (!params.feature) {
      throw new Error('Feature name is required for job execution');
    }
    
    const projectId = params.project;
    const featureName = params.feature;
    
    // Determine job type
    const jobType = (params.jobType === 'design' || params.jobType === 'code' || params.jobType === 'learn') 
      ? params.jobType 
      : 'code';
    
    // Generate jobId (use explicit jobId from params if provided, e.g., from Resume API)
    const jobId = params.jobId || `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
    const isResume = !!params.jobId;  // Resume if jobId was explicitly provided
    logger.info(`executeJob`, {
      component: 'ExpressServerAdapter',
      organizationId: params.userContext?.organizationId,
      userId: params.userContext?.userId,
      projectId,
      featureName,
      jobId
    }, {
      agent: params.agent,
      jobType: params.jobType,
      resume: isResume
    });
    
    // ✅ VALIDATE PREREQUISITES (skip if resuming - already validated)
    if (!isResume) {
      logger.debug(`Validating prerequisites`, { component: 'Prerequisites', jobId, projectId, featureName });
      
      const validationResult = await this.jobPrerequisitesAdapter.validate(
        projectId,
        featureName,
        jobType,
        params.userContext,    // ✅ Pass user context
        params.overrideDirective  // ✅ Pass override directive (from chat)
      );
      
      if (!validationResult.isValid) {
        logger.warn(`Prerequisites validation failed`, { component: 'Prerequisites', jobId, projectId, featureName }, { errorMessage: validationResult.errorMessage });
        
        // Return validation error
        return {
          jobId,
          success: false,
          error: validationResult.errorMessage,
          missingMaterials: validationResult.missingMaterials
        };
      }
      logger.debug(`Prerequisites OK`, { component: 'Prerequisites', jobId, projectId, featureName });
    } else {
      logger.debug(`Skipping prerequisites (resume)`, { component: 'Prerequisites', jobId, projectId, featureName });
    }
    
    // Initialize job tracking
    this.jobs.set(jobId, {
      jobId,
      status: 'pending',
      task: jobType,  // ✅ Track job type
      startedAt: new Date().toISOString()
    });
    this.logs.set(jobId, []);
    
    logger.debug(`Job status set to pending`, { component: 'ExpressServerAdapter', jobId, projectId, featureName });
    
    // Map jobId to project/feature/jobType for Kanban tracking
    this.jobToProject.set(jobId, { projectId, featureName, jobType, userContext: params.userContext });  // ✅ Store userContext
    
    logger.debug(`Job mapped`, { component: 'ExpressServerAdapter', jobId, projectId, featureName }, { totalJobs: this.jobToProject.size });
    
    
    // ✅ Start workflow tracking for Agent Workflow visualization
    this.startJob(jobId);
    logger.debug(`Workflow tracking started`, { component: 'ExpressServerAdapter', jobId, projectId, featureName });
    
    // Start session file watcher for real-time Kanban updates
    this.watchSessionFile(jobId, projectId, featureName, jobType);  // ✅ Use narrowed jobType
    logger.debug(`Session file watcher started`, { component: 'ExpressServerAdapter', jobId, projectId, featureName });
    
    // Broadcast immediately to show "estimating" state
    this.kanbanService.getKanbanData(
      projectId, 
      featureName,
      jobType,
      this.jobToProject,
      this.jobs,
      this.taskQueueSnapshots,
      params.userContext  // ✅ Pass user context for Cloud mode
    ).then(kanbanData => {
      this.sseService.broadcast(projectId, featureName, 'kanban', kanbanData, params.userContext);
    });
    
    // Start job execution in child process (non-blocking)
    this.runJob(jobId, params).catch(error => {
      logger.error(`Job ${jobId} failed`, { component: 'ExpressServerAdapter', jobId, projectId, featureName }, error);
    });

    return {
      jobId,
      success: true,
      message: 'Job started'
    };
  }
  
  /**
   * Run job in child process
   */
  private async runJob(jobId: string, params: ExecuteJobParams): Promise<void> {
    const status = this.jobs.get(jobId)!;
    status.status = 'running';
    this.currentJobId = jobId;
    
    try {
      // Build ant CLI command
      const antCliSrc = path.join(process.cwd(), 'src/index.ts');
      const args = [
        antCliSrc,
        params.agent,
        params.jobType
      ];
      
      // ✅ Add input file or feature path as positional argument
      if (params.inputFile) {
        args.push(params.inputFile);
      } else if (params.feature && params.userContext) {
        // Calculate feature path using WorkspaceService
        const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
        const handle = await this.workspaceService.createWorkspace(tenantId, params.project);
        const featurePath = path.join(handle.storagePath, 'features', params.feature);
        args.push(featurePath);
      }
      
      if (params.mode && params.jobType === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.jobType === 'code') {
        args.push('--eval');
      }
      
      logger.debug(`[runJob] Final CLI args`, { component: 'ExpressServerAdapter', jobId }, args);
      
      
      const { spawn } = await import('child_process');
      
      // ✅ Require userContext for path generation - no fallback
      if (!params.userContext) {
        throw new Error('userContext is required to run jobs. Authentication failed.');
      }
      
      // ✅ Use WorkspaceService to get workspace handle and paths
      const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
      const handle = await this.workspaceService.createWorkspace(tenantId, params.project);
      
      const projectPath = handle.storagePath;
      const featurePath = params.feature
        ? path.join(handle.storagePath, 'features', params.feature)
        : projectPath;
      
      logger.debug(`[runJob] Workspace paths resolved`, { component: 'ExpressServerAdapter', jobId, organizationId: params.userContext.organizationId, userId: params.userContext.userId, projectId: params.project, featureName: params.feature }, {
        tenantId,
        projectPath,
        featurePath
      });
      
      // ✅ Ensure PATH includes common locations for git and other tools
      const ensuredPath = process.env.PATH 
        ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
        : '/usr/local/bin:/usr/bin:/bin';
      
      // ✅ Build user email for authentication (Cloud mode needs this for HTTP client auth)
      const userEmail = params.userContext 
        ? `${params.userContext.userId}@${params.userContext.organizationId}` 
        : undefined;
      
      // ✅ Build isolated environment for child process
      // Only whitelist safe system variables, avoid copying all process.env
      const childEnv: Record<string, string> = {
        // System essentials
        PATH: ensuredPath,
        HOME: process.env.HOME || '/tmp',
        USER: process.env.USER || 'ant',
        LANG: process.env.LANG || 'en_US.UTF-8',
        
        // Node.js configuration
        NODE_ENV: process.env.NODE_ENV || 'production',
        
        // Ant-specific (job-scoped)
        ANT_JOB_ID: jobId,
        ANT_CLI_PORT: process.env.ANT_CLI_PORT || '4100',
        ANT_PROJECT_ID: params.project || '',
        ANT_FEATURE_NAME: params.feature || '',
        ANT_PROJECT_PATH: projectPath,
        ANT_FEATURE_PATH: featurePath,
        
        // Optional parameters
        ...(userEmail && { ANT_USER_EMAIL: userEmail }),
        ...(params.overrideDirective && { ANT_OVERRIDE_DIRECTIVE: params.overrideDirective }),
        ...(params.chatSource && { ANT_CHAT_SOURCE: 'true' })
      };
      
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: childEnv,  // ✅ Use isolated environment
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });
      
      this.childProcesses.set(jobId, childProcess);
      
      // Line buffering for stdout/stderr
      let stdoutBuffer = '';
      let stderrBuffer = '';
      
      const flushBuffer = (buffer: string, type: 'stdout' | 'stderr') => {
        if (!buffer) return;
        
        const logEntry: LogEntry = {
          type,
          message: buffer,
          timestamp: new Date().toISOString()
        };
        
        this.logs.get(jobId)!.push(logEntry);
        this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
        
        if (type === 'stdout') {
          process.stdout.write(buffer);
        } else {
          process.stderr.write(buffer);
        }
      };
      
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.substring(0, newlineIndex + 1);
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stdout');
        }
      });
      
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
          const line = stderrBuffer.substring(0, newlineIndex + 1);
          stderrBuffer = stderrBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stderr');
        }
      });
      
      await new Promise<void>((resolve, reject) => {
        childProcess.on('exit', async (code, signal) => {
          this.childProcesses.delete(jobId);
          
          if (stdoutBuffer) flushBuffer(stdoutBuffer, 'stdout');
          if (stderrBuffer) flushBuffer(stderrBuffer, 'stderr');
          
          if (code === 0) {
            // ✅ CRITICAL: Check session for interruption details (recursion limit, etc.)
            // Even with exit code 0, the task may be paused/interrupted
            const mapping = this.jobToProject.get(jobId);
            let interruption: InterruptionDetails | undefined;
            
            if (mapping) {
              try {
                const sessionData = await this.sessionService.readSessionData(
                  mapping.projectId, 
                  mapping.featureName || 'skeleton',
                  mapping.jobType || 'code',
                  mapping.userContext  // ✅ Pass userContext for Cloud mode
                );
                if (sessionData?.state?.interruption) {
                  const sessionInterruption = sessionData.state.interruption;
                  interruption = sessionInterruption;
                  logger.debug(`Session has interruption: ${sessionInterruption.reason}`, { component: 'ExpressServerAdapter', jobId });
                  
                  // Update status to 'paused' instead of 'completed'
                  status.status = 'paused';
                  status.completedAt = new Date().toISOString();
                  
                  const logEntry: LogEntry = {
                    type: 'stdout',
                    message: `\n⏸️  Job paused: ${sessionInterruption.message}`,
                    timestamp: new Date().toISOString()
                  };
                  this.logs.get(jobId)!.push(logEntry);
                  this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
                } else {
                  // True completion (no interruption)
                  status.status = 'completed';
                  status.completedAt = new Date().toISOString();
                  
                  const logEntry: LogEntry = {
                    type: 'stdout',
                    message: '\n✅ Job completed successfully!',
                    timestamp: new Date().toISOString()
                  };
                  this.logs.get(jobId)!.push(logEntry);
                  this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
                }
              } catch (error) {
                logger.warn(`Failed to read session for interruption check`, { component: 'ExpressServerAdapter', jobId }, error);
                // Fallback to completed
                status.status = 'completed';
                status.completedAt = new Date().toISOString();
                
                const logEntry: LogEntry = {
                  type: 'stdout',
                  message: '\n✅ Job completed successfully!',
                  timestamp: new Date().toISOString()
                };
                this.logs.get(jobId)!.push(logEntry);
                this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
              }
            } else {
              // No mapping, assume completed
              status.status = 'completed';
              status.completedAt = new Date().toISOString();
              
              const logEntry: LogEntry = {
                type: 'stdout',
                message: '\n✅ Job completed successfully!',
                timestamp: new Date().toISOString()
              };
              this.logs.get(jobId)!.push(logEntry);
              this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            }
            
            // ✅ Clean up job state (pass interruption if exists)
            logger.debug(`Job completed, calling cleanupJobState (interruption=${interruption ? interruption.reason : 'none'})`, { component: 'ExpressServerAdapter', jobId });
            await this.cleanupJobState(jobId, params.project, params.feature, interruption);
            logger.debug(`cleanupJobState completed`, { component: 'ExpressServerAdapter', jobId });
            
            resolve();
          } else {
            // ✅ Check if this is a user-initiated stop (exit code 143 = SIGTERM)
            const isUserStop = code === 143 || signal === 'SIGTERM';
            
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            
            // ✅ Only add error message if NOT a user stop (to avoid duplicate messages)
            if (!isUserStop) {
              const logEntry: LogEntry = {
                type: 'stderr',
                message: signal 
                  ? `\n🛑 Job stopped by user (${signal})`
                  : `\n❌ Job failed with exit code ${code}`,
                timestamp: new Date().toISOString()
              };
              this.logs.get(jobId)!.push(logEntry);
              this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            } else {
              logger.debug(`Exit code 143/SIGTERM detected - user stop; skipping error message`, { component: 'ExpressServerAdapter', jobId });
            }
            
            // ✅ Analyze logs to determine interruption reason
            let interruption: InterruptionDetails | undefined;
            
            // ✅ User stop (exit code 143 = SIGTERM) - create user_stopped interruption
            if (isUserStop) {
              interruption = {
                reason: 'user_stopped',
                message: 'Task stopped by user',
                timestamp: new Date().toISOString(),
                canResume: true,
                metadata: {
                  exitCode: code,
                  signal: signal || 'SIGTERM',
                  stoppedBy: 'user_action'
                }
              };
            } else if (!signal) {
              // Get all stderr logs for analysis
              const allLogs = this.logs.get(jobId) || [];
              const stderrLogs = allLogs
                .filter(log => log.type === 'stderr')
                .map(log => log.message)
                .join('\n');
              
              // Check for specific API error patterns
              const overloadedMatch = stderrLogs.match(/overloaded_error|overloaded/i);
              const rateLimitMatch = stderrLogs.match(/rate_limit_error|rate.*limit/i);
              const authErrorMatch = stderrLogs.match(/invalid_api_key|authentication_error|unauthorized/i);
              const modelNotFoundMatch = stderrLogs.match(/404.*?model.*?not.*?found/i);
              const modelNameMatch = stderrLogs.match(/model:\s*([^\s"]+)/i);
              
              // Check if this is any API error (generic detection)
              const isApiError = stderrLogs.match(/Error:.*?"type":\s*"error"|api.*error|llm.*error|llm.*api.*failed|critical.*error.*llm/i);
              
              if (overloadedMatch) {
                // API overloaded - temporary issue
                interruption = {
                  reason: 'api_error',
                  message: `LLM API is currently overloaded. Please try again in a few moments.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'api_overloaded',
                    exitCode: code,
                    suggestion: 'Wait a few minutes and resume the task'
                  }
                };
              } else if (rateLimitMatch) {
                // Rate limit exceeded
                interruption = {
                  reason: 'api_error',
                  message: `LLM API rate limit exceeded. Please wait before resuming.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'rate_limit',
                    exitCode: code,
                    suggestion: 'Wait for rate limit to reset'
                  }
                };
              } else if (authErrorMatch) {
                // Authentication error
                interruption = {
                  reason: 'api_error',
                  message: `LLM API authentication failed. Please check your API key.`,
                  timestamp: new Date().toISOString(),
                  canResume: false,
                  metadata: {
                    errorType: 'authentication',
                    exitCode: code,
                    suggestion: 'Verify API key in environment variables'
                  }
                };
              } else if (modelNotFoundMatch) {
                // Model not found
                const modelName = modelNameMatch ? modelNameMatch[1] : 'unknown';
                interruption = {
                  reason: 'api_error',
                  message: `LLM model not found or unavailable: ${modelName}`,
                  timestamp: new Date().toISOString(),
                  canResume: false,
                  metadata: {
                    errorType: 'model_not_found',
                    modelName: modelName,
                    exitCode: code,
                    suggestion: 'Check model name in config'
                  }
                };
              } else if (isApiError) {
                // Generic API error (catch-all for unrecognized API errors)
                interruption = {
                  reason: 'api_error',
                  message: `LLM API error occurred. Check logs for details.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'unknown_api_error',
                    exitCode: code,
                    suggestion: 'Review error logs and try again'
                  }
                };
              } else {
                // Process crash (not API-related)
                interruption = {
                  reason: 'process_crash',
                  message: `Process crashed with exit code ${code}`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    exitCode: code,
                    signal: signal
                  }
                };
              }
            }
            
            // ✅ CRITICAL: Don't cleanup if user explicitly stopped (already handled in Stop API)
            if (this.userStoppedJobs.has(jobId)) {
              logger.debug(`Job was user-stopped; skipping exit handler cleanup`, { component: 'ExpressServerAdapter', jobId });
              this.userStoppedJobs.delete(jobId);  // Clean up flag
              resolve();  // ✅ Resolve (not reject) since Stop API already handled cleanup
              return;
            }
            
            // Only cleanup for natural failures (not user stops)
            logger.debug(`Job failed naturally, calling cleanupJobState`, { component: 'ExpressServerAdapter', jobId });
            await this.cleanupJobState(jobId, params.project, params.feature, interruption);
            logger.debug(`cleanupJobState completed`, { component: 'ExpressServerAdapter', jobId });
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', async (error) => {
          this.childProcesses.delete(jobId);
          
          status.status = 'failed';
          status.completedAt = new Date().toISOString();
          status.error = error.message;
          
          const logEntry: LogEntry = {
            type: 'stderr',
            message: `\n❌ Process error: ${error.message}`,
            timestamp: new Date().toISOString()
          };
          this.logs.get(jobId)!.push(logEntry);
          this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
          
          // ✅ Create interruption details for process error
          const interruption: InterruptionDetails = {
            reason: 'process_crash',
            message: `Process error: ${error.message}`,
            timestamp: new Date().toISOString(),
            canResume: true,
            metadata: {
              errorType: 'process_error',
              errorMessage: error.message
            }
          };
          
          await this.cleanupJobState(jobId, params.project, params.feature, interruption);
          
          reject(error);
        });
      });
    } catch (error: any) {
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      
      const logEntry: LogEntry = {
        type: 'stderr',
        message: `\n❌ Job failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      this.logs.get(jobId)!.push(logEntry);
      this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
      
      // ✅ Only cleanup if not already cleaned up (check if job still exists in maps)
      if (this.jobs.has(jobId) || this.jobToProject.has(jobId)) {
        logger.debug(`runJob.catch -> calling cleanupJobState`, { component: 'ExpressServerAdapter', jobId });
        
        // ✅ Create interruption details for job startup/execution failure
        const interruption: InterruptionDetails = {
          reason: 'unknown',
          message: `Job execution failed: ${error.message}`,
          timestamp: new Date().toISOString(),
          canResume: true,
          metadata: {
            errorType: 'execution_failure',
            errorMessage: error.message,
            stack: error.stack
          }
        };
        
        await this.cleanupJobState(jobId, params.project, params.feature, interruption);
      } else {
        logger.debug(`runJob.catch -> already cleaned up; skipping duplicate cleanup`, { component: 'ExpressServerAdapter', jobId });
      }
    } finally {
      if (this.currentJobId === jobId) {
        this.currentJobId = null;
      }
    }
  }
  
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }
  
  getLogs(jobId: string): LogEntry[] {
    return this.logs.get(jobId) || [];
  }
  
  async *streamLogs(jobId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(jobId) || [];
    
    // Yield existing logs
    for (const log of logs) {
      yield log;
    }
  }
  
  // =====================================
  // Kanban-related methods
  // =====================================
  
  /**
   * Watch session file for changes
   */
  private watchSessionFile(jobId: string, projectId: string, featureName: string, task: string): void {
    const sseClientChecker = () => {
      const mapping = this.jobToProject.get(jobId);
      return this.sseService.getClientCount(projectId, featureName, mapping?.userContext) > 0;
    };
    
    // Map task to job type
    const job = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
    const mapping = this.jobToProject.get(jobId);
    const userContext: UserContext = mapping?.userContext || {
      userId: 'local',
      organizationId: 'local',
      workspacePath: ''
    };
    
    this.sessionService.watchSessionFile(projectId, featureName, job, userContext, sseClientChecker);
  }
  
  /**
   * Notify file tree update (implements FileTreeUpdatePort)
   */
  async notifyFileTreeUpdate(projectId: string, featureName: string): Promise<void> {
    try {
      logger.debug(`[FileTreeUpdate] Updating`, { component: 'FileTreeUpdate', projectId, featureName });
      
      // ✅ Find userContext from jobToProject map
      let userContext: UserContext | undefined;
      for (const [jobId, mapping] of this.jobToProject.entries()) {
        if (mapping.projectId === projectId && mapping.featureName === featureName) {
          userContext = mapping.userContext;
          break;
        }
      }
      
      // Fallback for Local mode
      if (!userContext) {
        userContext = {
          userId: 'local',
          organizationId: 'local',
          workspacePath: ''
        };
      }
      
      const fileTree = await this.projectService.getFileTree(projectId, featureName, userContext);
      const clientCount = this.sseService.getClientCount(projectId, featureName, userContext);
      logger.debug(`[FileTreeUpdate] Broadcasting to ${clientCount} client(s)`, { component: 'ExpressServerAdapter', projectId, featureName, organizationId: userContext.organizationId, userId: userContext.userId });
      this.sseService.broadcast(projectId, featureName, 'fileTree', { type: 'update', tree: fileTree }, userContext);
    } catch (error) {
      logger.warn(`[FileTreeUpdate] Error`, { component: 'FileTreeUpdate', projectId, featureName }, error);
    }
  }
  
  // =====================================
  // WorkflowStateUpdatePort implementation
  // =====================================
  
  /**
   * Start workflow tracking for a job
   */
  startJob(jobId: string, llmInfo?: import('../../../core/ports/workflow').LLMInfo): void {
    logger.debug(`startJob`, { component: 'ExpressServerAdapter', jobId }, llmInfo);
    this.workflowStateService.startJob(jobId, llmInfo);
  }
  
  /**
   * Track node entry
   * ✅ Returns Promise to ensure SSE ordering
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: import('../../../core/ports/workflow').TaskInfo, llmInfo?: import('../../../core/ports/workflow').LLMInfo, recursionCount?: number, recursionLimit?: number): Promise<void> {
    logger.debug(`enterNode: ${nodeId}`, { component: 'ExpressServerAdapter', jobId }, { task: taskInfo?.name, llm: llmInfo });
    await this.workflowStateService.enterNode(jobId, nodeId, taskInfo, llmInfo, recursionCount, recursionLimit);
  }
  
  /**
   * Track node exit
   */
  exitNode(jobId: string, nodeId: string): void {
    this.workflowStateService.exitNode(jobId, nodeId);
  }
  
  /**
   * Track actor interaction start
   */
  startActorInteraction(jobId: string, actorId: string): void {
    this.workflowStateService.startActorInteraction(jobId, actorId);
  }
  
  /**
   * Track actor interaction end
   */
  endActorInteraction(jobId: string, actorId: string): void {
    this.workflowStateService.endActorInteraction(jobId, actorId);
  }
  
  /**
   * End workflow tracking for a job
   */
  endJob(jobId: string): void {
    this.workflowStateService.endJob(jobId);
  }
  
  // =====================================
  // HttpServerPort implementation
  // =====================================
  
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.running = true;
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Graceful shutdown with job state preservation
   * 
   * Steps:
   * 1. Save all running jobs to session files
   * 2. Terminate all child processes
   * 3. Cleanup services
   * 4. Close HTTP server
   * 
   * Timeout: 5 seconds (force shutdown if exceeded)
   */
  async stop(): Promise<void> {
    logger.info('Graceful shutdown initiated', { component: 'Server' });
    
    const SHUTDOWN_TIMEOUT = 5000;  // 5 seconds
    
    return new Promise((resolve) => {
      // Timeout timer - force shutdown if taking too long
      const timeoutId = setTimeout(() => {
        logger.warn('Shutdown timeout (5s) - forcing exit', { component: 'Server' });
        this.forceShutdown();
        resolve();
      }, SHUTDOWN_TIMEOUT);
      
      // Actual shutdown logic
      this.performGracefulShutdown()
        .then(() => {
          clearTimeout(timeoutId);
          logger.info('Graceful shutdown complete', { component: 'Server' });
          resolve();
        })
        .catch((error) => {
          logger.error('Shutdown error', { component: 'Server' }, error);
          clearTimeout(timeoutId);
          this.forceShutdown();
          resolve();
        });
    });
  }
  
  /**
   * Perform graceful shutdown in steps
   */
  private async performGracefulShutdown(): Promise<void> {
    // Step 1: Save all running jobs
    await this.saveAllRunningJobs();
    
    // Step 2: Terminate all child processes
    await this.terminateAllChildProcesses();
    
    // Step 3: Cleanup services (async now)
    await this.cleanupServices();
    
    // Step 4: Close HTTP server
    await this.closeHttpServer();
  }
  
  /**
   * Save all running jobs to session files before shutdown
   */
  private async saveAllRunningJobs(): Promise<void> {
    const jobCount = this.childProcesses.size;
    
    if (jobCount === 0) {
      logger.debug('No running jobs to save', { component: 'Server' });
      return;
    }
    
    logger.info(`Saving ${jobCount} running job(s)...`, { component: 'Server' });
    
    const savePromises: Promise<void>[] = [];
    
    for (const [jobId, childProcess] of this.childProcesses.entries()) {
      const mapping = this.jobToProject.get(jobId);
      
      if (!mapping) {
        logger.warn(`No mapping found for job ${jobId}, skipping save`, { component: 'Server', jobId });
        continue;
      }
      
      logger.debug(`Saving job`, { component: 'Server', jobId, projectId: mapping.projectId, featureName: mapping.featureName });
      
      // Call cleanupJobState which saves the session
      const savePromise = this.cleanupJobState(
        jobId,
        mapping.projectId,
        mapping.featureName,
        {
          reason: 'server_shutdown',
          message: 'Server is shutting down',
          canResume: true,
          timestamp: new Date().toISOString()
        },
        mapping.jobType
      ).catch((error) => {
        logger.warn(`Failed to save job: ${error.message}`, { component: 'Server', jobId }, error);
        // Continue with other jobs even if one fails
      });
      
      savePromises.push(savePromise);
    }
    
    // Wait for all saves to complete (or fail)
    await Promise.all(savePromises);
    logger.info(`All jobs saved (${jobCount} total)`, { component: 'Server' });
  }
  
  /**
   * Terminate all child processes gracefully
   */
  private async terminateAllChildProcesses(): Promise<void> {
    const processCount = this.childProcesses.size;
    
    if (processCount === 0) {
      logger.debug('No child processes to terminate', { component: 'Server' });
      return;
    }
    
    logger.info(`Terminating ${processCount} child process(es)...`, { component: 'Server' });
    
    const killPromises: Promise<void>[] = [];
    
    for (const [jobId, childProcess] of this.childProcesses.entries()) {
      const killPromise = this.terminateChildProcess(jobId, childProcess);
      killPromises.push(killPromise);
    }
    
    await Promise.all(killPromises);
    this.childProcesses.clear();
    logger.info(`All child processes terminated (${processCount} total)`, { component: 'Server' });
  }
  
  /**
   * Terminate a single child process gracefully
   */
  private async terminateChildProcess(jobId: string, proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (!proc.pid) {
        logger.debug(`Job ${jobId}: No PID, skipping...`, { component: 'Server', jobId });
        resolve();
        return;
      }
      
      const pid = proc.pid;
      logger.debug(`Terminating job (PID: ${pid})...`, { component: 'Server', jobId });
      
      // Send SIGTERM for graceful termination
      proc.kill('SIGTERM');
      
      // Wait 2 seconds for graceful exit
      const forceKillTimer = setTimeout(() => {
        try {
          // Check if process is still alive
          process.kill(pid, 0);
          logger.warn(`Job didn't exit gracefully, sending SIGKILL...`, { component: 'Server', jobId });
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already dead
        }
        resolve();
      }, 2000);
      
      // Listen for exit event
      proc.once('exit', (code) => {
        clearTimeout(forceKillTimer);
        logger.debug(`Job terminated (exit code: ${code})`, { component: 'Server', jobId });
        resolve();
      });
    });
  }
  
  /**
   * Cleanup all services and in-memory state
   */
  private async cleanupServices(): Promise<void> {
    logger.info('Cleaning up services...', { component: 'Server' });
    
    // Cleanup SessionService
    try {
      this.sessionService?.cleanup();
      logger.debug('SessionService cleaned', { component: 'Server' });
    } catch (error) {
      logger.warn('SessionService cleanup error', { component: 'Server' }, error);
    }
    
    // Cleanup DevServerService
    try {
      if (this.devServerService && typeof (this.devServerService as any).cleanup === 'function') {
        await (this.devServerService as any).cleanup();
        logger.debug('DevServerService cleaned', { component: 'Server' });
      }
    } catch (error) {
      logger.warn('DevServerService cleanup error', { component: 'Server' }, error);
    }
    
    // Cleanup IDEService
    try {
      if (this.ideService && typeof (this.ideService as any).cleanup === 'function') {
        await (this.ideService as any).cleanup();
        logger.debug('IDEService cleaned', { component: 'Server' });
      }
    } catch (error) {
      logger.warn('IDEService cleanup error', { component: 'Server' }, error);
    }
    
    // Clear in-memory state
    this.taskQueueSnapshots.clear();
    this.jobToProject.clear();
    this.jobs.clear();
    this.logs.clear();
    this.logStreams.clear();
    this.sseResponses.clear();
    
    logger.debug('In-memory state cleared', { component: 'Server' });
  }
  
  /**
   * Close HTTP server
   */
  private async closeHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      
      logger.info('Closing HTTP server...', { component: 'Server' });
      
      this.server.close((err?: Error) => {
        if (err) {
          logger.warn('Error closing HTTP server', { component: 'Server' }, err);
        } else {
          logger.info('HTTP server closed', { component: 'Server' });
        }
        this.running = false;
        resolve();
      });
    });
  }
  
  /**
   * Force shutdown (emergency fallback)
   */
  private forceShutdown(): void {
    logger.warn('Force shutdown initiated...', { component: 'Server' });
    
    // Kill all processes immediately with SIGKILL
    this.childProcesses.forEach((proc) => {
      if (proc.pid) {
        try {
          process.kill(proc.pid, 'SIGKILL');
          logger.warn(`Force killed PID ${proc.pid}`, { component: 'Server' });
        } catch {
          // Ignore errors
        }
      }
    });
    this.childProcesses.clear();
    
    // Close server without waiting
    if (this.server) {
      this.server.close();
      this.running = false;
    }
    
    logger.warn('Force shutdown complete', { component: 'Server' });
  }
  
  isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Generate Local Mode Info Page HTML
   */
  private getLocalModeInfoPage(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ANT Works - Local Mode</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      line-height: 1.6;
      color: #333;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .container {
      max-width: 800px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 60px;
      animation: fadeIn 0.5s ease-out;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    h1 {
      font-size: 2.5em;
      margin-bottom: 20px;
      color: #667eea;
      font-weight: 700;
    }
    
    .subtitle {
      font-size: 1.2em;
      color: #666;
      margin-bottom: 40px;
    }
    
    h2 {
      font-size: 1.8em;
      margin-top: 40px;
      margin-bottom: 20px;
      color: #333;
      font-weight: 600;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }
    
    p {
      margin-bottom: 20px;
      font-size: 1.1em;
      color: #555;
    }
    
    .highlight {
      background: #f0f4ff;
      border-left: 4px solid #667eea;
      padding: 20px;
      border-radius: 8px;
      margin: 30px 0;
    }
    
    .highlight p {
      margin-bottom: 10px;
    }
    
    .highlight p:last-child {
      margin-bottom: 0;
    }
    
    code {
      background: #f5f5f5;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
      color: #e83e8c;
    }
    
    .code-block {
      background: #2d2d2d;
      color: #f8f8f2;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 0.95em;
      line-height: 1.5;
    }
    
    .btn {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 15px 30px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 1.1em;
      transition: all 0.3s ease;
      margin-top: 20px;
    }
    
    .btn:hover {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }
    
    ul {
      list-style: none;
      padding-left: 0;
    }
    
    li {
      margin-bottom: 15px;
      padding-left: 30px;
      position: relative;
      font-size: 1.05em;
      color: #555;
    }
    
    li:before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #667eea;
      font-weight: bold;
      font-size: 1.2em;
    }
    
    .comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 30px 0;
    }
    
    .comparison-item {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      border: 2px solid #e0e0e0;
    }
    
    .comparison-item h3 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 1.3em;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 40px 30px;
      }
      
      h1 {
        font-size: 2em;
      }
      
      .comparison {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏠 ANT Works - Local Mode</h1>
    <p class="subtitle">Run AI-powered development tools on your machine</p>
    
    <div class="highlight">
      <p><strong>⚠️ Important:</strong> Local mode requires running ANT Works on your own machine. This gives you full control over your data and infrastructure.</p>
    </div>
    
    <h2>How to Run Local Mode</h2>
    
    <p>Clone the repository and start the server:</p>
    
    <div class="code-block">
# Clone the repository
git clone https://github.com/to-nexus/ant.git
cd ant

# Install dependencies
pnpm install

# Set up environment variables
cd packages/ant-cli
cp .env.example .env
# Edit .env and add your API keys

# Start local server
pnpm dev:cli
    </div>
    
    <h2>Local vs Cloud Mode</h2>
    
    <div class="comparison">
      <div class="comparison-item">
        <h3>☁️ Cloud Mode</h3>
        <ul>
          <li>Multi-user support</li>
          <li>No installation needed</li>
          <li>Managed infrastructure</li>
          <li>Organization-level isolation</li>
          <li>Automatic updates</li>
        </ul>
      </div>
      
      <div class="comparison-item">
        <h3>💻 Local Mode</h3>
        <ul>
          <li>Single user</li>
          <li>Full data control</li>
          <li>Customizable setup</li>
          <li>No network dependency</li>
          <li>Direct file access</li>
        </ul>
      </div>
    </div>
    
    <h2>Key Differences</h2>
    
    <ul>
      <li><strong>Workspace Structure:</strong> Local uses <code>workspace/&lt;project&gt;</code>, Cloud uses <code>workspaces/&lt;org&gt;/&lt;user&gt;/&lt;project&gt;</code></li>
      <li><strong>Authentication:</strong> Local has no authentication, Cloud requires email-based auth</li>
      <li><strong>Data Storage:</strong> Local stores on your machine, Cloud stores in managed infrastructure</li>
      <li><strong>Scaling:</strong> Local is single-user, Cloud supports multiple users and teams</li>
    </ul>
    
    <h2>When to Use Local Mode</h2>
    
    <ul>
      <li>You want complete control over your data and infrastructure</li>
      <li>You need to work offline or in restricted networks</li>
      <li>You want to customize the system extensively</li>
      <li>You're developing or testing ANT Works itself</li>
      <li>You have specific security or compliance requirements</li>
    </ul>
    
    <div class="highlight">
      <p><strong>💡 Tip:</strong> Most users should use the Cloud version for easier setup and maintenance. Use Local mode only if you have specific requirements.</p>
    </div>
    
    <a href="https://github.com/to-nexus/ant" class="btn" target="_blank">
      View on GitHub →
    </a>
  </div>
</body>
</html>
    `.trim();
  }
}
