import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteJobParams } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';
import type { StateStorePort, JobStatusData } from '../../../../core/ports/stateStore';
import type { JobProjectMapping } from '../../../../core/types/task';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { REDIS_CHANNELS } from '../../../../infrastructure/state/redisConstants';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { getAllSessionPaths, getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';
import { readBranchBaseFromConfig } from '../../../../core/utils/branchUtils';
import { jobExecuteRateLimiter } from '../middleware/rateLimiter';
import { validateBody, executeJobSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';
import { getConfigSlots } from '@ant/shared';
import type { JobStateTracker } from '../express/managers/JobStateTracker';
import type { KanbanService } from '../services';
import { finalizeTerminalJob } from '../express/lifecycle/finalizeTerminalJob';

/**
 * Auto-resolve agent from job type when not explicitly provided.
 */
function resolveAgentForJobType(jobType: string): string {
  switch (jobType) {
    case 'plan': return 'planner';
    case 'visual': return 'creator';
    default: return 'architect';
  }
}

/**
 * Job execution routes
 * 
 * Uses Redis StateStore for cross-pod job state management (always distributed).
 */
export function createJobRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: 'design' | 'code' | 'learn' | 'plan' | 'visual', userContext?: { userId: string; organizationId: string }) => Promise<void>;
  workflowStateService: import('../services/WorkflowStateService').WorkflowStateService;
  chatService: import('../services/ChatService').ChatService;
  stateStore: StateStorePort;
  stateTracker: JobStateTracker;
  kanbanService?: KanbanService;
}): Router {
  const router = Router();

  /**
   * Mirror prereq / conflict / job-start error responses into the chat
   * stream as an `assistant_message` line so the FE renders them in the
   * conversation log without relying on legacy `addChatMessage` calls
   * from `cli.ts`. Fire-and-forget — never block the HTTP response.
   *
   * Skips when seedTurnId is missing (e.g. /resume / /continue paths
   * which do not flow through `/chat/user-message`).
   */
  async function emitConflictAssistantMessage(
    projectId: string,
    featureName: string,
    seedTurnId: string | undefined,
    jobId: string,
    userContext: { userId: string; organizationId: string },
    text: string,
  ): Promise<void> {
    if (!seedTurnId || !deps.chatService) return;
    try {
      await deps.chatService.appendAssistantMessage(projectId, featureName, text, {
        jobId,
        turnId: seedTurnId,
        userContext,
      });
    } catch (err) {
      logger.warn(
        `Failed to emit conflict assistant_message: ${(err as Error)?.message ?? err}`,
        { component: 'JobRoute' },
      );
    }
  }

  /**
   * Thin closure over `finalizeTerminalJob` so individual route handlers
   * don't repeat the `{ cleanupJobState, stateTracker, kanbanService }`
   * dep tuple. Single entry point for terminal transitions (SSOT).
   */
  async function finalize(args: {
    jobId: string;
    finalStatus: 'completed' | 'failed';
    projectId: string;
    featureName: string;
    jobType: 'code' | 'design' | 'learn' | 'plan' | 'visual';
    userContext?: { userId: string; organizationId: string };
    interruption?: InterruptionDetails;
    featurePath?: string;
  }): Promise<void> {
    await finalizeTerminalJob(
      {
        cleanupJobState: deps.cleanupJobState,
        stateTracker: deps.stateTracker,
        kanbanService: deps.kanbanService,
      },
      args,
    );
  }
  
  /**
   * Get job status from Redis StateStore
   */
  async function getJobStatusAsync(jobId: string): Promise<JobStatusData | null> {
    return deps.stateStore.getJobStatus(jobId);
  }
  
  
  /**
   * Check if feature already has a running or interrupted (paused) job
   * of the same jobType. Filters by jobType to prevent cross-type blocking
   * (e.g. a paused design job should not block a new code job).
   */
  async function checkDuplicateJob(projectId: string, featureName: string, jobType?: string): Promise<{ jobId: string; isInterrupted: boolean } | undefined> {
    const jobs = await deps.stateStore.listJobsByFeature(projectId, featureName);
    const active = jobs.find(j =>
      (j.status === 'running' || j.status === 'paused') &&
      (!jobType || j.type === jobType)
    );
    if (!active) return undefined;
    return { jobId: active.jobId, isInterrupted: active.status === 'paused' };
  }

  /**
   * Check whether a paused job still has a resumable session file.
   * If the session was cleared (interruption is null/missing), the paused job
   * is a "zombie" that can never be dismissed via the UI — auto-dismiss it.
   */
  function hasResumableSession(featurePath: string, jobId: string): boolean {
    for (const entry of getAllSessionPaths(featurePath)) {
      try {
        if (!fs.existsSync(entry.path)) continue;
        const data = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
        if (data.state?.jobId === jobId && data.state?.interruption) {
          return true;
        }
      } catch { continue; }
    }
    return false;
  }
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', jobExecuteRateLimiter, validateBody(executeJobSchema), async (req: Request, res: Response) => {
    const requestReceivedAt = new Date().toISOString();
    // chat-SSOT — declared before the try block so the catch handler
    // can surface a server-side `assistant_message` line for the same
    // turn when the execute pipeline throws (queue / spawn / …).
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource, skipTriage, actionMetadata, seedTurnId } = req.body;
    let userContext: { userId: string; organizationId: string } | null = null;
    try {
      userContext = extractUserContext(req);

      // Check if this feature already has a running or interrupted job of the same type
      const duplicate = await checkDuplicateJob(projectId, featureName, jobType);

      if (duplicate) {
        const { jobId: existingJobId, isInterrupted } = duplicate;

        if (isInterrupted) {
          // Verify session file still has resumable interruption data.
          // If session was cleared, this is a zombie paused job — auto-dismiss it.
          const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
          const resumable = hasResumableSession(featurePath, existingJobId);

          if (!resumable) {
            logger.info(`Auto-dismissing zombie paused job: ${existingJobId} (session cleared)`, { component: 'JobRoute' });
            // Seal the zombie paused record (status, taskQueue, workflow, etc.)
            // so it can't reappear in `listJobsByFeature` or block future jobs.
            // jobType here is the incoming request's type — matches the zombie
            // because checkDuplicateJob filtered by jobType.
            await finalize({
              jobId: existingJobId,
              finalStatus: 'failed',
              projectId,
              featureName,
              jobType: jobType as 'code' | 'design' | 'learn' | 'plan' | 'visual',
              userContext,
              interruption: {
                reason: 'user_stopped',
                message: 'Auto-dismissed: session data was cleared',
                canResume: false,
                timestamp: new Date().toISOString(),
                metadata: { stoppedBy: 'zombie_auto_dismiss' },
              },
              featurePath,
            });
            // Fall through to normal job execution below
          } else {
            await emitConflictAssistantMessage(
              projectId,
              featureName,
              seedTurnId,
              existingJobId,
              userContext,
              '이전 작업이 중단되어 있습니다. 재개하거나 닫아주세요.',
            );
            return res.status(409).json({
              error: 'A previous job was interrupted. Please resume or dismiss it first.',
              existingJobId,
              isInterrupted: true,
              featureKey: `${projectId}/${featureName}`
            });
          }
        } else {
          await emitConflictAssistantMessage(
            projectId,
            featureName,
            seedTurnId,
            existingJobId,
            userContext,
            `이미 진행 중인 작업이 있습니다. (Job ID: ${existingJobId})`,
          );
          return res.status(409).json({
            error: 'A job is already running for this feature. Please wait for it to complete or stop it first.',
            existingJobId,
            isInterrupted: false,
            featureKey: `${projectId}/${featureName}`
          });
        }
      }

      // Matrix-driven build precondition: reject if required context is missing
      if (actionMetadata?.intent) {
        const slots = getConfigSlots(actionMetadata.intent);
        if (slots?.buildRequiresContext && (!actionMetadata.context || actionMetadata.context.length === 0)) {
          await emitConflictAssistantMessage(
            projectId,
            featureName,
            seedTurnId,
            `prereq-${seedTurnId ?? Date.now()}`,
            userContext,
            `❌ Context files must be selected for action: ${actionMetadata.intent}`,
          );
          return res.status(400).json({
            error: 'Context files must be selected for this action.',
            code: 'context-not-selected',
            intent: actionMetadata.intent,
          });
        }
      }

      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const inputFile = overrideDirective ? undefined : path.join(featurePath, `meta/directives/${jobType}/directive.md`);
      
      const resolvedAgent = agent || resolveAgentForJobType(jobType);
      
      const params: ExecuteJobParams = {
        agent: resolvedAgent,
        jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation,
        overrideDirective,
        chatSource,
        skipTriage,
        actionMetadata,
        userContext,
        // chat SSOT §6 — pre-allocated turnId from /chat/user-message,
        // forwarded to the worker so the durable user_turn line shares
        // the same id as the optimistic SSE broadcast.
        seedTurnId,
      };

      const enqueuedAt = new Date().toISOString();
      const result = await deps.executeJob(params);
      logger.info(`Job enqueued: ${projectId}/${featureName} jobId=${result.jobId}`, { component: 'JobRoute' });

      // chat-SSOT — surface prereq validation failure into the chat
      // stream so the user sees the "missing materials" rejection
      // alongside their request bubble. Prior to Phase 9, this lived
      // in `cli.ts` as an optimistic FE-side `addChatMessage`; with
      // chat events now driven by SSE only, the BE owns the emission.
      if (!result.success && result.missingMaterials && result.missingMaterials.length > 0) {
        const materialsList = result.missingMaterials
          .map((m: any) => `  • ${m.name}: ${m.description}`)
          .join('\n');
        const text =
          `❌ Cannot start ${jobType} job. The following required materials are missing:\n\n${materialsList}\n\nAll of these materials must be provided before starting the job.`;
        await emitConflictAssistantMessage(
          projectId,
          featureName,
          seedTurnId,
          result.jobId ?? `prereq-${seedTurnId ?? Date.now()}`,
          userContext,
          text,
        );
      }

      res.json(result);
    } catch (error: any) {
      // chat-SSOT — server-side execute failures (queue / spawn / …)
      // also flow into the chat stream so the user is not stranded
      // with a silent 5xx. Best-effort; never block the error response.
      try {
        if (deps.chatService && seedTurnId && userContext) {
          const message = (error?.message as string) ?? 'Unknown error';
          await deps.chatService.appendAssistantMessage(
            projectId,
            featureName,
            `❌ Job 실행 실패: ${message}`,
            {
              jobId: `start-error-${seedTurnId}`,
              turnId: seedTurnId,
              userContext,
            },
          );
        }
      } catch {/* never block error response */}
      sendErrorResponse(res, 500, error, 'JobExecute');
    }
  });

  // Execute learn job on base branch (no feature context required)
  router.post('/projects/:id/learn', jobExecuteRateLimiter, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required and must be a string' });
      }

      const userContext = extractUserContext(req);
      const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
      const branchBase = readBranchBaseFromConfig(projectPath);

      // Check if base branch already has a running job
      const duplicate = await checkDuplicateJob(projectId, branchBase);
      if (duplicate) {
        return res.status(409).json({
          error: 'A learn job is already running for this project. Please wait for it to complete or stop it first.',
          existingJobId: duplicate.jobId,
          isInterrupted: duplicate.isInterrupted,
          featureKey: `${projectId}/${branchBase}`
        });
      }

      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: 'learn',
        project: projectId,
        feature: branchBase,
        overrideDirective: message,
        chatSource: true,
        skipTriage: true,
        userContext
      };

      const result = await deps.executeJob(params);
      logger.info(`Base branch learn job enqueued: ${projectId}/${branchBase} jobId=${result.jobId}`, { component: 'JobRoute' });

      res.json(result);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'ProjectLearn');
    }
  });
  
  // Get task status.
  //
  // Resolution order:
  //   1. Live Redis record (`ant:job:status:{id}`) — returned as-is when present.
  //   2. Session `runs[]` fallback — terminal jobs whose Redis record was
  //      sealed by the SSOT lifecycle. We scan the three kanban session
  //      files (code/design/learn) and synthesize a `JobStatusData`-ish
  //      shape from the matching run.
  //   3. 404 when neither source knows the jobId.
  //
  // Used by e2e test helpers and ops runbooks. The ant-ui FE does not call
  // this endpoint in the normal flow — see docs/testing/e2e-runbook.md.
  router.get('/jobs/:jobId/status', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const status = await getJobStatusAsync(jobId);

    if (status) {
      res.json(status);
      return;
    }

    // Session runs[] fallback. Note: we don't have (projectId, featureName)
    // in the request path, so we rely on the client passing them as query
    // params for the fallback to work. Without them the fallback is skipped
    // and the endpoint returns 404 — matching pre-refactor behaviour when
    // Redis is empty.
    const projectId = req.query.projectId as string | undefined;
    const featureName = req.query.featureName as string | undefined;
    if (!projectId || !featureName) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    try {
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      for (const entry of getAllSessionPaths(featurePath)) {
        if (!fs.existsSync(entry.path)) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
        } catch {
          continue;
        }
        const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
        const match = runs.find((r: any) => r?.jobId === jobId);
        if (match) {
          const synthesized: JobStatusData = {
            jobId,
            status: (match.status === 'canceled' || match.status === 'paused' || match.status === 'failed')
              ? 'failed'
              : 'completed',
            projectId,
            featureName,
            type: entry.job as JobStatusData['type'],
            startedAt: match.timestamp,
            completedAt: match.completedAt ?? match.timestamp,
            error: match.output?.error,
          };
          res.json(synthesized);
          return;
        }
      }
    } catch (err) {
      logger.warn(
        `Session runs[] fallback failed for jobId=${jobId}`,
        { component: 'JobRoute' },
        err,
      );
    }

    res.status(404).json({ error: 'Task not found' });
  });
  
  // Get queue position for a job (enriched with Redis job status for crash recovery)
  router.get('/jobs/:jobId/queue-position', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    
    try {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const factory = getInfrastructureFactory();
      const jobQueue = factory.getJobQueue();
      const stateStore = factory.getStateStore();
      
      const position = await jobQueue.getQueuePosition(jobId);

      // Enrich with Redis job status so the UI can detect interrupted/paused jobs
      // even when BullMQ no longer has the job (e.g. after crash + stalled -> failed).
      const redisStatus = await stateStore.getJobStatus(jobId);
      const result: Record<string, any> = { ...position };
      if (redisStatus) {
        result.redisStatus = redisStatus.status;
      }

      res.json(result);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobQueuePosition');
    }
  });
  
  // Stop task — terminal transition. Sequence:
  //   1. markUserStopped + publish(STOP) → signal the worker child to exit.
  //   2. finalize(failed, user_stopped) — acquires idempotency locks BEFORE
  //      sealing so the subsequent BullMQ `completed` event (fired when the
  //      worker's child exits) can't trigger a duplicate cleanup via the
  //      RouteConfigurator subscriber.
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, jobType } = req.body;

    logger.info(`Stop request: job=${jobId}`, { component: 'JobRoute' });
    logger.debug(`Stop: project=${projectId}, feature=${featureName}`, { component: 'JobRoute' });
    const userContext = extractUserContext(req);
    logger.debug(`Stop: user=${userContext.userId}`, { component: 'JobRoute' });

    // Mark as user-stopped in Redis (read by JobWorker's polling backup).
    // The seal inside finalize() will DEL this shortly after the worker
    // has consumed the pub/sub STOP signal — that's OK: the polling read
    // is best-effort and the pub/sub path is primary.
    await deps.stateStore.markUserStopped(jobId);

    // Publish STOP signal — primary mechanism for the worker to kill its child.
    await deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, {
      jobId,
      projectId,
      featureName,
      timestamp: new Date().toISOString(),
    });

    const interruption: InterruptionDetails = {
      reason: 'user_stopped',
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: { stoppedBy: 'user_action' },
    };

    const resolvedJobType = (jobType || 'code') as 'code' | 'design' | 'learn' | 'plan' | 'visual';
    const featurePath = projectId && featureName
      ? deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName)
      : undefined;

    await finalize({
      jobId,
      finalStatus: 'failed',
      projectId,
      featureName,
      jobType: resolvedJobType,
      userContext,
      interruption,
      featurePath,
    });

    res.json({
      success: true,
      message: 'Task stopped successfully',
      jobId,
    });
  });
  
  // Resume existing job
  router.post('/jobs/:jobId/resume', async (req: Request, res: Response) => {
    const requestedJobId = req.params.jobId;
    const { projectId, featureName, chatSource = true } = req.body;
    
    logger.debug(`\n🔄 [ResumeRoute] Resume request received`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   Requested jobId: ${requestedJobId} (will use session's jobId if found)`);
    
    let sessionJobId: string | null = null;
    
    try {
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      
      let jobType: string | null = null;
      let sessionData: any = null;
      let foundAgent: string | null = null;
      
      for (const entry of getAllSessionPaths(featurePath)) {
        if (fs.existsSync(entry.path)) {
          const data = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
          if (data.state?.jobId && data.state?.interruption) {
            // ✅ If a specific jobId was requested, only match that exact session
            if (requestedJobId && data.state.jobId !== requestedJobId) {
              continue;
            }
            
            // ✅ Guard against stale interruption: if taskQueue is empty and tasks
            // were completed, the interruption is leftover from a recursion-limit
            // retry that ultimately succeeded. Skip it — there's nothing to resume.
            const taskQueueSize = data.state.taskQueue?.length || 0;
            const completedCount = data.state.completedTasks?.length || 0;
            if (taskQueueSize === 0 && completedCount > 0) {
              logger.debug(`   ⚠️ Skipping stale interruption in ${entry.agent}/${entry.job}.json (0 tasks remaining, ${completedCount} completed)`);
              continue;
            }
            
            jobType = entry.job;
            foundAgent = entry.agent;
            sessionJobId = data.state.jobId;
            sessionData = data;
            logger.debug(`   Found interrupted job in ${entry.agent}/${entry.job}.json`);
            logger.debug(`   Session jobId: ${sessionJobId}`);
            break;
          }
        }
      }
      
      if (!jobType || !sessionJobId || !sessionData) {
        logger.debug(`   ❌ No interrupted job found in session files`);
        return res.status(404).json({ 
          error: 'No interrupted job found',
          message: `No resumable job found for ${projectId}/${featureName}`
        });
      }
      
      logger.debug(`   Job type: ${jobType}`);
      logger.debug(`   Starting resume job execution...`);
      
      // ✅ Resolve all unresolved cancelled cards for this jobId. The
      //   user chose to resume, so any open "Task cancelled" card the
      //   chat is showing is no longer actionable. Each pause cycle
      //   has a unique cardId (chat-SSOT §7 — pauseSeq), so we scan
      //   chat.jsonl for cardType='cancelled' lines matching jobId
      //   and emit choice_resolved for each.
      if (deps.chatService && sessionJobId) {
        await deps.chatService.resolveAllCancelledForJob(projectId, featureName, sessionJobId, {
          choiceSelected: 'resume',
          resolvedLabel: 'Resumed',
          userContext,
        });
      }

      // ✅ Resume always sets isResume=true. Graph router uses this + hasTaskQueue + hasResolvedAction
      // to determine correct entry point (plan, decompose, or triage)
      const hasTaskQueue = (sessionData.state?.taskQueue?.length || 0) > 0;
      
      let inputFile: string | undefined;
      
      if (!hasTaskQueue) {
        // No tasks: may need directive file for re-execution from triage
        const directivePath = path.join(featurePath, `meta/directives/${jobType}/directive.md`);
        if (fs.existsSync(directivePath)) {
          inputFile = directivePath;
        }
        logger.debug(`   No taskQueue, will re-run from appropriate entry point. directiveFile=${!!inputFile}`);
      } else {
        logger.debug(`   Plain resume: ${sessionData.state.taskQueue.length} tasks in queue`);
      }
      
      const params: ExecuteJobParams = {
        agent: (foundAgent || 'architect') as ExecuteJobParams['agent'],
        jobType: jobType as ExecuteJobParams['jobType'],
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation: false,
        chatSource,
        userContext,
        jobId: sessionJobId,
        isResume: true
      };
      
      const result = await deps.executeJob(params);
      
      // ✅ Clear idempotency locks AFTER executeJob so old BullMQ job is
      // removed first (inside enqueue). This closes the stale-event window
      // and ensures locks stay intact if executeJob throws.
      // Five lock layers: BullMQJobQueue completed, RouteConfigurator
      // completed, RouteConfigurator failed, finalizeTerminalJob primary,
      // and pauseJob entry-level (chat SSOT §8) — all TTL 120s.
      await deps.stateStore.releaseLock(`ant:job-completed:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:completed`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:failed`);
      await deps.stateStore.releaseLock(`ant:job-finalize:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-pause:${sessionJobId}`);
      logger.debug(`   ✅ Cleared completion/failure/pause idempotency locks for ${sessionJobId}`);
      
      logger.debug(`   ✅ Resume job continued with existing jobId: ${sessionJobId}`);
      logger.debug(`   ✅ Resume request completed\n`);
      
      res.json({
        success: true,
        jobId: sessionJobId,
        jobType,
        message: `Job ${sessionJobId} resumed`
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobResume');
    }
  });
  
  // Continue existing job with additional directive
  router.post('/jobs/:jobId/continue', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, newDirective, chatSource = true } = req.body;
    
    logger.debug(`\n➕ [ContinueRoute] Continue request received for job: ${jobId}`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   New directive: ${newDirective?.substring(0, 100)}...`);
    
    if (!newDirective || typeof newDirective !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'newDirective is required and must be a string'
      });
    }
    
    try {
      const userContext = extractUserContext(req);
      
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      
      let jobType: string | null = null;
      let sessionPath: string | null = null;
      let foundAgent: string | null = null;
      
      for (const entry of getAllSessionPaths(featurePath)) {
        if (fs.existsSync(entry.path)) {
          const sessionData = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
          if (sessionData.state?.jobId === jobId) {
            jobType = entry.job;
            sessionPath = entry.path;
            foundAgent = entry.agent;
            logger.debug(`   Found job in ${entry.agent}/${entry.job}.json`);
            break;
          }
        }
      }
      
      if (!jobType || !sessionPath) {
        logger.debug(`   ❌ Job ${jobId} not found in any session file`);
        return res.status(404).json({ 
          error: 'Job not found',
          message: `Job ${jobId} not found in session files`
        });
      }
      
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      
      if (!sessionData.state.directives) {
        sessionData.state.directives = [];
      }
      
      sessionData.state.directives.unshift(newDirective);
      
      logger.debug(`   ✅ Added new directive (total: ${sessionData.state.directives.length})`);
      
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      logger.debug(`   ✅ Session updated with new directive`);
      
      // ✅ Resolve all unresolved cancelled cards for this jobId. See
      //   /resume route for the rationale (per-pauseSeq unique cardIds).
      const sessionJobId = sessionData.state?.jobId || jobId;
      if (deps.chatService) {
        await deps.chatService.resolveAllCancelledForJob(projectId, featureName, sessionJobId, {
          choiceSelected: 'resume',
          resolvedLabel: 'Resumed',
          userContext,
        });
      }
      
      const inputFile = undefined;
      
      const params: ExecuteJobParams = {
        agent: (foundAgent || 'architect') as ExecuteJobParams['agent'],
        jobType: jobType as ExecuteJobParams['jobType'],
        project: projectId,
        feature: featureName,
        inputFile: undefined,
        enableEvaluation: false,
        overrideDirective: newDirective,  // ✅ Pass new directive (triggers revise)
        chatSource,
        userContext,
        jobId: sessionJobId,
        isResume: true  // ✅ Always true for continue
      };
      
      const result = await deps.executeJob(params);
      
      logger.debug(`   ✅ Continue job started: ${result.jobId}`);
      logger.debug(`   ✅ Continue request completed\n`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        originalJobId: jobId,
        jobType,
        directivesCount: sessionData.state.directives.length,
        message: `Job continued from ${jobId} with new directive`
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobContinue');
    }
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inline Ask: Handle ask queries during interrupted jobs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  router.post('/projects/:id/features/:feature/inline-ask', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { message, chatSource = true } = req.body;
    
    logger.debug(`\n💬 [InlineAskRoute] Inline ask request received`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   Message: ${message?.substring(0, 100)}...`);
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'message is required and must be a string'
      });
    }
    
    try {
      const userContext = extractUserContext(req);
      
      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: 'inline-ask',
        project: projectId,
        feature: featureName,
        inputFile: undefined,
        enableEvaluation: false,
        overrideDirective: message,
        chatSource,
        userContext,
        // ✅ No jobId: always create a new job (don't reuse interrupted job's ID)
        // ✅ No isResume: this is an independent lightweight job
      };
      
      const result = await deps.executeJob(params);
      
      logger.debug(`   ✅ Inline ask job started: ${result.jobId}`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        jobType: 'inline-ask',
        message: 'Inline ask job started'
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'InlineAsk');
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Decompose Spec Clarify choice (session-redesign 5-tier)
  // Body: { jobId, choice: 'redirect_to_design' | 'proceed_without_spec' | 'cancel' }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  router.post('/projects/:id/features/:feature/chat/decompose-choice', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId, choice } = req.body || {};

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const validChoices = ['redirect_to_design', 'proceed_without_spec', 'cancel'];
    if (!validChoices.includes(choice)) {
      return res.status(400).json({ error: `Invalid choice. Must be one of: ${validChoices.join(', ')}` });
    }

    try {
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const codeSessionPath = getSessionFilePathByJob(featurePath, 'code');
      if (!fs.existsSync(codeSessionPath)) {
        return res.status(404).json({ error: 'No code session found for this feature' });
      }

      // Use FileSessionAdapter for a mutex-safe read (consistent with Chapter 2
      // atomic_user_turn_write and feature-log.routes.ts pattern).
      const { FileSessionAdapter } = await import('../../session/FileSessionAdapter');
      const loadAdapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
      const sessionData = await loadAdapter.load(projectId, featureName, 'code');
      const sessionState = (sessionData?.state || {}) as Record<string, any>;
      const sessionJobId: string | undefined = sessionState.jobId;
      const awaiting: boolean = sessionState.awaitingDecomposeClarify === true;
      const specClarifyPresent = Boolean(sessionState.specClarify);

      if (!awaiting || !specClarifyPresent) {
        return res.status(409).json({
          error: 'No pending spec-clarify choice for this code session',
          awaitingDecomposeClarify: awaiting,
          hasSpecClarify: specClarifyPresent,
        });
      }
      if (sessionJobId && sessionJobId !== jobId) {
        return res.status(409).json({ error: 'jobId does not match current code session', expectedJobId: sessionJobId });
      }

      const originalDirective: string | undefined =
        sessionState.overrideDirective
        || (Array.isArray(sessionState.directives) ? sessionState.directives[0] : undefined)
        || sessionState.directive;

      // Dispatch by choice
      if (choice === 'redirect_to_design') {
        // 1) Seal the paused code job as terminal (same SSOT as /dismiss).
        //    finalize handles idempotency, snapshot append, broadcast, and seal.
        const codeStatus = await deps.stateStore.getJobStatus(jobId);
        if (codeStatus?.status === 'paused') {
          await finalize({
            jobId,
            finalStatus: 'failed',
            projectId,
            featureName,
            jobType: 'code',
            userContext,
            interruption: {
              reason: 'user_stopped',
              message: 'Redirected to design via spec-clarify choice',
              canResume: false,
              timestamp: new Date().toISOString(),
              metadata: { stoppedBy: 'decompose_redirect_to_design' },
            },
            featurePath,
          });
        }

        // 2) Enqueue a fresh design job with the original directive
        const designParams: ExecuteJobParams = {
          agent: 'architect',
          jobType: 'design',
          project: projectId,
          feature: featureName,
          overrideDirective: originalDirective,
          chatSource: true,
          userContext,
        };
        const result = await deps.executeJob(designParams);
        logger.info(`Decompose redirect_to_design: codeJob=${jobId} → designJob=${result.jobId}`, { component: 'JobRoute' });
        return res.json({
          success: true,
          choice,
          action: 'design_enqueued',
          designJobId: result.jobId,
        });
      }

      if (choice === 'proceed_without_spec') {
        // Patch session so the resumed code job bypasses specClarify on re-entry.
        // Reuse the mutex-backed adapter from the top-level load so the write
        // goes through the per-file lock (Chapter 2 atomic_user_turn_write).
        await loadAdapter.updateArtifacts(projectId, featureName, 'code', {
          state: {
            ...sessionState,
            _specClarifyBypassed: true,
            specClarify: undefined,
          },
        });
        logger.debug(`Decompose proceed_without_spec: _specClarifyBypassed=true written to code session ${jobId}`);

        const resumeParams: ExecuteJobParams = {
          agent: 'architect',
          jobType: 'code',
          project: projectId,
          feature: featureName,
          jobId: sessionJobId || jobId,
          isResume: true,
          chatSource: true,
          userContext,
        };

        const result = await deps.executeJob(resumeParams);

        // Mirror /jobs/:jobId/resume: release idempotency locks AFTER executeJob.
        // Rationale (see /resume route): the enqueue path removes the old
        // BullMQ job first; releasing locks afterwards closes the stale-event
        // window and keeps the locks intact if executeJob throws.
        // Five lock layers (chat SSOT §8 adds pauseJob):
        const resumeLockJobId = sessionJobId || jobId;
        await deps.stateStore.releaseLock(`ant:job-completed:${resumeLockJobId}`);
        await deps.stateStore.releaseLock(`ant:job-event:${resumeLockJobId}:completed`);
        await deps.stateStore.releaseLock(`ant:job-event:${resumeLockJobId}:failed`);
        await deps.stateStore.releaseLock(`ant:job-finalize:${resumeLockJobId}`);
        await deps.stateStore.releaseLock(`ant:job-pause:${resumeLockJobId}`);

        logger.info(`Decompose proceed_without_spec: resumed code job ${result.jobId}`, { component: 'JobRoute' });
        return res.json({
          success: true,
          choice,
          action: 'code_resumed',
          jobId: result.jobId,
        });
      }

      // cancel — terminal transition via the single SSOT entry point.
      // Note: we don't markUserStopped here because there's no running
      // worker child to signal — the job is already paused. finalize's
      // idempotency lock (ant:job-event:{id}:*) supplants the old manual
      // `ant:job-completed` / `ant:job-event:{id}:completed|failed` release
      // dance; there's no running worker that would re-publish completion.
      const interruption: InterruptionDetails = {
        reason: 'user_stopped',
        message: 'Spec-clarify cancelled by user',
        timestamp: new Date().toISOString(),
        canResume: false,
        metadata: { stoppedBy: 'decompose_choice_cancel' },
      };
      await finalize({
        jobId,
        finalStatus: 'failed',
        projectId,
        featureName,
        jobType: 'code',
        userContext,
        interruption,
        featurePath,
      });
      logger.info(`Decompose cancel: code job ${jobId} dismissed`, { component: 'JobRoute' });
      return res.json({ success: true, choice, action: 'code_cancelled' });
    } catch (error: any) {
      return sendErrorResponse(res, 500, error, 'DecomposeChoice');
    }
  });

  // Dismiss an interrupted/cancelled job — clears the server-side state
  // so the user can acknowledge the interruption and start a new job.
  //
  // For 'paused' jobs: transitions to sealed-failed via finalize.
  // For already-terminal / Redis-null jobs: idempotent 200 (seal already done).
  //
  // Post-seal semantics: Redis returns null for completed/failed jobs. A
  // second dismiss call therefore sees `jobStatus == null` — treated as
  // "already dismissed" rather than 404, so the UI's dismiss button stays
  // safe to click after seal has happened.
  router.post('/projects/:id/features/:feature/job/dismiss', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId } = req.body;

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'jobId is required' });
    }

    try {
      const userContext = extractUserContext(req);
      const jobStatus = await deps.stateStore.getJobStatus(jobId);

      // No Redis record → already sealed (terminal) or never existed — both
      // surface as idempotent success for the dismiss UX.
      if (!jobStatus) {
        logger.debug(
          `Job dismiss: no Redis record (already sealed or never existed) jobId=${jobId}`,
          { component: 'JobRoute' },
        );
        return res.json({ success: true, alreadyDismissed: true });
      }

      const terminalStatuses = ['failed', 'completed', 'cancelled', 'stopped'];
      if (jobStatus.status === 'paused') {
        // Paused → terminal. Go through finalize for seal + broadcast + idempotency lock.
        const jobType = (jobStatus.type || 'code') as 'code' | 'design' | 'learn' | 'plan' | 'visual';
        const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
        await finalize({
          jobId,
          finalStatus: 'failed',
          projectId,
          featureName,
          jobType,
          userContext,
          interruption: {
            reason: 'user_stopped',
            message: 'Dismissed by user',
            canResume: false,
            timestamp: new Date().toISOString(),
            metadata: { stoppedBy: 'dismiss' },
          },
          featurePath,
        });

        // chat-SSOT — every cancelled card carrying this jobId is now
        // stale; flip them to "Dismissed" via choice_resolved so the
        // chat view does not keep dangling unresolved cards across
        // dismiss / inline-ask 'newJob' / redirect flows. Mirrors the
        // resume path's `resolveAllCancelledForJob` invocation.
        if (deps.chatService) {
          await deps.chatService.resolveAllCancelledForJob(projectId, featureName, jobId, {
            choiceSelected: 'dismiss',
            resolvedLabel: 'Dismissed',
            userContext,
          });
        }
      } else if (terminalStatuses.includes(jobStatus.status)) {
        // Pre-refactor legacy path — Redis still holds a terminal record.
        // After this PR lands fully, seal makes this branch effectively
        // unreachable, but keep it as idempotent defense for any orphan
        // rows created before the seal path was wired.
        logger.debug(
          `Job dismiss: already terminal (${jobStatus.status}) — performing defensive seal`,
          { component: 'JobRoute' },
        );
        const jobType = (jobStatus.type || 'code') as 'code' | 'design' | 'learn' | 'plan' | 'visual';
        const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
        await finalize({
          jobId,
          finalStatus: 'failed',
          projectId,
          featureName,
          jobType,
          userContext,
          featurePath,
        });
      } else {
        // Running or queued — cannot dismiss
        return res.status(400).json({ error: `Cannot dismiss job in '${jobStatus.status}' state` });
      }

      logger.info(
        `Job dismissed: ${projectId}/${featureName} jobId=${jobId} (was: ${jobStatus.status})`,
        { component: 'JobRoute' },
      );
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobDismiss');
    }
  });

  return router;
}
