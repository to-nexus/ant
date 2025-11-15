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
  TaskExecutionService, 
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
  createApiRoutes  // ✅ NEW: Unified API routes
} from './routes';
import { FileJobPrerequisitesAdapter } from '../prerequisites/FileJobPrerequisitesAdapter';
import { WorkspaceResolver, LocalWorkspaceResolver, CloudWorkspaceResolver } from '../../../infrastructure/workspace/WorkspaceResolver';
import { AuthService } from '../../../infrastructure/auth/AuthService';

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
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly authService?: AuthService;
  
  // Services
  private kanbanService: KanbanService;
  private taskExecutionService: TaskExecutionService;
  private sessionService: SessionService;
  private devServerService: DevServerService;
  private projectService: ProjectService;
  private chatService: ChatService;
  private graphMetadataService: GraphMetadataService;
  private workflowStateService: WorkflowStateService;
  private sseService: SSEService;  // ✅ Unified SSE service
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
    recursionLimit?: number
  ): void {
    
    console.log(`\n🔄 [updateTaskQueue] Called for job ${jobId}`);
    console.log(`   currentTask: ${currentTask?.name || 'null'}`);
    console.log(`   currentTask.timing: ${currentTask?.timing ? JSON.stringify(currentTask.timing) : 'null'}`);
    console.log(`   queue length: ${queue.length}`);
    console.log(`   completedTasks param: ${completedTasks !== undefined ? completedTasks.length : 'undefined'}`);
    
    // ✅ CRITICAL: Preserve existing completed tasks if not provided
    const existingSnapshot = this.taskQueueSnapshots.get(jobId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    console.log(`   finalCompletedTasks length: ${finalCompletedTasks.length}`);
    
    // Update local snapshot for coordination
    this.taskQueueSnapshots.set(jobId, { 
      currentTask, 
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || 50
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
        this.sseService.broadcast(mapping.projectId, mapping.featureName, 'kanban', kanbanData);
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
    explicitJobType?: 'design' | 'code' | 'learn'
  ): Promise<void> {
    console.log(`\n🧹 [ExpressServerAdapter] cleanupJobState called for ${jobId}`);
    console.log(`   projectId: ${projectId || 'undefined'}, featureName: ${featureName || 'undefined'}`);
    console.log(`   interruptionReason: ${interruptionReason?.reason || 'none'}`);
    console.log(`   explicitJobType: ${explicitJobType || 'undefined'}`);
    
    // ✅ Get mapping before deletion (includes jobType!)
    let mapping = this.jobToProject.get(jobId);
    
    // ✅ If mapping not found in Map (e.g., after page refresh), use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { 
        projectId, 
        featureName, 
        jobType: explicitJobType || 'code'  // Fallback to explicit or default
      };
      console.log(`   Using provided mapping: ${projectId}/${featureName}/${mapping.jobType}`);
    }
    
    // Get current snapshot to return in-progress task to queue
    const snapshot = this.taskQueueSnapshots.get(jobId);
    console.log(`   Snapshot exists: ${!!snapshot}`);
    
    // ✅ CRITICAL: Determine job type (priority: mapping > explicit > jobStatus > default)
    const jobStatus = this.jobs.get(jobId);
    const jobType = mapping?.jobType || explicitJobType || (jobStatus?.task as 'design' | 'code' | 'learn') || 'code';
    const jobTypeSource = mapping?.jobType ? 'mapping' : explicitJobType ? 'explicit' : jobStatus?.task ? 'jobStatus' : 'default';
    console.log(`   Job type determined: ${jobType} (source: ${jobTypeSource})`);
    
    // ✅ End workflow tracking
    this.workflowStateService.endJob(jobId);
    console.log(`   ✅ Workflow state ended`);
    
    // Clear live data
    this.taskQueueSnapshots.delete(jobId);
    this.jobToProject.delete(jobId);
    this.jobs.delete(jobId);  // ✅ CRITICAL: Delete job status to prevent UI from detecting it as active
    console.log(`   ✅ Cleared live data (snapshot, jobToProject, jobs)`);
    console.log(`   ✅ jobs.size after delete: ${this.jobs.size}`);
    console.log(`   ✅ jobToProject.size after delete: ${this.jobToProject.size}`);
    console.log(`   ✅ taskQueueSnapshots.size after delete: ${this.taskQueueSnapshots.size}`);
    
    if (this.currentJobId === jobId) {
      this.currentJobId = null;
      console.log(`   ✅ Cleared currentJobId`);
    }
    
    
  // ✅ Move in-progress task back to queue in session file
  if (mapping) {
    try {
      // ✅ Use WorkspaceResolver to get correct path (Cloud/Local)
      const userContext = mapping.userContext || {
        userId: 'local',
        organizationId: 'local',
        workspacePath: ''
      };
      
      const featurePath = this.workspaceResolver.getFeaturePath(
        userContext,
        mapping.projectId,
        mapping.featureName || 'skeleton'
      );
      const sessionPath = path.join(featurePath, 'sessions', `${jobType}.json`);
      
      console.log(`   📄 Session file: ${sessionPath}`);
      
      const sessionData = await this.sessionService.readSessionData(
        mapping.projectId, 
        mapping.featureName || 'skeleton',
        jobType,
        userContext  // ✅ Pass user context
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
          
          console.log(`   ✅ Moved interrupted task back to queue: "${interruptedTask.name}"`);
        } else {
          console.log(`   ℹ️  No currentTask to return (already completed or not started)`);
          
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
          console.log(`   ⏰ Updated jobTiming.pausedAt`);
        }
        
        // ✅ NEW: Save interruption details if provided
        if (interruptionReason) {
          sessionData.state.interruption = interruptionReason;
          console.log(`   ✅ Saved interruption reason: ${interruptionReason.reason}`);
          
          // ✅ NOTE: Keep jobId in session (needed for UI display)
          // Auto-restore prevention is handled by frontend userStoppedJobId check
        }
        
        // ✅ Log preserved state for debugging
        console.log(`   ✅ Preserving state:`, {
          jobId: sessionData.state.jobId,  // ✅ CRITICAL: Check if jobId is preserved
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
        console.log(`   ⚠️  No session file found - creating minimal session with interruption`);
        
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
          console.log(`   ✅ Created minimal session with interruption: ${interruptionReason.reason}`);
        }
      }
      
      // Broadcast final update to notify UI that job has stopped
      if (shouldBroadcast) {
        console.log(`   📡 Broadcasting final Kanban update...`);
        this.kanbanService.getKanbanData(
          mapping.projectId, 
          mapping.featureName,
          jobType,
          this.jobToProject,
          this.jobs,
          this.taskQueueSnapshots,
          mapping.userContext  // ✅ Pass user context for Cloud mode
        ).then(kanbanData => {
          console.log(`   ✅ Kanban data source: ${kanbanData.dataSource}`);
          this.sseService.broadcast(mapping.projectId, mapping.featureName, 'kanban', kanbanData);
          console.log(`   ✅ Broadcast complete`);
        }).catch(err => {
          console.error(`   ❌ Failed to broadcast Kanban update:`, err);
        });
      }
    } catch (error) {
      console.error(`   ❌ Error in cleanupJobState:`, error);
    }
  } else {
    console.warn(`   ⚠️  No mapping found for ${jobId}, cannot broadcast Kanban update`);
  }
  }
  
  constructor(mode: 'local' | 'cloud' = 'local', workspacesPath: string, cloudUrl: string = 'https://ant.nexus.ai') {
    this.app = express();
    
    // Mode configuration
    this.mode = mode;
    this.workspacesPath = workspacesPath;
    this.cloudUrl = cloudUrl;
    
    // Initialize WorkspaceResolver
    this.workspaceResolver = mode === 'cloud'
      ? new CloudWorkspaceResolver(this.workspacesPath)
      : new LocalWorkspaceResolver(this.workspacesPath);
    
    // Initialize AuthService for Cloud mode
    if (mode === 'cloud') {
      this.authService = new AuthService();
    }
    
    console.log(`[ExpressServerAdapter] Initialized in ${mode.toUpperCase()} mode`);
    console.log(`   Workspaces: ${this.workspacesPath}`);
    
    // Initialize services
    // ✅ Services now use WorkspaceResolver for path generation
    this.kanbanService = new KanbanService(this.workspacesPath, this.workspaceResolver);
    this.taskExecutionService = new TaskExecutionService(
      this.workspaceResolver,  // ✅ Pass WorkspaceResolver
      {
        onJobStatusChange: (jobId, status) => {
          // ✅ CRITICAL: Don't re-add completed/failed jobs to Map
          // cleanupJobState already handles removal, and re-adding causes
          // frontend to see "estimating" state again
          if (status.status === 'completed' || status.status === 'failed') {
            console.log(`[TaskExecutionService] ⏭️  Skipping jobs.set for ${status.status} job: ${jobId}`);
            return;
          }
          this.jobs.set(jobId, status);
        },
      onLogEntry: (jobId, log) => {
        const logs = this.logs.get(jobId) || [];
        logs.push(log);
        this.logs.set(jobId, logs);
      },
      onJobCompleted: async (jobId) => {
        // ✅ Clean up job state when job completes successfully
        await this.cleanupJobState(jobId);
      }
    });
    this.projectService = new ProjectService(this.workspaceResolver);  // ✅ WorkspaceResolver 사용
    this.sseService = new SSEService();
    this.devServerService = new DevServerService({
      onStatusChange: (projectId) => {
        // DevServer status broadcasting removed
      }
    });
    
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
            console.log(`[SessionWatcher] 🔴 Skipping broadcast - live snapshot exists for ${sessionJobId}`);
            console.log(`[SessionWatcher] Live snapshot will be used instead of session file\n`);
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
          this.sseService.broadcast(projectId, featureName, 'kanban', kanbanData);
          
          const fileTree = await this.projectService.getFileTree(projectId, featureName, userContext);
          this.sseService.broadcast(projectId, featureName, 'fileTree', { type: 'update', tree: fileTree });
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
    this.app.use(express.json({ limit: '50mb' }));
    
    // Cloud mode: Add authentication middleware
    if (this.mode === 'cloud' && this.authService) {
      this.app.use(async (req: Request, res: Response, next: NextFunction) => {
        // Skip auth for public pages, auth endpoints, and metadata APIs
        const publicPaths = [
          '/api/health',
          '/api/agents',  // Agent list is public
          '/',
          '/local',
          '/api/auth/signup',
          '/api/auth/signin',
          '/api/auth/signout',
          '/api/internal/task-queue',  // ✅ Internal endpoint for child processes (has ANT_USER_EMAIL env var)
          '/api/jobs'                   // ✅ Internal endpoints for child processes (workflow updates)
        ];
        
        // Skip auth for SSE endpoints (EventSource doesn't support headers)
        // TODO: Implement query-based auth for SSE endpoints
        const isSSEEndpoint = req.path.includes('/stream');
        
        // Also skip auth for graph metadata (read-only metadata)
        if (publicPaths.includes(req.path) || publicPaths.some(p => req.path.startsWith(p)) || req.path.includes('/graph-metadata') || isSSEEndpoint) {
          return next();
        }
        
        try {
          const email = req.headers['x-user-email'] as string;
          
          if (!email) {
            return res.status(401).json({ 
              error: 'Authentication required', 
              message: 'x-user-email header is required in cloud mode' 
            });
          }
          
          const authContext = await this.authService!.authenticate({ email });
          
          // Attach user context to request
          req.user = authContext.user;
          req.organization = authContext.organization;
          
          // ✅ Only log auth for non-polling endpoints (reduce noise)
          if (!req.path.includes('/projects') && !req.path.includes('/session') && !req.path.includes('/stream')) {
            console.log(`[Auth] ${authContext.user.id}@${authContext.organization.id}`);
          }
          
          next();
        } catch (error: any) {
          console.error('[Auth] Authentication failed:', error);
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
    
    // Auth routes (Cloud Mode only - public, no auth middleware)
    if (this.mode === 'cloud' && this.authService) {
      const authRoutes = createAuthRoutes({
        authService: this.authService,
        workspaceResolver: this.workspaceResolver
      });
      this.app.use('/api', authRoutes);
    }
    
    // ✅ NEW: Unified API routes (health, agents, projects, features, files, chat)
    const apiRoutes = createApiRoutes({
      projectService: this.projectService,
      chatService: this.chatService
    });
    this.app.use('/api', apiRoutes);
    
    // IDE routes (Local Mode only - opens local IDE apps)
    if (this.mode === 'local') {
      const ideRoutes = createIDERoutes();
      this.app.use('/api', ideRoutes);
    }
    
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
      devServerService: this.devServerService
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
      userStoppedJobs: this.userStoppedJobs,  // ✅ Track user-stopped jobs
      cleanupJobState: this.cleanupJobState.bind(this),
      workflowStateService: this.workflowStateService  // ✅ CRITICAL: Pass for node tracking
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
    const jobType = (params.task === 'design' || params.task === 'code' || params.task === 'learn') 
      ? params.task 
      : 'code';
    
    // ✨ NEW: Check session for existing jobId (Resume support)
    let jobId: string;
    let isResume = false;
    
    try {
      const sessionData = await this.sessionService.readSessionData(projectId, featureName, jobType);
      
      // Resume if: session has jobId AND job is not completed
      if (sessionData?.state?.jobId && !this.isJobCompleted(sessionData.state)) {
        jobId = sessionData.state.jobId;
        isResume = true;
        console.log(`\n🔄 [ExecuteJob] Resuming with existing Job ID: ${jobId}`);
      } else {
        // Create new jobId
        jobId = `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
        console.log(`\n🆕 [ExecuteJob] Creating new Job ID: ${jobId}`);
      }
    } catch (error) {
      // Session doesn't exist or error reading - create new jobId
      jobId = `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
      console.log(`\n🆕 [ExecuteJob] No session found, creating new Job ID: ${jobId}`);
    }
    
    console.log(`   Project: ${projectId}`);
    console.log(`   Feature: ${featureName}`);
    console.log(`   Agent: ${params.agent}`);
    console.log(`   Task: ${params.task}`);
    
    // ✅ VALIDATE PREREQUISITES
    console.log(`\n📋 [Prerequisites] Validating required materials...`);
    
    const validationResult = await this.jobPrerequisitesAdapter.validate(
      projectId,
      featureName,
      jobType,
      params.userContext,    // ✅ Pass user context
      params.overrideDirective  // ✅ Pass override directive (from chat)
    );
    
    if (!validationResult.isValid) {
      console.log(`\n❌ [Prerequisites] Validation failed!`);
      console.log(validationResult.errorMessage);
      
      // Return validation error
      return {
        jobId,
        success: false,
        error: validationResult.errorMessage,
        missingMaterials: validationResult.missingMaterials
      };
    }
    
    console.log(`✅ [Prerequisites] All required materials present\n`);
    
    // Initialize job tracking
    this.jobs.set(jobId, {
      jobId,
      status: 'pending',
      task: jobType,  // ✅ Track job type
      startedAt: new Date().toISOString()
    });
    this.logs.set(jobId, []);
    
    console.log(`   ✅ Job status set to 'pending'`);
    
    // Map jobId to project/feature/jobType for Kanban tracking
    this.jobToProject.set(jobId, { projectId, featureName, jobType, userContext: params.userContext });  // ✅ Store userContext
    
    console.log(`   ✅ Job mapped: ${projectId}/${featureName}/${jobType} -> ${jobId}`);
    console.log(`   Total jobs in map: ${this.jobToProject.size}`);
    
    
    // ✅ Start workflow tracking for Agent Workflow visualization
    this.startJob(jobId);
    console.log(`   ✅ Workflow tracking started`);
    
    // Start session file watcher for real-time Kanban updates
    this.watchSessionFile(jobId, projectId, featureName, jobType);  // ✅ Use narrowed jobType
    
    console.log(`   ✅ Session file watcher started`);
    
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
      this.sseService.broadcast(projectId, featureName, 'kanban', kanbanData);
    });
    
    // Start job execution in child process (non-blocking)
    this.runJob(jobId, params).catch(error => {
      console.error(`Job ${jobId} failed:`, error);
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
        params.task
      ];
      
      // ✅ Add input file or feature path as positional argument
      if (params.inputFile) {
        args.push(params.inputFile);
      } else if (params.feature && params.userContext) {
        const featurePath = this.workspaceResolver.getFeaturePath(
          params.userContext,
          params.project,
          params.feature
        );
        args.push(featurePath);
      }
      
      if (params.mode && params.task === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.task === 'code') {
        args.push('--eval');
      }
      
      console.log(`[ExpressServerAdapter.runJob] 🚀 Final CLI args:`, args);
      
      
      const { spawn } = await import('child_process');
      
      // ✅ Require userContext for path generation - no fallback
      if (!params.userContext) {
        throw new Error('userContext is required to run jobs. Authentication failed.');
      }
      
      // Generate full project path and feature path using WorkspaceResolver
      const projectPath = this.workspaceResolver.getProjectPath(params.userContext, params.project);
      const featurePath = params.feature
        ? this.workspaceResolver.getFeaturePath(params.userContext, params.project, params.feature)
        : projectPath;  // If no feature, use project path
      
      console.log(`[ExpressServerAdapter.runJob] 📂 Project path: ${projectPath}`);
      console.log(`[ExpressServerAdapter.runJob] 📂 Feature path: ${featurePath}`);
      
      // ✅ Ensure PATH includes common locations for git and other tools
      const ensuredPath = process.env.PATH 
        ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
        : '/usr/local/bin:/usr/bin:/bin';
      
      // ✅ Build user email for authentication (Cloud mode needs this for HTTP client auth)
      const userEmail = params.userContext 
        ? `${params.userContext.userId}@${params.userContext.organizationId}` 
        : undefined;
      
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { 
          ...process.env,
          PATH: ensuredPath,  // ✅ Explicitly ensure PATH includes standard locations
          ANT_JOB_ID: jobId,  // ✅ Pass jobId via environment variable
          ANT_SERVER_PORT: '4100',  // ✅ Pass server port for HTTP updates
          ANT_PROJECT_ID: params.project || '',  // ✅ Pass project ID
          ANT_FEATURE_NAME: params.feature || '',  // ✅ Pass feature name
          ANT_PROJECT_PATH: projectPath,  // ✅ Pass full project path for config.json
          ANT_FEATURE_PATH: featurePath,  // ✅ Pass full feature path for outputs (used by command.ts for logging)
          ...(userEmail && { ANT_USER_EMAIL: userEmail })  // ✅ Pass user email for HTTP client auth (Cloud mode)
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false  // ✅ Keep in same process group for easier killing
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
                const sessionData = await this.sessionService.readSessionData(mapping.projectId, mapping.featureName);
                if (sessionData?.state?.interruption) {
                  const sessionInterruption = sessionData.state.interruption;
                  interruption = sessionInterruption;
                  console.log(`   ⏸️  Session has interruption: ${sessionInterruption.reason}`);
                  
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
                console.warn(`   ⚠️  Failed to read session for interruption check:`, error);
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
            console.log(`\n🧹 [ExpressServerAdapter.runJob] Job ${jobId} completed, calling cleanupJobState...`);
            console.log(`   interruption: ${interruption ? interruption.reason : 'none'}`);
            await this.cleanupJobState(jobId, params.project, params.feature, interruption);
            console.log(`   ✅ cleanupJobState completed\n`);
            
            resolve();
          } else {
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            
            const logEntry: LogEntry = {
              type: 'stderr',
              message: signal 
                ? `\n🛑 Job stopped by user (${signal})`
                : `\n❌ Job failed with exit code ${code}`,
              timestamp: new Date().toISOString()
            };
            this.logs.get(jobId)!.push(logEntry);
            this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            
            // ✅ Analyze logs to determine interruption reason
            let interruption: InterruptionDetails | undefined;
            
            if (!signal) {
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
              console.log(`\n⏭️  [ExpressServerAdapter.runJob] Job ${jobId} was user-stopped, skipping exit handler cleanup (Stop API will handle it)\n`);
              this.userStoppedJobs.delete(jobId);  // Clean up flag
              reject(new Error(status.error));
              return;
            }
            
            // Only cleanup for natural failures (not user stops)
            console.log(`\n🧹 [ExpressServerAdapter.runJob] Job ${jobId} failed naturally, calling cleanupJobState...`);
            await this.cleanupJobState(jobId, params.project, params.feature, interruption);
            console.log(`   ✅ cleanupJobState completed\n`);
            
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
        console.log(`\n🧹 [ExpressServerAdapter.runJob.catch] Job ${jobId} failed in try-catch, calling cleanupJobState...`);
        
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
        console.log(`\n⏭️  [ExpressServerAdapter.runJob.catch] Job ${jobId} already cleaned up, skipping duplicate cleanup`);
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
    const key = `${projectId}/${featureName}`;
    const sseClientChecker = () => {
      return this.sseService.getClientCount(projectId, featureName) > 0;
    };
    
    // Map task to job type
    const job = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
    
    this.sessionService.watchSessionFile(projectId, featureName, job, sseClientChecker);
  }
  
  /**
   * Notify file tree update (implements FileTreeUpdatePort)
   */
  async notifyFileTreeUpdate(projectId: string, featureName: string): Promise<void> {
    try {
      console.log(`[FileTreeUpdate] Updating for ${projectId}/${featureName}`);
      
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
      const clientCount = this.sseService.getClientCount(projectId, featureName);
      console.log(`[FileTreeUpdate] Broadcasting to ${clientCount} client(s)`);
      this.sseService.broadcast(projectId, featureName, 'fileTree', { type: 'update', tree: fileTree });
    } catch (error) {
      console.error(`[FileTreeUpdate] Error:`, error);
    }
  }
  
  // =====================================
  // WorkflowStateUpdatePort implementation
  // =====================================
  
  /**
   * Start workflow tracking for a job
   */
  startJob(jobId: string, llmInfo?: import('../../../core/ports/workflow').LLMInfo): void {
    console.log(`\n🚀 [ExpressServerAdapter] startJob called: ${jobId}`);
    if (llmInfo) {
      console.log(`   🤖 LLM: ${llmInfo.provider} / ${llmInfo.model}`);
    }
    this.workflowStateService.startJob(jobId, llmInfo);
  }
  
  /**
   * Track node entry
   * ✅ Returns Promise to ensure SSE ordering
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: import('../../../core/ports/workflow').TaskInfo, llmInfo?: import('../../../core/ports/workflow').LLMInfo): Promise<void> {
    console.log(`\n🎯 [ExpressServerAdapter] enterNode called: ${nodeId} (job: ${jobId})`);
    if (taskInfo) {
      console.log(`   📋 Task: ${taskInfo.name}`);
    }
    if (llmInfo) {
      console.log(`   🤖 LLM: ${llmInfo.provider} / ${llmInfo.model}`);
    }
    await this.workflowStateService.enterNode(jobId, nodeId, taskInfo, llmInfo);
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
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Stop all child processes
        this.childProcesses.forEach((proc) => {
          proc.kill('SIGTERM');
        });
        this.childProcesses.clear();
        
        // Cleanup services
        this.sessionService.cleanup();
        this.devServerService.cleanup();
        
        this.server.close(() => {
          this.running = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
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
