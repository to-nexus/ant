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
import { ensureCanonicalFeatureMiddleware } from '../../middleware/ensureCanonicalFeature';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { JobStateTracker } from '../managers/JobStateTracker';
import { JobExecutionManager } from '../managers/JobExecutionManager';
import { WorkflowBridge } from '../bridges/WorkflowBridge';
import { ChoiceService } from '../../../../../infrastructure/choice/ChoiceService';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { REDIS_CHANNELS } from '../../../../../infrastructure/state/redisConstants';
import { isSessionableJobType, isExecutableJobType } from '@ant/shared';

/**
 * RouteConfigurator
 * 
 * Configures all Express routes and API endpoints.
 * Separates route registration logic from core business logic.
 * 
 * NOTE: This system is ALWAYS distributed (Redis + BullMQ + Pub/Sub),
 * regardless of whether it runs on a single machine or cloud.
 * See .cursorrules "Unified Distributed System Principle".
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
      explicitJobType?: 'design' | 'code' | 'learn' | 'plan' | 'visual',
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
    this.setupCanonicalBackfillMiddleware(app);
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
   * Access-time canonical backfill — runs BEFORE any /api sub-router so every
   * feature-scoped endpoint (api/kanban/job/workflow/…) benefits from the
   * self-heal. Sub-routers are mounted under `/api` via separate app.use(…)
   * calls, so attaching the middleware once here is the single SSOT spot.
   * Skipped (silent) when `workspaceResolver` is absent.
   */
  private setupCanonicalBackfillMiddleware(app: Express): void {
    if (!this.deps.workspaceResolver) return;
    app.use('/api', ensureCanonicalFeatureMiddleware(this.deps.workspaceResolver));
  }

  /**
   * Setup root routes
   */
  private setupRootRoutes(app: Express): void {
    app.get('/', (req: Request, res: Response) => {
      res.json({
        message: 'ANT Works Service',
        status: 'running'
      });
    });
  }

  /**
   * Setup auth routes
   */
  private setupAuthRoutes(app: Express): void {
    if (this.deps.authService) {
      const authRoutes = createAuthRoutes({
        authService: this.deps.authService,
        workspaceResolver: this.deps.workspaceResolver,
        oidcService: this.deps.oidcService,
        jwtService: this.deps.jwtService,
        stateStore: getInfrastructureFactory().getStateStore(),
      });
      app.use('/api', authRoutes);
    }
  }

  /**
   * Setup unified API routes (health, agents, projects, features, files, chat, github, figma)
   */
  private setupApiRoutes(app: Express): void {
    const factory = getInfrastructureFactory();
    const stateStore = factory.getStateStore();
    const choiceService = new ChoiceService({ stateStore });
    
    const apiRoutes = createApiRoutes({
      projectService: this.deps.projectService,
      chatService: this.deps.chatService,
      kanbanService: this.deps.kanbanService,
      choiceService,
      githubAuthService: this.deps.githubAuthService,
      workspaceRoot: this.config.workspacesPath,
      workspaceResolver: this.deps.workspaceResolver,
      fileTreeNotifier: this.workflowBridge,
      transferService: this.deps.transferService,
      stateStore: getInfrastructureFactory().getStateStore(),
      gitWatcherService: this.deps.gitWatcherService,
      gitStateBroadcaster: this.deps.gitStateBroadcaster,
      cleanupJobState: this.cleanupJobState,
      stateTracker: this.stateTracker,
    });
    app.use('/api', apiRoutes);
  }

  /**
   * Setup IDE routes
   */
  private setupIDERoutes(app: Express): void {
    const ideRoutes = createIDERoutes();
    app.use('/api', ideRoutes);
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
    
    // Always enqueue to BullMQ job queue (unified distributed system)
    const executeJob = this.createExecuteJob();
    
    // Always use Redis StateStore
    const stateStore = getInfrastructureFactory().getStateStore();
    
    // Subscribe to job completion events via Redis Pub/Sub
    // This allows new jobs to start after previous job completes and
    // broadcasts Kanban update to frontend SSE
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
        if (data.type !== 'completed' && data.type !== 'failed') return;

        const { jobId, projectId, featureName, userEmail } = data;

        // NOTE on idempotency: the old `acquireLock('ant:job-event:{id}:{type}')`
        // guard that used to live here has migrated INTO `finalizeTerminalJob`
        // and `pauseJob` (as part of the SSOT refactor). Multi-pod races and
        // the /stop-vs-worker-completed race are now both serialized by the
        // helper's internal acquire. Keeping the guard here would create a
        // deadlock: this handler would hold the lock, then finalize would try
        // to acquire the same key and bail. So we let the helper own it.

        // Update local stateTracker to mark job as completed (in-memory only).
        const jobStatus = state.jobs.get(jobId);
        if (jobStatus) {
          jobStatus.status = data.status as any;
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

        // ✅ Skip cleanup for inline-ask jobs (stateless, no session/kanban to clean up)
        // Instead, broadcast a lightweight completion event to the frontend
        const isInlineAsk = data.result?.output?.intent !== undefined;
        if (isInlineAsk) {
          const intent = data.result?.output?.intent;
          const noSession = data.result?.output?.noSession === true;
          const action = data.result?.output?.action;
          const suggestedJob = data.result?.output?.suggestedJob;
          const suggestedAgent = data.result?.output?.suggestedAgent;
          const redirectReason = data.result?.output?.redirectReason;
          logger.info(`Skipping cleanupJobState for inline-ask job: ${jobId} (intent=${intent}, action=${action}, noSession=${noSession})`, {
            component: 'RouteConfigurator'
          });

          // ✅ Broadcast inline-ask completion to frontend via user-scoped SSE channel
          try {
            if (userEmail) {
              const [userId, organizationId] = userEmail.split('@');
              if (userId && organizationId) {
                const { getRealtimeBroadcastChannel } = await import('../../../../../infrastructure/state/redisConstants');
                const channel = getRealtimeBroadcastChannel(organizationId, userId);
                const userContext = {
                  userId,
                  organizationId,
                };
                await stateStore.publish(channel, {
                  projectId,
                  featureName,
                  type: 'chat',
                  data: {
                    type: 'inline_ask_complete',
                    projectId,
                    featureName,
                    jobId,
                    intent,
                    action,
                    suggestedJob,
                    suggestedAgent,
                    redirectReason,
                    noSession,
                    timestamp: new Date().toISOString(),
                  },
                  userContext,
                });
              }
            }
          } catch (broadcastError) {
            logger.warn(`Failed to broadcast inline-ask completion: ${jobId}`, {
              component: 'RouteConfigurator'
            }, broadcastError);
          }
          return;
        }

        // Resolve project/feature/user context — fall back to Redis mapping
        // when the payload didn't include them (stalled-handler best-effort).
        let resolvedProjectId = projectId;
        let resolvedFeatureName = featureName;
        let userContext: { userId: string; organizationId: string } | undefined;
        if (userEmail) {
          const [userId, organizationId] = userEmail.split('@');
          if (userId && organizationId) {
            userContext = { userId, organizationId };
          }
        }
        if (!resolvedProjectId || !resolvedFeatureName) {
          try {
            const mapping = await stateStore.getJobMapping(jobId);
            if (mapping?.projectId && mapping?.featureName) {
              resolvedProjectId = mapping.projectId;
              resolvedFeatureName = mapping.featureName;
              if (!userContext && mapping.userContext) {
                userContext = mapping.userContext as { userId: string; organizationId: string };
              }
            }
          } catch (err) {
            logger.error(`Failed to resolve mapping for job ${jobId}`, { component: 'RouteConfigurator' }, err);
          }
        }
        if (!resolvedProjectId || !resolvedFeatureName) {
          logger.warn(
            `Missing projectId/featureName — cannot dispatch finalize/pause for ${jobId}`,
            { component: 'RouteConfigurator' },
          );
          return;
        }

        // Resolve the seal-surface jobType. Prefer worker-reported (`result.output.job`)
        // then Redis mapping's jobType as a fallback.
        let sealJobType: 'design' | 'code' | 'learn' | 'plan' | 'visual' = jobType ?? 'code';
        if (!jobType) {
          try {
            const mapping = await stateStore.getJobMapping(jobId);
            if (mapping?.jobType) sealJobType = mapping.jobType as typeof sealJobType;
          } catch { /* ignore */ }
        }

        const featurePath = userContext
          ? this.deps.workspaceResolver.getFeaturePath(userContext, resolvedProjectId, resolvedFeatureName)
          : undefined;

        // Dispatch: interruption present ⇒ paused (resumable). Otherwise
        // the worker's outcome drives the terminal status.
        try {
          const { finalizeTerminalJob } = await import('../lifecycle/finalizeTerminalJob');
          const { pauseJob } = await import('../lifecycle/pauseJob');

          if (interruption && interruption.reason !== 'user_stopped') {
            // Auto-paused (recursion_limit, api_error, verification_failed,
            // server_crash from worker, etc.). Keep Redis state alive for resume.
            await pauseJob(
              { cleanupJobState: this.cleanupJobState },
              {
                jobId,
                projectId: resolvedProjectId,
                featureName: resolvedFeatureName,
                jobType: sealJobType,
                userContext,
                interruption,
              },
            );
          } else {
            // Terminal: normal completion, worker-reported failure, or a
            // user_stopped interruption that somehow reached us without the
            // /stop route having sealed already (e.g. multi-pod with /stop
            // on pod A, worker completion on pod B). finalize's idempotency
            // lock deduplicates.
            const finalStatus: 'completed' | 'failed' =
              data.status === 'failed' ? 'failed' : 'completed';
            await finalizeTerminalJob(
              {
                cleanupJobState: this.cleanupJobState,
                stateTracker: this.stateTracker,
                kanbanService: this.deps.kanbanService,
              },
              {
                jobId,
                finalStatus,
                projectId: resolvedProjectId,
                featureName: resolvedFeatureName,
                jobType: sealJobType,
                userContext,
                interruption,
                featurePath,
              },
            );
          }
        } catch (dispatchError) {
          logger.error(
            `Failed to dispatch lifecycle transition for ${jobId}`,
            { component: 'RouteConfigurator' },
            dispatchError,
          );
        }
      }).catch((err: Error) => {
        logger.warn(`Failed to subscribe to job status updates: ${err.message}`, {
          component: 'RouteConfigurator'
        });
      });
    
    const jobRoutes = createJobRoutes({
      workspaceResolver: this.deps.workspaceResolver,
      executeJob,
      cleanupJobState: this.cleanupJobState,
      workflowStateService: this.deps.workflowStateService,
      chatService: this.deps.chatService,
      stateStore,
      stateTracker: this.stateTracker,
      kanbanService: this.deps.kanbanService,
    });
    app.use('/api', jobRoutes);
  }
  
  /**
   * Create executeJob function that enqueues to BullMQ
   */
  private createExecuteJob() {
    return async (params: any) => {
      const { getInfrastructureFactory } = await import('../../../../../infrastructure/adapters/InfrastructureFactory');
      const factory = getInfrastructureFactory();
      const jobQueue = factory.getJobQueue();
      const stateStore = factory.getStateStore();

      // Single source of truth: jobType MUST be an executable type — every
      // SessionableJobType plus the lightweight `inline-ask` runner. The
      // legacy `params.jobType || 'code'` fallback silently downcast plan /
      // visual to code (zonal-dreaming-novel regression — Invariant I1), so
      // we validate against the executable union (sessionable + inline-ask)
      // and reject anything else. inline-ask is included because the
      // `/projects/:id/features/:feature/inline-ask` route routes through
      // here too — its downstream `composition/orchestrator.ts:140`
      // dispatches to `runInlineAsk` (no session, no kanban) and
      // `JobExecutionManager.handleSuccessfulExit` skips session-read for
      // it. See `vast-curling-perch` resume blocker incident.
      if (!isExecutableJobType(params.jobType)) {
        throw new Error(
          `[RouteConfigurator] Invalid jobType: ${params.jobType}. ` +
          `Expected one of: code, design, learn, plan, visual, inline-ask.`,
        );
      }
      const jobType = params.jobType;

      // Generate jobId
      const { generateHumanId } = await import('../../../../../utils/humanId');
      const jobId = params.jobId || generateHumanId();
      
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
        type: jobType,
        agent: params.agent || 'architect',
        mode: params.mode || 'generate',
        userContext: params.userContext,
        workspacePath: workspaceBasePath,  // Base path, not full project path
        overrideDirective: params.overrideDirective,
        chatSource: params.chatSource,
        skipTriage: params.skipTriage,
        actionMetadata: params.actionMetadata,
        inputFile: params.inputFile,
        isResume: params.isResume ?? !!params.jobId,
        originalJobId: params.jobId,
        // chat SSOT §6 — pre-allocated turnId from /chat/user-message,
        // forwarded to the worker entry so the durable user_turn line
        // shares the same id as the optimistic SSE broadcast.
        seedTurnId: params.seedTurnId,
      });
      
      // Set initial job status in Redis
      await stateStore.setJobStatus(jobId, {
        jobId,
        status: 'queued',
        projectId: params.project,
        featureName: params.feature,
        type: jobType,
        mode: params.mode,
        userContext: params.userContext,
        timestamp: new Date().toISOString()
      });
      
      // ✅ CRITICAL: Register job mapping in Redis for cross-Pod SSE broadcast
      // Job Worker (separate Pod) needs this to broadcast Kanban updates
      const userContextStr = params.userContext 
        ? `${params.userContext.organizationId}:${params.userContext.userId}` 
        : 'undefined';
      logger.info(`📝 [JobMapping] Saving job mapping to Redis: ${jobId} → ${params.project}/${params.feature} (${jobType}), userContext: ${userContextStr}`, { 
        component: 'RouteConfigurator', 
        jobId
      });
      
      await stateStore.setJobMapping(jobId, {
        projectId: params.project,
        featureName: params.feature,
        jobType: jobType,
        userContext: params.userContext
      });
      
      logger.info(`✅ [JobMapping] Job mapping saved successfully`, { 
        component: 'RouteConfigurator', 
        jobId
      });
      
      // Register in local stateTracker (cache for Kanban routes)
      this.stateTracker.initializeJob(jobId, params.project, params.feature, jobType, params.userContext);
      
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

}
