import { Express, Request, Response } from 'express';
import express from 'express';
import {
  createJobRoutes,
  createWorkflowRoutes,
  createIDERoutes,
  createCloudIDERoutes,
  createApiRoutes,
  createCustomAgentRoutes,
  createAccountAgentRoutes,
  createMcpCredentialRoutes,
  createAuthRoutes,
  createAdminRoutes,
  createTeamsRoutes
} from '../../routes';
import { AuthService } from '../../../../../core/auth/AuthService';
import { parseSuperAdminEmails } from '../../../../../core/auth/superAdmin';
import { createGoogleOidcServiceFromEnv } from '../../../../../infrastructure/auth/GoogleOIDCService';
import { extractUserContext } from '../../routes/helpers/userContext';
import { CredentialsStore } from '../../../../../utils/userConfig/CredentialsStore';
import { parseCompositeUserEmail } from '../../../../../core/utils/compositeUserEmail';
import { ensureCanonicalFeatureMiddleware } from '../../middleware/ensureCanonicalFeature';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';
import { JobStateTracker } from '../managers/JobStateTracker';
import { JobExecutionManager } from '../managers/JobExecutionManager';
import { WorkflowBridge } from '../bridges/WorkflowBridge';
import { ChoiceService } from '../../../../../infrastructure/choice/ChoiceService';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { REDIS_CHANNELS } from '../../../../../infrastructure/state/redisConstants';
import { isSessionableJobType, isExecutableJobType, type SessionableJobType } from '@ant/shared';

/**
 * RouteConfigurator
 * 
 * Configures all Express routes and API endpoints.
 * Separates route registration logic from core business logic.
 * 
 * NOTE: This system is ALWAYS distributed (Redis + BullMQ + Pub/Sub),
 * regardless of whether it runs on a single machine or cloud.
 * See AGENTS.md "Unified Distributed System Principle".
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
      explicitJobType?: SessionableJobType,
      userContext?: any
    ) => Promise<void>
  ) {}

  /**
   * Configure all routes
   * 
   * Note: SSE routes are now served by dedicated Realtime Server
   * @see docs/internals/02-infrastructure.md
   */
  configure(app: Express): void {
    this.setupRootRoutes(app);
    this.setupCanonicalBackfillMiddleware(app);
    // Cloud overlay routers FIRST so /billing/* (and any overlay-mounted
    // route) wins over an OSS fallback. No-op when the overlay is absent
    // (local mode, or a self-hosted cloud without @ant/cloud).
    this.setupCloudOverlayRoutes(app);
    // Cloud-mode auth (OAuth/JWT/callback/onboarding/switch-org + /auth/me)
    // + super-admin routes are OSS core — mounted whenever
    // ANT_SERVER_MODE=cloud, with or without the commercial overlay. Local
    // mode registers no auth routes (no authService, FE never calls /auth/me).
    this.setupAuthRoutes(app);
    this.setupApiRoutes(app);
    this.setupIDERoutes(app);
    this.setupCloudIDERoutes(app);
    // Kanban GET lives in features.routes (single owner — dispatches on
    // ?jobId= vs ?job=). The legacy kanban.routes registration was shadowed
    // by it and has been removed.
    this.setupPreviewRoutes(app);
    this.setupWorkflowRoutes(app);
    // SSE routes moved to Realtime Server (see 10-cloud-architecture.md)
    // this.setupSSERoutes(app);
    this.setupJobRoutes(app);
    this.setupCustomAgentRoutes(app);
  }

  /**
   * Custom agent/job definition routes (universal runtime). The server only
   * LISTS/EDITS definitions — activation is job-runner-child-only (D5).
   */
  private setupCustomAgentRoutes(app: Express): void {
    if (!this.deps.workspaceResolver) return;
    // Live team roles + org-agent ACL authority (org-owned agents). Local
    // mode gets the Noop repository — same single code path, kind-dispatch.
    const organizationRepository = getInfrastructureFactory().getOrganizationRepository();
    app.use('/api', createCustomAgentRoutes({ workspaceResolver: this.deps.workspaceResolver, organizationRepository }));
    // Account-scoped agent settings (profile menu) — no project required (D-G).
    app.use('/api/account/agents', createAccountAgentRoutes({ workspaceResolver: this.deps.workspaceResolver, organizationRepository }));
    // MCP credential registration — the encrypted per-user store the universal
    // runtime resolves `mcp.servers[].headers`/`env` key names against (A16).
    app.use(
      '/api/account/mcp-credentials',
      createMcpCredentialRoutes({ credentialsStore: new CredentialsStore(this.config.workspacesPath) }),
    );
  }

  /**
   * Cloud overlay routes (billing) — mounted by the `@ant/cloud` package via
   * its CloudModule.registerRoutes(). Absent in local mode AND in self-hosted
   * cloud deployments (both legitimate — billing off, Noop ledger). The
   * overlay is warm-loaded by `factory.initCloud()` at the composition root
   * BEFORE this adapter is built, so the synchronous getCloudModule() read
   * here is already resolved.
   */
  private setupCloudOverlayRoutes(app: Express): void {
    const factory = getInfrastructureFactory();
    const cloud = factory.getCloudModule();
    if (!cloud) {
      logger.info('[RouteConfigurator] Cloud overlay: ABSENT — no /billing/* (billing disabled)', {
        component: 'RouteConfigurator',
      });
      return;
    }
    cloud.registerRoutes({ app, deps: this.deps, config: this.config, factory });
    logger.info('[RouteConfigurator] Cloud overlay routes registered', {
      component: 'RouteConfigurator',
    });
  }

  /**
   * Cloud-mode identity routes — OSS core. OAuth/OIDC + `/auth/me` +
   * switch-org + onboarding, and the super-admin `/admin/*` surface
   * (approval / test level / default policy). Mounted for EVERY cloud-mode
   * deployment: managed (with the billing overlay) and self-hosted (without).
   * Local mode mounts nothing here — single tenant, no authService.
   */
  private setupAuthRoutes(app: Express): void {
    if (this.config.mode !== 'cloud') return;
    const factory = getInfrastructureFactory();
    const organizationRepository = factory.getOrganizationRepository();

    const authRoutes = createAuthRoutes({
      authService: new AuthService(),
      workspaceResolver: this.deps.workspaceResolver,
      oidcService: createGoogleOidcServiceFromEnv(),
      jwtService: this.deps.jwtService,
      stateStore: factory.getStateStore(),
      organizationRepository,
    });
    app.use('/api', authRoutes);

    const adminRoutes = createAdminRoutes({
      creditLedger: factory.getCreditLedger(),
      organizationRepository,
    });
    app.use('/api', adminRoutes);

    // Team org lifecycle (creation / roles / invites / domains) — same
    // cloud-mode gate as auth: JWT-protected, so local mode never reaches it.
    app.use('/api', createTeamsRoutes({ organizationRepository }));

    // Super-admin reconcile: project `ANT_SUPER_ADMIN_EMAILS` onto DB
    // `isSuperAdmin` flags (+ force-approve). Fire-and-forget — route setup is
    // sync; login-time stamping in upsertUser is the redundant safety net.
    const superAdminEmails = parseSuperAdminEmails();
    if (superAdminEmails.length > 0) {
      organizationRepository
        .syncSuperAdmins(superAdminEmails)
        .then(() => logger.info(`[RouteConfigurator] super-admin reconcile ok (${superAdminEmails.length})`, { component: 'RouteConfigurator' }))
        .catch((err) => logger.warn('[RouteConfigurator] super-admin reconcile failed', { component: 'RouteConfigurator' }, err));
    }

    logger.info('[RouteConfigurator] Cloud-mode auth + admin routes registered (OSS core)', {
      component: 'RouteConfigurator',
    });
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
      // Org repo is now Noop-safe in OSS/local (NoopOrganizationRepository),
      // so wiring it unconditionally is harmless — the cloud overlay supplies
      // the real Redis-backed repo when present.
      organizationRepository: getInfrastructureFactory().getOrganizationRepository(),
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
      this.deps.workspaceResolver,
      factory.getStateStore(),
      this.deps.githubAuthService,
    );
    app.use('/api/cloud-ide', cloudIDERoutes);
  }

  /**
   * Setup preview routes
   */
  private setupPreviewRoutes(app: Express): void {
    // Preview routes moved to ant-preview service
    // @see docs/internals/02-infrastructure.md
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
      workflowStateService: this.deps.workflowStateService,
      stateStore: getInfrastructureFactory().getStateStore()
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
          userContext?: { userId: string; organizationId: string };
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
          const resumeJobId = data.result?.output?.resumeJobId;
          const resumeJobType = data.result?.output?.resumeJobType;
          const resumeDismissed = data.result?.output?.resumeDismissed;
          const originalDirective = data.result?.output?.originalDirective;
          logger.info(`Skipping cleanupJobState for inline-ask job: ${jobId} (intent=${intent}, action=${action}, noSession=${noSession})`, {
            component: 'RouteConfigurator'
          });

          // ✅ Broadcast inline-ask completion to frontend via user-scoped SSE channel
          try {
            const inlineAskContext = data.userContext
              ?? (userEmail ? parseCompositeUserEmail(userEmail) : undefined);
            if (inlineAskContext) {
              const { userId, organizationId } = inlineAskContext;
              const { getRealtimeBroadcastChannel } = await import('../../../../../infrastructure/state/redisConstants');
              const channel = getRealtimeBroadcastChannel(organizationId, userId);
              const userContext = {
                userId,
                organizationId,
              };

              // Resume-request → durable consent card (chat-SSOT). The user
              // explicitly asked to continue the interrupted job; consent to
              // re-open dismissed work stays a CLICK, never an inference —
              // the card's Resume action calls /jobs/:id/resume.
              if (action === 'resume-request' && resumeJobId && this.deps.chatService && projectId && featureName) {
                try {
                  await this.deps.chatService.appendChoicePresented(projectId, featureName, {
                    jobId,
                    cardId: `resume-confirm-${resumeJobId}-${Date.now()}`,
                    cardType: 'resume_confirm',
                    prompt: 'Resume interrupted job?',
                    payload: {
                      resumeJobId,
                      resumeJobType,
                      resumeDismissed: resumeDismissed === true,
                      originalDirective,
                    },
                    userContext,
                  });
                } catch (cardError) {
                  logger.warn(`Failed to append resume_confirm card: ${jobId}`, {
                    component: 'RouteConfigurator'
                  }, cardError);
                }
              }

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
                  resumeJobId,
                  resumeJobType,
                  resumeDismissed,
                  noSession,
                  timestamp: new Date().toISOString(),
                },
                userContext,
              });
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
        // Context precedence: structured payload.userContext → Redis mapping →
        // composite userEmail parse (last '@' — see parseCompositeUserEmail).
        let resolvedProjectId = projectId;
        let resolvedFeatureName = featureName;
        let userContext: { userId: string; organizationId: string } | undefined =
          data.userContext;
        if (!resolvedProjectId || !resolvedFeatureName || !userContext) {
          try {
            const mapping = await stateStore.getJobMapping(jobId);
            if (mapping?.projectId && mapping?.featureName) {
              resolvedProjectId = resolvedProjectId || mapping.projectId;
              resolvedFeatureName = resolvedFeatureName || mapping.featureName;
            }
            if (!userContext && mapping?.userContext) {
              userContext = mapping.userContext as { userId: string; organizationId: string };
            }
          } catch (err) {
            logger.error(`Failed to resolve mapping for job ${jobId}`, { component: 'RouteConfigurator' }, err);
          }
        }
        if (!userContext && userEmail) {
          userContext = parseCompositeUserEmail(userEmail);
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
        let sealJobType: SessionableJobType = jobType ?? 'code';
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
          `Expected one of: code, design, learn, plan, visual, universal, inline-ask.`,
        );
      }
      const jobType = params.jobType;

      // Generate jobId
      const { generateHumanId } = await import('../../../../../utils/humanId');
      const jobId = params.jobId || generateHumanId();

      // Preserve the turn anchor across a same-jobId re-launch. Callers that
      // resume an existing job (/resume, /continue, proceed_without_spec,
      // supersede-on-new-execute) carry no seedTurnId, but the setJobStatus
      // below is a FULL overwrite — writing without a turnId erases the
      // existing JobStatusData.turnId, the only cross-pod-safe anchor the
      // cancel/resume choice card resolves from. A later interruption then
      // hits "no turn anchor" and silently drops the card (slow-earning-heron
      // RCA). Carry the prior turnId forward; an explicit seedTurnId still wins.
      let seedTurnId: string | undefined = params.seedTurnId;
      if (!seedTurnId && params.jobId) {
        const prior = await stateStore.getJobStatus(params.jobId).catch(() => undefined);
        seedTurnId = prior?.turnId;
      }
      
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
        // Universal (D5): the composite definition ref rides the same
        // channel as overrideDirective — body → payload → env → runner.
        customJobRef: params.customJobRef,
        universalTurnMeta: params.universalTurnMeta,
        isResume: params.isResume ?? !!params.jobId,
        originalJobId: params.jobId,
        // chat SSOT §6 — pre-allocated turnId from /chat/user-message (fresh
        // jobs) or the preserved prior turnId (same-jobId re-launch), forwarded
        // to the worker entry so the durable user_turn line shares the same id
        // as the optimistic SSE broadcast.
        seedTurnId,
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
        timestamp: new Date().toISOString(),
        // Persist the pre-allocated turnId so a worker_stalled pause can
        // anchor its cancellation card from Redis even if the durable
        // user_turn disk write is lost — see JobStatusData.turnId. On a
        // same-jobId re-launch this carries the preserved prior turnId so the
        // full overwrite does not erase the anchor.
        ...(seedTurnId && { turnId: seedTurnId }),
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
