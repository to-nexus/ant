/**
 * UniversalDispatchService — the single enqueue path for every executable
 * job type. Extracted verbatim from `RouteConfigurator.createExecuteJob()`
 * so the HTTP route and the pipeline scheduler share ONE dispatch owner and
 * a scheduler can never bypass what the route does (jobId minting, workspace
 * ensure, enqueue, status/mapping writes, tracker cache).
 *
 * Behavior-preserving extraction notes (deliberate, do not "fix" in passing):
 * - `params` stays untyped (`any`) — the historical closure accepted extra
 *   fields (`jobId`, `seedTurnId`, `customJobRef`) via structural typing.
 * - `enableEvaluation` and `priority` are NOT forwarded (pre-existing drop).
 * - No transactional safety across enqueue → setJobStatus → setJobMapping.
 * Ports are injected; the composition site resolves the infrastructure
 * factory (core stays import-clean of infrastructure).
 */

import type { JobQueuePort } from '../ports/queue';
import type { StateStorePort } from '../ports/stateStore';
import { isExecutableJobType } from '@ant/shared';
import { generateHumanId } from '../../utils/humanId';
import { logger } from '../../utils/logger';

export interface UniversalDispatchPorts {
  jobQueue: Pick<JobQueuePort, 'enqueue'>;
  stateStore: Pick<StateStorePort, 'setJobStatus' | 'setJobMapping' | 'getJobStatus'>;
}

export interface UniversalDispatchDeps {
  workspaceService: { createWorkspace(tenantId: string, projectId: string): Promise<unknown> };
  workspaceResolver: { getPhysicalWorkspacesPath(): string };
  /**
   * Mints the capability-pinned bearer for a definition that declares an
   * `apis` self entry. Injected because signing authority belongs to the
   * process holding the key, not to core. Absent in local mode (no auth gate)
   * and in any process that cannot sign — the job then fails loud at connect
   * rather than 401-ing mid-turn.
   */
  selfApiTokenMinter?: (owner: {
    userId: string;
    organizationId: string;
    organizationKind?: import('@ant/shared').OrganizationKind;
  }) => string | undefined;
  /** In-memory kanban cache — present in the API server, absent for headless callers. */
  stateTracker?: {
    initializeJob(
      jobId: string,
      projectId: string,
      featureName: string,
      jobType: any,
      userContext?: any,
    ): void;
  };
}

export interface UniversalDispatchResult {
  jobId: string;
  success: true;
  message: string;
}

export class UniversalDispatchService {
  constructor(
    private readonly ports: UniversalDispatchPorts,
    private readonly deps: UniversalDispatchDeps,
  ) {}

  async enqueue(params: any): Promise<UniversalDispatchResult> {
    const { jobQueue, stateStore } = this.ports;

    // Single source of truth: jobType MUST be an executable type — every
    // SessionableJobType plus the lightweight `inline-ask` runner. The
    // legacy `params.jobType || 'code'` fallback silently downcast plan /
    // visual to code (zonal-dreaming-novel regression — Invariant I1), so
    // we validate against the executable union (sessionable + inline-ask)
    // and reject anything else. See `vast-curling-perch` resume blocker.
    if (!isExecutableJobType(params.jobType)) {
      throw new Error(
        `[RouteConfigurator] Invalid jobType: ${params.jobType}. ` +
        `Expected one of: code, design, learn, plan, visual, universal, inline-ask.`,
      );
    }
    const jobType = params.jobType;

    const jobId = params.jobId || generateHumanId();

    // Preserve the turn anchor across a same-jobId re-launch (slow-earning-heron
    // RCA): setJobStatus below is a FULL overwrite, and losing turnId drops the
    // cancel/resume card anchor. An explicit seedTurnId still wins.
    let seedTurnId: string | undefined = params.seedTurnId;
    if (!seedTurnId && params.jobId) {
      const prior = await stateStore.getJobStatus(params.jobId).catch(() => undefined);
      seedTurnId = prior?.turnId;
    }

    const enqueueStartTime = Date.now();
    const enqueueStartISO = new Date(enqueueStartTime).toISOString();
    logger.info(`⏱️ [JobTiming] API Server: Starting job enqueue | enqueueStartTime=${enqueueStartISO}`, {
      component: 'UniversalDispatch',
      jobId,
      projectId: params.project,
      featureName: params.feature,
    });

    // Ensure the tenant workspace exists (side effect only — handle unused).
    const tenantId = `${params.userContext.organizationId}:${params.userContext.userId}`;
    await this.deps.workspaceService.createWorkspace(tenantId, params.project);

    // JobWorker computes concrete paths from the base workspaces path.
    const workspaceBasePath = this.deps.workspaceResolver.getPhysicalWorkspacesPath();

    await jobQueue.enqueue({
      jobId,
      projectId: params.project,
      feature: params.feature,
      featureName: params.feature,
      type: jobType,
      agent: params.agent || 'architect',
      mode: params.mode || 'generate',
      userContext: params.userContext,
      workspacePath: workspaceBasePath,
      overrideDirective: params.overrideDirective,
      chatSource: params.chatSource,
      skipTriage: params.skipTriage,
      actionMetadata: params.actionMetadata,
      inputFile: params.inputFile,
      // Universal (D5): the composite definition ref rides the same
      // channel as overrideDirective — body → payload → env → runner.
      customJobRef: params.customJobRef,
      universalTurnMeta: params.universalTurnMeta,
      // Minted from the accept-time flag, never accepted from the caller: a
      // job that declares no self entry carries no credential at all.
      ...(params.declaresSelfApi === true
        ? { selfApiToken: this.deps.selfApiTokenMinter?.(params.userContext) }
        : {}),
      // Pipeline attribution — absent on interactive starts.
      firedBy: params.firedBy,
      pipelineRunId: params.pipelineRunId,
      pipelineStepId: params.pipelineStepId,
      isResume: params.isResume ?? !!params.jobId,
      originalJobId: params.jobId,
      // chat SSOT §6 — pre-allocated turnId (fresh jobs) or the preserved
      // prior turnId (same-jobId re-launch).
      seedTurnId,
    });

    await stateStore.setJobStatus(jobId, {
      jobId,
      status: 'queued',
      projectId: params.project,
      featureName: params.feature,
      type: jobType,
      mode: params.mode,
      userContext: params.userContext,
      timestamp: new Date().toISOString(),
      // Persist the anchor so a worker_stalled pause can resolve its
      // cancellation card from Redis (JobStatusData.turnId).
      ...(seedTurnId && { turnId: seedTurnId }),
      // Pipeline attribution — readable by kanban/chat surfaces.
      ...(params.firedBy && { firedBy: params.firedBy }),
      ...(params.pipelineRunId && { pipelineRunId: params.pipelineRunId }),
      ...(params.pipelineStepId && { pipelineStepId: params.pipelineStepId }),
    });

    // Cross-pod SSE broadcast needs the job → project/feature mapping.
    const userContextStr = params.userContext
      ? `${params.userContext.organizationId}:${params.userContext.userId}`
      : 'undefined';
    logger.info(`📝 [JobMapping] Saving job mapping to Redis: ${jobId} → ${params.project}/${params.feature} (${jobType}), userContext: ${userContextStr}`, {
      component: 'UniversalDispatch',
      jobId,
    });

    await stateStore.setJobMapping(jobId, {
      projectId: params.project,
      featureName: params.feature,
      jobType: jobType,
      userContext: params.userContext,
      // Universal: finalize locates the per-(agentId, customJobId) session
      // file for the run-history append via the ref.
      ...(params.customJobRef && { customJobRef: params.customJobRef }),
      ...(params.firedBy && { firedBy: params.firedBy }),
      ...(params.pipelineRunId && { pipelineRunId: params.pipelineRunId }),
      ...(params.pipelineStepId && { pipelineStepId: params.pipelineStepId }),
    });

    this.deps.stateTracker?.initializeJob(jobId, params.project, params.feature, jobType, params.userContext);

    const enqueueEndTime = Date.now();
    logger.info(`⏱️ [JobTiming] API Server: Job enqueued to Redis | enqueueStartTime=${enqueueStartISO} | enqueueEndTime=${new Date(enqueueEndTime).toISOString()} | enqueueDurationMs=${enqueueEndTime - enqueueStartTime}`, {
      component: 'UniversalDispatch',
      jobId,
      projectId: params.project,
      featureName: params.feature,
    });

    return {
      jobId,
      success: true,
      message: 'Job enqueued',
    };
  }
}
