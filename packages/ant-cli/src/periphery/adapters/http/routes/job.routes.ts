import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteJobParams, LogEntry } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';
import type { StateStorePort, JobStatusData } from '../../../../core/ports/stateStore';
import type { JobProjectMapping } from '../../../../core/types/task';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { REDIS_CHANNELS } from '../../../../infrastructure/state/redisConstants';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { getAllSessionPaths, getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';
import { readBranchBaseFromConfig } from '../../../../core/utils/branchUtils';
import { jobExecuteRateLimiter } from '../middleware/rateLimiter';
import { validateBody, executeJobSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';

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
}): Router {
  const router = Router();
  
  /**
   * Get job status from Redis StateStore
   */
  async function getJobStatusAsync(jobId: string): Promise<JobStatusData | null> {
    return deps.stateStore.getJobStatus(jobId);
  }
  
  /**
   * Get job logs from Redis StateStore
   */
  async function getJobLogsAsync(jobId: string): Promise<LogEntry[]> {
    return deps.stateStore.getJobLogs(jobId);
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
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource, skipTriage } = req.body;
      
      const userContext = extractUserContext(req);

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
            await deps.stateStore.updateJobStatus(existingJobId, {
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: 'Auto-dismissed: session data was cleared',
            });
            // Fall through to normal job execution below
          } else {
            return res.status(409).json({
              error: 'A previous job was interrupted. Please resume or dismiss it first.',
              existingJobId,
              isInterrupted: true,
              featureKey: `${projectId}/${featureName}`
            });
          }
        } else {
          return res.status(409).json({
            error: 'A job is already running for this feature. Please wait for it to complete or stop it first.',
            existingJobId,
            isInterrupted: false,
            featureKey: `${projectId}/${featureName}`
          });
        }
      }
      
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const inputFile = overrideDirective ? undefined : path.join(featurePath, `inputs/directives/${jobType}/directive.md`);
      
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
        userContext
      };
      
      const enqueuedAt = new Date().toISOString();
      const result = await deps.executeJob(params);
      logger.info(`Job enqueued: ${projectId}/${featureName} jobId=${result.jobId}`, { component: 'JobRoute' });
      
      res.json(result);
    } catch (error: any) {
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
  
  // Get task status
  router.get('/jobs/:jobId/status', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const status = await getJobStatusAsync(jobId);
    
    if (!status) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    res.json(status);
  });
  
  // Get task logs (all at once)
  router.get('/jobs/:jobId/logs', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const logs = await getJobLogsAsync(jobId);
    res.json(logs);
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
  
  // Stop task
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, jobType } = req.body;
    
    logger.info(`Stop request: job=${jobId}`, { component: 'JobRoute' });
    logger.debug(`Stop: project=${projectId}, feature=${featureName}`, { component: 'JobRoute' });
    const userContext = extractUserContext(req);
    logger.debug(`Stop: user=${userContext.userId}`, { component: 'JobRoute' });
    
    // Mark as user-stopped in Redis
    await deps.stateStore.markUserStopped(jobId);
    logger.debug(`   ✅ Marked job ${jobId} as user-stopped (Redis)`);
    
    // Publish stop signal to Job Workers via Redis Pub/Sub
    await deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, { 
      jobId, 
      projectId, 
      featureName,
      timestamp: new Date().toISOString() 
    });
    logger.debug(`   ✅ Published stop signal to ${REDIS_CHANNELS.JOB_WORKER.STOP} channel`);
    
    // Update job status in Redis
    await deps.stateStore.updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Task stopped by user'
    });
    
    // Clean up task state
    const interruption: InterruptionDetails = {
      reason: 'user_stopped',
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        stoppedBy: 'user_action'
      }
    };
    
    logger.debug(`   Calling cleanupJobState with jobType: ${jobType || 'auto-detect'}...`);
    await deps.cleanupJobState(jobId, projectId, featureName, interruption, jobType, userContext);
    logger.debug(`   ✅ cleanupJobState completed`);
    
    res.json({ 
      success: true, 
      message: 'Task stopped successfully',
      jobId 
    });
    
    logger.debug(`   ✅ Stop request completed\n`);
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
      
      // ✅ Resolve old cancelled messages: user chose to continue, old choice cards are no longer actionable
      if (deps.chatService && sessionJobId) {
        const resolved = await deps.chatService.resolveCancelledMessages(projectId, featureName, sessionJobId, userContext);
        if (resolved > 0) {
          logger.debug(`   ✅ Resolved ${resolved} old cancelled message(s)`);
        }
      }
      
      // ✅ Resume always sets isResume=true. Graph router uses this + hasTaskQueue + hasDetectionReport
      // to determine correct entry point (plan, decompose, or triage)
      const hasTaskQueue = (sessionData.state?.taskQueue?.length || 0) > 0;
      
      let inputFile: string | undefined;
      
      if (!hasTaskQueue) {
        // No tasks: may need directive file for re-execution from triage
        const directivePath = path.join(featurePath, `inputs/directives/${jobType}/directive.md`);
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
      // Three lock layers: BullMQJobQueue completed, RouteConfigurator
      // completed, and RouteConfigurator failed — all TTL 120s.
      await deps.stateStore.releaseLock(`ant:job-completed:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:completed`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:failed`);
      logger.debug(`   ✅ Cleared completion/failure idempotency locks for ${sessionJobId}`);
      
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
      
      // ✅ Resolve old cancelled messages: user chose to continue, old choice cards are no longer actionable
      const sessionJobId = sessionData.state?.jobId || jobId;
      if (deps.chatService) {
        const resolved = await deps.chatService.resolveCancelledMessages(projectId, featureName, sessionJobId, userContext);
        if (resolved > 0) {
          logger.debug(`   ✅ Resolved ${resolved} old cancelled message(s)`);
        }
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

  // Dismiss an interrupted/cancelled job — clears the server-side state
  // so the user can acknowledge the interruption and start a new job.
  // For 'paused' jobs: transitions to 'failed'. For already-terminal jobs: no-op (just ack).
  router.post('/projects/:id/features/:feature/job/dismiss', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId } = req.body;

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'jobId is required' });
    }

    try {
      const jobStatus = await deps.stateStore.getJobStatus(jobId);

      // If job doesn't exist or is actively running/queued, reject
      if (!jobStatus) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const terminalStatuses = ['failed', 'completed', 'cancelled', 'stopped'];
      if (jobStatus.status === 'paused') {
        // Paused (interrupted) → transition to failed
        await deps.stateStore.updateJobStatus(jobId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: 'Dismissed by user',
        });
      } else if (terminalStatuses.includes(jobStatus.status)) {
        // Already terminal — no state transition needed, just acknowledge
        logger.debug(`Job already in terminal state (${jobStatus.status}), dismiss is a no-op`, { component: 'JobRoute' });
      } else {
        // Running or queued — cannot dismiss
        return res.status(400).json({ error: `Cannot dismiss job in '${jobStatus.status}' state` });
      }

      logger.info(`Job dismissed: ${projectId}/${featureName} jobId=${jobId} (was: ${jobStatus.status})`, { component: 'JobRoute' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobDismiss');
    }
  });

  return router;
}
