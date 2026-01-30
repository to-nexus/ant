import { Express, Request, Response } from 'express';
import express from 'express';
import {
  createJobRoutes,
  createKanbanRoutes,
  createPreviewRoutes,
  createWorkflowRoutes,
  createSSERoutes,
  createAuthRoutes,
  createIDERoutes,
  createCloudIDERoutes,
  createApiRoutes
} from '../../routes';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { JobStateTracker } from '../managers/JobStateTracker';
import { JobExecutionManager } from '../managers/JobExecutionManager';
import { WorkflowBridge } from '../bridges/WorkflowBridge';
import { choiceService } from '../../../../../infrastructure/choice/ChoiceService';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';

/**
 * RouteConfigurator
 * 
 * Configures all Express routes and API endpoints.
 * Separates route registration logic from core business logic.
 */
export class RouteConfigurator {
  constructor(
    private readonly config: ServerConfig,
    private readonly deps: ServerDependencies,
    private readonly stateTracker: JobStateTracker,
    private readonly jobManager: JobExecutionManager,
    private readonly workflowBridge: WorkflowBridge,
    private readonly cleanupJobState: (
      jobId: string,
      projectId?: string,
      featureName?: string,
      interruptionReason?: any,
      explicitJobType?: 'design' | 'code' | 'learn',
      userContext?: any
    ) => Promise<void>,
    private readonly watchSessionFile: (
      jobId: string,
      projectId: string,
      featureName: string,
      task: string
    ) => void
  ) {}

  /**
   * Configure all routes
   */
  configure(app: Express): void {
    this.setupRootRoutes(app);
    this.setupInternalEndpoints(app);
    this.setupAuthRoutes(app);
    this.setupApiRoutes(app);
    this.setupIDERoutes(app);
    this.setupCloudIDERoutes(app);
    this.setupKanbanRoutes(app);
    this.setupPreviewRoutes(app);
    this.setupWorkflowRoutes(app);
    this.setupSSERoutes(app);
    this.setupJobRoutes(app);
  }

  /**
   * Setup root routes (mode-specific)
   */
  private setupRootRoutes(app: Express): void {
    if (this.config.mode === 'local') {
      // Local Mode: Redirect root to cloud
      app.get('/', (req: Request, res: Response) => {
        res.redirect(this.config.cloudUrl);
      });
    } else {
      // Cloud Mode: Show /local info page
      app.get('/local', (req: Request, res: Response) => {
        res.send(this.getLocalModeInfoPage());
      });
      
      // Cloud Mode: Root serves the main app
      app.get('/', (req: Request, res: Response) => {
        res.json({
          mode: 'cloud',
          message: 'ANT Works Cloud Service',
          documentation: '/local'
        });
      });
    }
  }

  /**
   * Setup internal endpoints (task queue, file tree updates)
   */
  private setupInternalEndpoints(app: Express): void {
    // Task queue updates from child processes
    app.post('/api/internal/task-queue', express.json(), (req: Request, res: Response) => {
      const { taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit } = req.body;
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }
      this.workflowBridge.updateTaskQueue(
        taskId, 
        currentTask, 
        queue, 
        completedTasks, 
        recursionCount, 
        recursionLimit
      );
      res.json({ success: true });
    });
    
    // File tree updates from child processes
    app.post('/api/internal/file-tree-update', express.json(), (req: Request, res: Response) => {
      const { projectId, featureName } = req.body;
      if (!projectId || !featureName) {
        return res.status(400).json({ error: 'projectId and featureName are required' });
      }
      
      // Fire and forget - non-blocking
      this.workflowBridge.notifyFileTreeUpdate(projectId, featureName)
        .catch(err => logger.warn('[FileTreeUpdate] Error', { 
          component: 'RouteConfigurator', 
          projectId, 
          featureName 
        }, err));
      
      res.json({ success: true });
    });
  }

  /**
   * Setup auth routes (Cloud mode only)
   */
  private setupAuthRoutes(app: Express): void {
    if (this.config.mode === 'cloud' && this.deps.authService) {
      const authRoutes = createAuthRoutes({
        authService: this.deps.authService,
        workspaceResolver: this.deps.workspaceResolver,
        oidcService: this.deps.oidcService
      });
      app.use('/api', authRoutes);
    }
  }

  /**
   * Setup unified API routes (health, agents, projects, features, files, chat, github, figma)
   */
  private setupApiRoutes(app: Express): void {
    const apiRoutes = createApiRoutes({
      projectService: this.deps.projectService,
      chatService: this.deps.chatService,
      kanbanService: this.deps.kanbanService,  // ✅ For session cache invalidation on job clear
      choiceService,  // ✅ For triage choice handling
      githubAuthService: this.deps.githubAuthService,
      workspaceRoot: this.config.workspacesPath,
      workspaceResolver: this.deps.workspaceResolver
    });
    app.use('/api', apiRoutes);
  }

  /**
   * Setup IDE routes (Local mode only)
   */
  private setupIDERoutes(app: Express): void {
    if (this.config.mode === 'local') {
      const ideRoutes = createIDERoutes();
      app.use('/api', ideRoutes);
    }
  }

  /**
   * Setup Cloud IDE routes (both modes)
   * Uses KubernetesIDEOrchestrator in cloud mode (ANT_K8S_NAMESPACE set),
   * LocalIDEOrchestrator (Docker) otherwise
   */
  private setupCloudIDERoutes(app: Express): void {
    logger.info(`Setting up Cloud IDE routes (ANT_K8S_NAMESPACE=${process.env.ANT_K8S_NAMESPACE || 'not set'})`, {
      component: 'RouteConfigurator'
    });
    
    // Set dependencies for LocalIDEOrchestrator (Docker mode)
    // This is required before calling getIDEOrchestrator() when K8s is not configured
    const factory = getInfrastructureFactory();
    factory.setDependencies(this.deps.portManager, this.deps.portRegistry);
    
    const ideOrchestrator = factory.getIDEOrchestrator();
    logger.info(`IDE Orchestrator type: ${ideOrchestrator.constructor.name}`, { component: 'RouteConfigurator' });
    
    // Start idle check for auto-cleanup of unused IDE instances
    ideOrchestrator.startIdleCheck();
    
    const cloudIDERoutes = createCloudIDERoutes(
      ideOrchestrator, 
      this.deps.workspaceResolver
    );
    app.use('/api/cloud-ide', cloudIDERoutes);
  }

  /**
   * Setup Kanban routes
   */
  private setupKanbanRoutes(app: Express): void {
    const state = this.stateTracker.getState();
    const kanbanRoutes = createKanbanRoutes({
      kanbanService: this.deps.kanbanService,
      kanbanSSE: new Map(), // Legacy SSE - deprecated
      jobToProject: state.jobToProject,
      jobs: state.jobs,
      taskQueueSnapshots: state.taskQueueSnapshots,
      watchSessionFile: this.watchSessionFile
    });
    app.use('/api', kanbanRoutes);
  }

  /**
   * Setup preview routes
   */
  private setupPreviewRoutes(app: Express): void {
    const previewRoutes = createPreviewRoutes({
      projectService: this.deps.projectService,
      previewService: this.deps.previewService,
      workspaceResolver: this.deps.workspaceResolver
    });
    app.use('/api', previewRoutes);
  }

  /**
   * Setup workflow routes (LangGraph visualization)
   */
  private setupWorkflowRoutes(app: Express): void {
    const workflowRoutes = createWorkflowRoutes({
      graphMetadataService: this.deps.graphMetadataService,
      workflowStateService: this.deps.workflowStateService
    });
    app.use('/api', workflowRoutes);
  }

  /**
   * Setup SSE routes (consolidated Kanban, chat, fileTree, workflow)
   */
  private setupSSERoutes(app: Express): void {
    const state = this.stateTracker.getState();
    const sseRoutes = createSSERoutes({
      sseService: this.deps.sseService,
      kanbanService: this.deps.kanbanService,
      chatService: this.deps.chatService,
      projectService: this.deps.projectService,
      workflowStateService: this.deps.workflowStateService,
      gitWatcherService: this.deps.gitWatcherService,
      jobToProject: state.jobToProject,
      jobs: state.jobs,
      taskQueueSnapshots: state.taskQueueSnapshots
    });
    app.use('/api', sseRoutes);
  }

  /**
   * Setup job execution routes
   */
  private setupJobRoutes(app: Express): void {
    const state = this.stateTracker.getState();
    
    // Cloud mode: enqueue to job queue, Local mode: execute directly
    const executeJob = this.config.mode === 'cloud'
      ? this.createCloudExecuteJob()
      : this.jobManager.executeJob.bind(this.jobManager);
    
    // ✅ Get stateStore for Cloud mode (stop signal via Redis)
    const stateStore = this.config.mode === 'cloud' 
      ? getInfrastructureFactory().getStateStore() 
      : undefined;
    
    // ✅ Cloud mode: Subscribe to job completion events to update stateTracker
    // This allows new jobs to start after previous job completes (fixes "Job already running" error)
    if (this.config.mode === 'cloud' && stateStore) {
      stateStore.subscribe('job:status:updates', (message: unknown) => {
        const data = message as { type: string; jobId: string; status: string };
        if (data.type === 'completed' || data.type === 'failed') {
          // Update local stateTracker to mark job as completed
          const jobStatus = state.jobs.get(data.jobId);
          if (jobStatus) {
            jobStatus.status = data.status as any;
            logger.debug(`Updated stateTracker job status: ${data.jobId} → ${data.status}`, { 
              component: 'RouteConfigurator' 
            });
          }
        }
      }).catch((err: Error) => {
        logger.warn(`Failed to subscribe to job status updates: ${err.message}`, { 
          component: 'RouteConfigurator' 
        });
      });
    }
    
    const jobRoutes = createJobRoutes({
      workspaceResolver: this.deps.workspaceResolver,
      executeJob,
      getJobStatus: this.jobManager.getJobStatus.bind(this.jobManager),
      getLogs: this.jobManager.getLogs.bind(this.jobManager),
      logStreams: state.logStreams,
      sseResponses: state.sseResponses,
      logs: state.logs,
      childProcesses: state.childProcesses,
      jobs: state.jobs,
      jobToProject: state.jobToProject,
      userStoppedJobs: state.userStoppedJobs,
      cleanupJobState: this.cleanupJobState,
      workflowStateService: this.deps.workflowStateService,
      chatService: this.deps.chatService,
      // ✅ Cloud mode support for stop signal
      config: { mode: this.config.mode },
      stateStore
    });
    app.use('/api', jobRoutes);
  }
  
  /**
   * Create executeJob function for cloud mode
   * Enqueues job to BullMQ instead of executing directly
   */
  private createCloudExecuteJob() {
    return async (params: any) => {
      const { getInfrastructureFactory } = await import('../../../../../infrastructure/adapters/InfrastructureFactory');
      const factory = getInfrastructureFactory();
      const jobQueue = factory.getJobQueue();
      const stateStore = factory.getStateStore();
      
      // Generate jobId
      const jobId = params.jobId || `${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
      
      // ⏱️ DEBUG: Record enqueue start time for latency analysis
      const enqueueStartTime = Date.now();
      const enqueueStartISO = new Date(enqueueStartTime).toISOString();
      logger.info(`⏱️ [JobTiming] API Server: Starting job enqueue | enqueueStartTime=${enqueueStartISO}`, {
        component: 'RouteConfigurator',
        jobId,
        projectId: params.project,
        featureName: params.feature
      });
      
      // Get workspace paths
      const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
      const handle = await this.deps.workspaceService.createWorkspace(tenantId, params.project);
      
      // handle.storagePath is already the full project path
      // We need to pass base workspace path for JobWorker to calculate paths correctly
      const workspaceBasePath = this.deps.workspaceResolver.getPhysicalWorkspacesPath();
      
      // Enqueue job to BullMQ
      await jobQueue.enqueue({
        jobId,
        projectId: params.project,
        feature: params.feature,
        featureName: params.feature,  // Alias for feature
        type: params.jobType || 'code',
        agent: params.agent || 'architect',
        mode: params.mode || 'generate',
        userContext: params.userContext,
        workspacePath: workspaceBasePath,  // Base path, not full project path
        overrideDirective: params.overrideDirective,
        chatSource: params.chatSource,
        inputFile: params.inputFile,
        isResume: !!params.jobId,
        originalJobId: params.jobId
      });
      
      // Set initial job status in Redis
      await stateStore.setJobStatus(jobId, {
        jobId,
        status: 'queued',
        projectId: params.project,
        featureName: params.feature,
        type: params.jobType || 'code',
        mode: params.mode,
        userContext: params.userContext,
        timestamp: new Date().toISOString()
      });
      
      // ✅ CRITICAL: Register job mapping in local stateTracker for SSE broadcast
      // Without this, WorkflowBridge.updateTaskQueue cannot find projectId/featureName
      this.stateTracker.initializeJob(jobId, params.project, params.feature, params.jobType || 'code', params.userContext);
      
      // ⏱️ DEBUG: Record enqueue completion time
      const enqueueEndTime = Date.now();
      const enqueueDuration = enqueueEndTime - enqueueStartTime;
      logger.info(`⏱️ [JobTiming] API Server: Job enqueued to Redis | enqueueStartTime=${enqueueStartISO} | enqueueEndTime=${new Date(enqueueEndTime).toISOString()} | enqueueDurationMs=${enqueueDuration}`, { 
        component: 'RouteConfigurator', 
        jobId,
        projectId: params.project,
        featureName: params.feature
      });
      
      return {
        jobId,
        success: true,
        message: 'Job enqueued'
      };
    };
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
      <p><strong>⚠️ Important:</strong> Local mode requires running ANT Works on your own machine.</p>
    </div>
    
    <h2>How to Run Local Mode</h2>
    
    <div class="code-block">
# Clone the repository
git clone https://github.com/to-nexus/ant.git
cd ant

# Install dependencies
pnpm install

# Set up environment variables
cd packages/ant-cli
cp .env.example .env

# Start local server
pnpm dev:cli
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
