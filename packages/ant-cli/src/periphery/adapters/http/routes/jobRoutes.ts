import { Router, Request, Response } from 'express';
import * as path from 'path';
import { ExecuteJobParams, LogEntry } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';

/**
 * Job execution routes
 * Handles agent job execution, status, logs, and control endpoints
 */
export function createJobRoutes(deps: {
  // workspaceRoot: string;  // ❌ 제거 - 사용하지 않음
  workspaceResolver: WorkspaceResolver;  // ✅ WorkspaceResolver 사용
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  getJobStatus: (jobId: string) => any;
  getLogs: (jobId: string) => LogEntry[];
  logStreams: Map<string, Set<(log: LogEntry) => void>>;
  sseResponses: Map<string, Set<Response>>;
  logs: Map<string, LogEntry[]>;
  childProcesses: Map<string, any>;
  jobs: Map<string, any>;
  jobToProject: Map<string, { projectId: string; featureName: string; jobType: 'design' | 'code' | 'learn'; userContext?: any }>;  // ✅ For checking duplicate jobs
  userStoppedJobs: Set<string>;  // ✅ Track user-stopped jobs
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: 'design' | 'code' | 'learn') => Promise<void>;
  workflowStateService: import('../services/WorkflowStateService').WorkflowStateService;  // ✅ For node tracking
  chatService: import('../services/ChatService').ChatService;  // ✅ For adding cancelled messages
}): Router {
  const router = Router();
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource } = req.body;
      
      console.log(`\n📨 [JobRoute] POST /projects/${projectId}/features/${featureName}/execute`);
      console.log(`   Agent: ${agent}, jobType: ${jobType}`);
      
      // ✅ Check if this feature already has a running job
      const featureKey = `${projectId}/${featureName}`;
      let existingJobId: string | undefined;
      
      for (const [jobId, mapping] of Array.from(deps.jobToProject?.entries() || [])) {
        if (mapping.projectId === projectId && mapping.featureName === featureName) {
          const jobStatus = deps.jobs?.get(jobId);
          if (jobStatus && jobStatus.status === 'running') {
            existingJobId = jobId;
            break;
          }
        }
      }
      
      if (existingJobId) {
        console.log(`   ⚠️  Job already running for feature ${featureKey}: ${existingJobId}`);
        return res.status(409).json({ 
          error: `A job is already running for this feature. Please wait for it to complete or stop it first.`,
          existingJobId,
          featureKey
        });
      }
      
      console.log(`   ✅ No running job found for feature ${featureKey}, proceeding...`);
      
      // ✅ Build context for WorkspaceResolver
      const userContext = req.user && req.organization ? {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''  // Not used by WorkspaceResolver
      } : { userId: 'local', organizationId: 'local', workspacePath: '' };
      
      // ✅ Use WorkspaceResolver to get proper path
      // ✅ Only set inputFile if NOT using override directive (file-based job)
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const inputFile = overrideDirective ? undefined : path.join(featurePath, `inputs/directives/${jobType}/directive.md`);
      
      const params: ExecuteJobParams = {
        agent: agent || 'architect',
        jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation,
        overrideDirective,  // ✅ Chat input as directive
        chatSource,         // ✅ Flag for Chat SSE
        userContext         // ✅ Pass user context
      };
      
      console.log(`   📦 Calling deps.executeJob with params:`, params);
      const result = await deps.executeJob(params);
      console.log(`   ✅ Result:`, result);
      res.json(result);
    } catch (error: any) {
      console.error(`   ❌ Error:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get task status
  router.get('/jobs/:jobId/status', (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const status = deps.getJobStatus(jobId);
    
    if (!status) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    res.json(status);
  });
  
  // Get task logs (all at once)
  router.get('/jobs/:jobId/logs', (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const logs = deps.getLogs(jobId);
    res.json(logs);
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
    
    const childProcess = deps.childProcesses.get(jobId);
    
    // ✅ CRITICAL: Mark as user-stopped BEFORE killing to prevent exit handler cleanup
    deps.userStoppedJobs.add(jobId);
    console.log(`   ✅ Marked job ${jobId} as user-stopped`);
    
    // ✅ CRITICAL: Kill process FIRST, then cleanup, then respond
    if (childProcess && childProcess.pid) {
      try {
        const pid = childProcess.pid;
        console.log(`   Process PID: ${pid}, killing...`);
        
        // Try graceful kill first
        childProcess.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Forcefully kill if still alive
        try {
          process.kill(pid, 0);  // Check if still alive
          console.log(`   Process still alive, sending SIGKILL...`);
          process.kill(pid, 'SIGKILL');
        } catch (checkErr: any) {
          console.log(`   Process already terminated`);
        }
        
        deps.childProcesses.delete(jobId);
        
      } catch (error: any) {
        console.error(`   ❌ Error killing process:`, error.message);
        deps.childProcesses.delete(jobId);
      }
      
      // Update task status
      const status = deps.jobs.get(jobId);
      if (status && status.status === 'running') {
        status.status = 'failed';
        status.completedAt = new Date().toISOString();
        status.error = 'Task stopped by user';
        
        const logEntry: LogEntry = {
          type: 'stderr',
          message: '\n🛑 Task stopped by user',
          timestamp: new Date().toISOString()
        };
        deps.logs.get(jobId)?.push(logEntry);
        deps.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
      }
    } else {
      console.log(`   ⚠️  No running process found for ${jobId}`);
    }
    
    // ✅ Clean up task state (move task back to queue, save to session)
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
    await deps.cleanupJobState(jobId, projectId, featureName, interruption, jobType);
    console.log(`   ✅ cleanupJobState completed (cleanupJobState handles adding cancelled message)`);
    
    // ✅ cleanupJobState already calls addCancelledMessage, so no need to call it again here
    
    // ✅ Send response AFTER everything is done
    res.json({ 
      success: true, 
      message: 'Task stopped successfully',
      jobId 
    });
    
    console.log(`   ✅ Stop request completed\n`);
  });
  
  // Resume existing job
  router.post('/jobs/:jobId/resume', async (req: Request, res: Response) => {
    const requestedJobId = req.params.jobId;  // ✅ This is just for API compatibility (may be new)
    const { projectId, featureName, chatSource = true } = req.body;  // ✅ Default to true for UI consistency
    
    console.log(`\n🔄 [ResumeRoute] Resume request received`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}`);
    console.log(`   Requested jobId: ${requestedJobId} (will use session's jobId if found)`);
    
    let sessionJobId: string | null = null;  // ✅ Declare outside try-catch for error handling
    
    try {
      // ✅ Build context for WorkspaceResolver
      const userContext = req.user && req.organization ? {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''  // Not used by WorkspaceResolver
      } : { userId: 'local', organizationId: 'local', workspacePath: '' };
      
      // ✅ Use WorkspaceResolver to get proper path
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      
      // ✅ Find job type and jobId from session files (don't rely on requested jobId)
      const fs = require('fs');
      const sessionDir = path.join(featurePath, 'sessions');
      
      let jobType: 'design' | 'code' | 'learn' | null = null;
      
      // ✅ CRITICAL: Look for interrupted jobs in session files
      let sessionData: any = null;
      for (const type of ['design', 'code', 'learn'] as const) {
        const sessionPath = path.join(sessionDir, `${type}.json`);
        if (fs.existsSync(sessionPath)) {
          const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
          // ✅ Check for interrupted job (has jobId and interruption)
          if (data.state?.jobId && data.state?.interruption) {
            jobType = type;
            sessionJobId = data.state.jobId;
            sessionData = data;  // ✅ Save session data for later use
            console.log(`   ✅ Found interrupted job in ${type}.json`);
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
      
      // ✅ Restore overrideDirective from session (for chat-initiated jobs)
      const overrideDirective = sessionData.state?.overrideDirective;
      
      // ✅ inputFile not needed for resume (feature name is sufficient)
      const inputFile = undefined;
      
      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation: false,
        overrideDirective,  // ✅ Restore from session
        chatSource,
        userContext,
        jobId: sessionJobId  // ✅ Use existing jobId for resume
      };
      
      const result = await deps.executeJob(params);
      
      console.log(`   ✅ Resume job continued with existing jobId: ${sessionJobId}`);
      console.log(`   ✅ Resume request completed\n`);
      
      res.json({
        success: true,
        jobId: sessionJobId,  // ✅ Return the existing jobId
        jobType,
        message: `Job ${sessionJobId} resumed`
      });
    } catch (error: any) {
      console.error(`   ❌ Resume failed:`, error);
      res.status(500).json({ 
        error: error.message,
        jobId: sessionJobId || requestedJobId  // ✅ Return session jobId if found, else requested jobId
      });
    }
  });
  
  // ✅ Continue existing job with additional directive (highest priority)
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
      // ✅ Build context for WorkspaceResolver
      const userContext = req.user && req.organization ? {
        userId: req.user.id,
        organizationId: req.organization.id,
        workspacePath: ''
      } : { userId: 'local', organizationId: 'local', workspacePath: '' };
      
      // ✅ Use WorkspaceResolver to get proper path
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      
      // ✅ Find job type from session files
      const fs = require('fs');
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
            console.log(`   ✅ Found job in ${type}.json`);
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
      
      // ✅ Load session data
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      
      // ✅ Add new directive to the FRONT of the array (highest priority)
      if (!sessionData.state.directives) {
        sessionData.state.directives = [];
      }
      
      // ✅ Prepend new directive (newest first = highest priority)
      sessionData.state.directives.unshift(newDirective);
      
      console.log(`   ✅ Added new directive (total: ${sessionData.state.directives.length})`);
      console.log(`   ✅ Directive priorities: [newest → oldest]`);
      
      // ✅ Save updated session
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      console.log(`   ✅ Session updated with new directive`);
      
      console.log(`   Job type: ${jobType}`);
      console.log(`   Starting continue job execution...`);
      
      // ✅ inputFile not needed for continue (feature name is sufficient)
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

