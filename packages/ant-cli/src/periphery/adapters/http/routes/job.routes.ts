import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteJobParams, LogEntry } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';
import type { StateStorePort, JobStatusData, JobProjectMapping } from '../../../../core/ports/stateStore';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { REDIS_CHANNELS } from '../../../../infrastructure/state/redisConstants';
import { extractUserContext } from './helpers/userContext';

/**
 * Job execution routes
 * 
 * Cloud-safe: Uses Redis StateStore for cross-pod job state management
 */
export function createJobRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  getJobStatus: (jobId: string) => any;  // Legacy, will delegate to StateStore
  getLogs: (jobId: string) => LogEntry[];  // Legacy, will delegate to StateStore
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: 'design' | 'code' | 'learn', userContext?: { userId: string; organizationId: string; workspacePath: string }) => Promise<void>;
  workflowStateService: import('../services/WorkflowStateService').WorkflowStateService;
  chatService: import('../services/ChatService').ChatService;
  config?: { mode: 'local' | 'cloud' };
  stateStore?: StateStorePort;
}): Router {
  const router = Router();
  
  /**
   * Helper: Get job status from StateStore (Cloud) or legacy (Local)
   */
  async function getJobStatusAsync(jobId: string): Promise<JobStatusData | null> {
    if (deps.stateStore) {
      return deps.stateStore.getJobStatus(jobId);
    }
    // Legacy fallback (local mode)
    const status = deps.getJobStatus(jobId);
    return status || null;
  }
  
  /**
   * Helper: Get job logs from StateStore (Cloud) or legacy (Local)
   */
  async function getJobLogsAsync(jobId: string): Promise<LogEntry[]> {
    if (deps.stateStore) {
      return deps.stateStore.getJobLogs(jobId);
    }
    // Legacy fallback (local mode)
    return deps.getLogs(jobId);
  }
  
  /**
   * Helper: Check if feature already has a running job
   */
  async function checkDuplicateJob(projectId: string, featureName: string): Promise<string | undefined> {
    if (deps.stateStore) {
      const jobs = await deps.stateStore.listJobsByFeature(projectId, featureName);
      const running = jobs.find(j => j.status === 'running');
      return running?.jobId;
    }
    return undefined;
  }
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    const requestReceivedAt = new Date().toISOString();
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource } = req.body;
      
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
  
  // Deprecated: Logs SSE endpoint (replaced by unified SSE)
  router.get('/jobs/:jobId/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'This endpoint has been deprecated. Use unified SSE instead.' 
    });
  });

  // Stop task
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, jobType } = req.body;
    
    console.log(`\n🛑 [StopRoute] Stop request received for job: ${jobId}`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}, JobType: ${jobType || 'not provided'}`);
    console.log(`   Mode: ${deps.config?.mode || 'local'}`);
    
    const userContext = extractUserContext(req);
    console.log(`   UserContext: ${userContext.userId}@${userContext.organizationId}`);
    
    // Mark as user-stopped in Redis (for all modes)
    if (deps.stateStore) {
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
    }
    
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
      
      const sessionDir = path.join(featurePath, 'sessions');
      
      let jobType: 'design' | 'code' | 'learn' | null = null;
      let sessionData: any = null;
      
      for (const type of ['design', 'code', 'learn'] as const) {
        const sessionPath = path.join(sessionDir, `${type}.json`);
        if (fs.existsSync(sessionPath)) {
          const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
          if (data.state?.jobId && data.state?.interruption) {
            jobType = type;
            sessionJobId = data.state.jobId;
            sessionData = data;
            console.log(`   Found interrupted job in ${type}.json`);
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
      
      const inputFile = undefined;
      
      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation: false,
        chatSource,
        userContext,
        jobId: sessionJobId
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
      const userContext = req.user && req.organization ? {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''
      } : { userId: 'local', organizationId: 'local', workspacePath: '' };
      
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const sessionDir = path.join(featurePath, 'sessions');
      
      let jobType: 'design' | 'code' | 'learn' | null = null;
      let sessionPath: string | null = null;
      
      for (const type of ['design', 'code', 'learn'] as const) {
        const candidatePath = path.join(sessionDir, `${type}.json`);
        if (fs.existsSync(candidatePath)) {
          const sessionData = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
          if (sessionData.state?.jobId === jobId) {
            jobType = type;
            sessionPath = candidatePath;
            console.log(`   Found job in ${type}.json`);
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
      
      const inputFile = undefined;
      
      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation: false,
        overrideDirective: undefined,
        chatSource,
        userContext
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
  
  return router;
}
