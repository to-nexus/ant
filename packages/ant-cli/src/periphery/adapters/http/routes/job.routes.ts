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
import { getAllSessionPaths, getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';

/**
 * Job execution routes
 * 
 * Uses Redis StateStore for cross-pod job state management (always distributed).
 */
export function createJobRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: 'design' | 'code' | 'learn' | 'plan', userContext?: { userId: string; organizationId: string; workspacePath: string }) => Promise<void>;
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
   * Check if feature already has a running job
   */
  async function checkDuplicateJob(projectId: string, featureName: string): Promise<string | undefined> {
    const jobs = await deps.stateStore.listJobsByFeature(projectId, featureName);
    const running = jobs.find(j => j.status === 'running');
    return running?.jobId;
  }
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    const requestReceivedAt = new Date().toISOString();
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource, skipTriage } = req.body;
      
      // Check if this feature already has a running job
      const existingJobId = await checkDuplicateJob(projectId, featureName);
      
      if (existingJobId) {
        return res.status(409).json({ 
          error: `A job is already running for this feature. Please wait for it to complete or stop it first.`,
          existingJobId,
          featureKey: `${projectId}/${featureName}`
        });
      }
      
      const userContext = extractUserContext(req);
      
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const inputFile = overrideDirective ? undefined : path.join(featurePath, `inputs/directives/${jobType}/directive.md`);
      
      const params: ExecuteJobParams = {
        agent: agent || 'architect',
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
      console.log(`⏱️ [JobRoute] ${projectId}/${featureName} | jobId=${result.jobId} | requestAt=${requestReceivedAt} | enqueuedAt=${enqueuedAt}`);
      
      res.json(result);
    } catch (error: any) {
      console.error(`❌ [JobRoute] Error: ${error.message}`);
      res.status(500).json({ error: error.message });
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
  
  // Get queue position for a job
  router.get('/jobs/:jobId/queue-position', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    
    try {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const jobQueue = getInfrastructureFactory().getJobQueue();
      
      const position = await jobQueue.getQueuePosition(jobId);
      res.json(position);
    } catch (error: any) {
      console.error(`Error getting queue position for job ${jobId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Stop task
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, jobType } = req.body;
    
    console.log(`\n🛑 [StopRoute] Stop request received for job: ${jobId}`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}, JobType: ${jobType || 'not provided'}`);
    const userContext = extractUserContext(req);
    console.log(`   UserContext: ${userContext.userId}@${userContext.organizationId}`);
    
    // Mark as user-stopped in Redis
    await deps.stateStore.markUserStopped(jobId);
    console.log(`   ✅ Marked job ${jobId} as user-stopped (Redis)`);
    
    // Publish stop signal to Job Workers via Redis Pub/Sub
    await deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, { 
      jobId, 
      projectId, 
      featureName,
      timestamp: new Date().toISOString() 
    });
    console.log(`   ✅ Published stop signal to ${REDIS_CHANNELS.JOB_WORKER.STOP} channel`);
    
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
    
    console.log(`   Calling cleanupJobState with jobType: ${jobType || 'auto-detect'}...`);
    await deps.cleanupJobState(jobId, projectId, featureName, interruption, jobType, userContext);
    console.log(`   ✅ cleanupJobState completed`);
    
    res.json({ 
      success: true, 
      message: 'Task stopped successfully',
      jobId 
    });
    
    console.log(`   ✅ Stop request completed\n`);
  });
  
  // Resume existing job
  router.post('/jobs/:jobId/resume', async (req: Request, res: Response) => {
    const requestedJobId = req.params.jobId;
    const { projectId, featureName, chatSource = true } = req.body;
    
    console.log(`\n🔄 [ResumeRoute] Resume request received`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}`);
    console.log(`   Requested jobId: ${requestedJobId} (will use session's jobId if found)`);
    
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
            // ✅ Guard against stale interruption: if taskQueue is empty and tasks
            // were completed, the interruption is leftover from a recursion-limit
            // retry that ultimately succeeded. Skip it — there's nothing to resume.
            const taskQueueSize = data.state.taskQueue?.length || 0;
            const completedCount = data.state.completedTasks?.length || 0;
            if (taskQueueSize === 0 && completedCount > 0) {
              console.log(`   ⚠️ Skipping stale interruption in ${entry.agent}/${entry.job}.json (0 tasks remaining, ${completedCount} completed)`);
              continue;
            }
            
            jobType = entry.job;
            foundAgent = entry.agent;
            sessionJobId = data.state.jobId;
            sessionData = data;
            console.log(`   Found interrupted job in ${entry.agent}/${entry.job}.json`);
            console.log(`   Session jobId: ${sessionJobId}`);
            break;
          }
        }
      }
      
      if (!jobType || !sessionJobId || !sessionData) {
        console.log(`   ❌ No interrupted job found in session files`);
        return res.status(404).json({ 
          error: 'No interrupted job found',
          message: `No resumable job found for ${projectId}/${featureName}`
        });
      }
      
      console.log(`   Job type: ${jobType}`);
      console.log(`   Starting resume job execution...`);
      
      // ✅ Resolve old cancelled messages: user chose to continue, old choice cards are no longer actionable
      if (deps.chatService && sessionJobId) {
        const resolved = await deps.chatService.resolveCancelledMessages(projectId, featureName, sessionJobId, userContext);
        if (resolved > 0) {
          console.log(`   ✅ Resolved ${resolved} old cancelled message(s)`);
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
        console.log(`   No taskQueue, will re-run from appropriate entry point. directiveFile=${!!inputFile}`);
      } else {
        console.log(`   Plain resume: ${sessionData.state.taskQueue.length} tasks in queue`);
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
        isResume: true  // ✅ Always true for resume
      };
      
      const result = await deps.executeJob(params);
      
      console.log(`   ✅ Resume job continued with existing jobId: ${sessionJobId}`);
      console.log(`   ✅ Resume request completed\n`);
      
      res.json({
        success: true,
        jobId: sessionJobId,
        jobType,
        message: `Job ${sessionJobId} resumed`
      });
    } catch (error: any) {
      console.error(`   ❌ Resume failed:`, error);
      res.status(500).json({ 
        error: error.message,
        jobId: sessionJobId || requestedJobId
      });
    }
  });
  
  // Continue existing job with additional directive
  router.post('/jobs/:jobId/continue', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, newDirective, chatSource = true } = req.body;
    
    console.log(`\n➕ [ContinueRoute] Continue request received for job: ${jobId}`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}`);
    console.log(`   New directive: ${newDirective?.substring(0, 100)}...`);
    
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
            console.log(`   Found job in ${entry.agent}/${entry.job}.json`);
            break;
          }
        }
      }
      
      if (!jobType || !sessionPath) {
        console.log(`   ❌ Job ${jobId} not found in any session file`);
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
      
      console.log(`   ✅ Added new directive (total: ${sessionData.state.directives.length})`);
      
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      console.log(`   ✅ Session updated with new directive`);
      
      // ✅ Resolve old cancelled messages: user chose to continue, old choice cards are no longer actionable
      const sessionJobId = sessionData.state?.jobId || jobId;
      if (deps.chatService) {
        const resolved = await deps.chatService.resolveCancelledMessages(projectId, featureName, sessionJobId, userContext);
        if (resolved > 0) {
          console.log(`   ✅ Resolved ${resolved} old cancelled message(s)`);
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
      
      console.log(`   ✅ Continue job started: ${result.jobId}`);
      console.log(`   ✅ Continue request completed\n`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        originalJobId: jobId,
        jobType,
        directivesCount: sessionData.state.directives.length,
        message: `Job continued from ${jobId} with new directive`
      });
    } catch (error: any) {
      console.error(`   ❌ Continue failed:`, error);
      res.status(500).json({ 
        error: error.message,
        jobId
      });
    }
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inline Ask: Handle ask queries during interrupted jobs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  router.post('/projects/:id/features/:feature/inline-ask', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { message, chatSource = true } = req.body;
    
    console.log(`\n💬 [InlineAskRoute] Inline ask request received`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}`);
    console.log(`   Message: ${message?.substring(0, 100)}...`);
    
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
      
      console.log(`   ✅ Inline ask job started: ${result.jobId}`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        jobType: 'inline-ask',
        message: 'Inline ask job started'
      });
    } catch (error: any) {
      console.error(`   ❌ Inline ask failed:`, error);
      res.status(500).json({ 
        error: error.message 
      });
    }
  });

  return router;
}
