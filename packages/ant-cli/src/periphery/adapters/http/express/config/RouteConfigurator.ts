import { Express, Request, Response } from 'express';
import express from 'express';
import {
  createJobRoutes,
  createKanbanRoutes,
  createWorkflowRoutes,
  createAuthRoutes,
  createIDERoutes,
  createCloudIDERoutes,
  createApiRoutes
} from '../../routes';
import { extractUserContext } from '../../routes/helpers/userContext';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { JobStateTracker } from '../managers/JobStateTracker';
import { JobExecutionManager } from '../managers/JobExecutionManager';
import { WorkflowBridge } from '../bridges/WorkflowBridge';
import { ChoiceService, choiceService as defaultChoiceService } from '../../../../../infrastructure/choice/ChoiceService';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { REDIS_CHANNELS } from '../../../../../infrastructure/state/redisConstants';

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
      explicitJobType?: 'design' | 'code' | 'learn' | 'plan',
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
   * 
   * Note: SSE routes are now served by dedicated Realtime Server
   * @see docs/architecture/10-cloud-architecture.md
   */
  configure(app: Express): void {
    this.setupRootRoutes(app);
    this.setupAuthRoutes(app);
    this.setupApiRoutes(app);
    this.setupIDERoutes(app);
    this.setupCloudIDERoutes(app);
    this.setupKanbanRoutes(app);
    this.setupPreviewRoutes(app);
    this.setupWorkflowRoutes(app);
    // SSE routes moved to Realtime Server (see 10-cloud-architecture.md)
    // this.setupSSERoutes(app);
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
    // ✅ CRITICAL: Always use Redis-backed ChoiceService if stateStore is available
    // This ensures Job Worker (which uses Redis) and API Server share the same pending choices
    // Previously this only worked in cloud mode, causing "가이드 제공됨" in local mode with Redis
    let choiceService = defaultChoiceService;
    
    const factory = getInfrastructureFactory();
    const stateStore = factory.getStateStore();
    if (stateStore) {
      choiceService = new ChoiceService({ stateStore });
      logger.info(`[RouteConfigurator] Created ChoiceService with Redis support (mode: ${this.config.mode})`, { component: 'RouteConfigurator' });
    } else {
      logger.info(`[RouteConfigurator] Using in-memory ChoiceService (no Redis available)`, { component: 'RouteConfigurator' });
    }
    
    const apiRoutes = createApiRoutes({
      projectService: this.deps.projectService,
      chatService: this.deps.chatService,
      kanbanService: this.deps.kanbanService,  // ✅ For session cache invalidation on job clear
      choiceService,  // ✅ For triage choice handling (Redis-backed in Cloud mode)
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
    // Preview routes moved to ant-preview service
    // @see docs/architecture/10-cloud-architecture.md
    // Ingress routes /preview/* → ant-preview
    // Local dev: Vite proxy routes /preview/* → localhost:4102
    logger.info('[RouteConfigurator] Preview routes handled by ant-preview service', {
      component: 'RouteConfigurator'
    });
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
    
    // ✅ Cloud mode: Subscribe to job completion events to update stateTracker and broadcast to SSE
    // This allows new jobs to start after previous job completes (fixes "Job already running" error)
    // CRITICAL: Must also call cleanupJobState to broadcast Kanban update to frontend!
    if (this.config.mode === 'cloud' && stateStore) {
      stateStore.subscribe(REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES, async (message: unknown) => {
        const data = message as { 
          type: string; 
          jobId: string; 
          status: string;
          projectId?: string;
          featureName?: string;
          userEmail?: string;
          result?: any;
          interruption?: any;  // ✅ Top-level interruption (promoted by BullMQJobQueue)
        };
        if (data.type === 'completed' || data.type === 'failed') {
          const { jobId, projectId, featureName, userEmail } = data;
          
          // ✅ Redis-based idempotency: in-memory Set doesn't work (multiple instances confirmed by logs)
          const acquired = await stateStore.acquireLock(`ant:job-event:${jobId}:${data.type}`, 120);
          if (!acquired) {
            logger.debug(`Duplicate job event blocked: ${jobId}:${data.type}`, { component: 'RouteConfigurator' });
            return;
          }
          
          // Update local stateTracker to mark job as completed
          const jobStatus = state.jobs.get(jobId);
          if (jobStatus) {
            jobStatus.status = data.status as any;
            logger.debug(`Updated stateTracker job status: ${jobId} → ${data.status}`, { 
              component: 'RouteConfigurator' 
            });
          }
          
          // ✅ Extract interruption from job result (flows from JobWorker → BullMQ → Redis)
          // Check multiple locations: top-level (promoted by BullMQJobQueue), nested in result.output, or direct in result
          const interruption = data.interruption 
            || data.result?.output?.interruption 
            || data.result?.interruption;
          if (interruption) {
            logger.info(`Job ${jobId} has interruption: ${interruption.reason}`, {
              component: 'RouteConfigurator'
            });
          } else {
            // ✅ Log for debugging when interruption is missing despite status suggesting pause
            const resultStatus = data.result?.output?.status || data.status;
            if (resultStatus === 'paused' || data.status === 'paused') {
              console.warn(`⚠️ [RouteConfigurator] Job ${jobId} status=${resultStatus} but no interruption found in result | resultKeys=${data.result ? Object.keys(data.result).join(',') : 'null'} | outputKeys=${data.result?.output ? Object.keys(data.result.output).join(',') : 'null'}`);
            }
          }
          
          // ✅ Extract jobType from result
          const jobType = data.result?.output?.job as 'design' | 'code' | 'learn' | undefined;
          
          // ✅ CRITICAL: Call cleanupJobState to broadcast Kanban update to frontend SSE
          // Without this, frontend remains in "running" state even after job completes
          // ✅ Skip if user-stopped: Stop route already called cleanupJobState
          // Without this guard, cleanupJobState runs twice → duplicate choice cards
          const wasUserStopped = stateStore ? await stateStore.isUserStopped(jobId) : false;
          if (wasUserStopped) {
            logger.info(`Skipping cleanupJobState for user-stopped job: ${jobId} (already handled by stop route)`, {
              component: 'RouteConfigurator'
            });
          } else if (projectId && featureName) {
            try {
              // Parse userEmail to extract userId and organizationId
              let userContext: { userId: string; organizationId: string; workspacePath: string } | undefined;
              if (userEmail) {
                const [userId, organizationId] = userEmail.split('@');
                if (userId && organizationId) {
                  userContext = { 
                    userId, 
                    organizationId, 
                    workspacePath: this.deps.workspaceResolver.getPhysicalWorkspacesPath() 
                  };
                }
              }
              
              logger.info(`Calling cleanupJobState for completed job: ${jobId} (hasInterruption=${!!interruption})`, {
                component: 'RouteConfigurator',
                projectId,
                featureName
              });
              
              await this.cleanupJobState(jobId, projectId, featureName, interruption, jobType, userContext);
              
              logger.debug(`cleanupJobState completed for job: ${jobId}`, {
                component: 'RouteConfigurator'
              });
            } catch (cleanupError) {
              logger.error(`Failed to cleanup job state for ${jobId}`, {
                component: 'RouteConfigurator'
              }, cleanupError);
            }
          } else {
            logger.warn(`Missing projectId/featureName for job completion cleanup: ${jobId}`, {
              component: 'RouteConfigurator',
              projectId,
              featureName
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
      cleanupJobState: this.cleanupJobState,
      workflowStateService: this.deps.workflowStateService,
      chatService: this.deps.chatService,
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
        isResume: params.isResume ?? !!params.jobId,
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
      
      // ✅ CRITICAL: Register job mapping in Redis for cross-Pod SSE broadcast
      // Job Worker (separate Pod) needs this to broadcast Kanban updates
      const userContextStr = params.userContext 
        ? `${params.userContext.organizationId}:${params.userContext.userId}` 
        : 'undefined';
      logger.info(`📝 [JobMapping] Saving job mapping to Redis: ${jobId} → ${params.project}/${params.feature} (${params.jobType || 'code'}), userContext: ${userContextStr}`, { 
        component: 'RouteConfigurator', 
        jobId
      });
      
      await stateStore.setJobMapping(jobId, {
        projectId: params.project,
        featureName: params.feature,
        jobType: params.jobType || 'code',
        userContext: params.userContext
      });
      
      logger.info(`✅ [JobMapping] Job mapping saved successfully`, { 
        component: 'RouteConfigurator', 
        jobId
      });
      
      // Also register in local stateTracker (Local mode)
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
