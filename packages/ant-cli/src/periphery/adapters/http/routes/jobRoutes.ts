import { Router, Request, Response } from 'express';
import * as path from 'path';
import { ExecuteJobParams, LogEntry } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';

/**
 * Job execution routes
 * Handles agent job execution, status, logs, and control endpoints
 */
export function createJobRoutes(deps: {
  workspaceRoot: string;
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  getJobStatus: (jobId: string) => any;
  getLogs: (jobId: string) => LogEntry[];
  logStreams: Map<string, Set<(log: LogEntry) => void>>;
  sseResponses: Map<string, Set<Response>>;
  logs: Map<string, LogEntry[]>;
  childProcesses: Map<string, any>;
  jobs: Map<string, any>;
  userStoppedJobs: Set<string>;  // ✅ Track user-stopped jobs
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: 'design' | 'code' | 'learn') => Promise<void>;
  workflowStateService: import('../services/WorkflowStateService').WorkflowStateService;  // ✅ For node tracking
}): Router {
  const router = Router();
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task, agent = 'architect', enableEvaluation, overrideDirective, chatSource } = req.body;
      
      console.log(`\n📨 [JobRoute] POST /projects/${projectId}/features/${featureName}/execute`);
      console.log(`   Agent: ${agent}, Task: ${task}`);
      console.log(`   Override Directive: ${overrideDirective ? '(provided)' : 'none'}`);
      console.log(`   Chat Source: ${chatSource || false}`);
      console.log(`   Body:`, req.body);
      
      const params: ExecuteJobParams = {
        agent: agent || 'architect',
        task,
        project: projectId,
        feature: featureName,
        inputFile: path.join(
          deps.workspaceRoot,
          projectId,
          featureName,
          `inputs/directives/${task}/directive.md`
        ),
        enableEvaluation,
        overrideDirective,  // ✅ Chat input as directive
        chatSource          // ✅ Flag for Chat SSE
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
  
  // Execute task (legacy endpoint for backward compatibility - uses skeleton)
  router.post('/projects/:id/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { task, agent = 'architect', enableEvaluation, overrideDirective, chatSource } = req.body;
      
      const params: ExecuteJobParams = {
        agent: agent || 'architect',
        task,
        project: projectId,
        feature: 'skeleton',
        inputFile: path.join(
          deps.workspaceRoot,
          projectId,
          `skeleton/inputs/directives/${task}/directive.md`
        ),
        enableEvaluation,
        overrideDirective,  // ✅ Chat input as directive
        chatSource          // ✅ Flag for Chat SSE
      };
      
      const result = await deps.executeJob(params);
      res.json(result);
    } catch (error: any) {
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
    console.log(`   ✅ cleanupJobState completed`);
    
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
    const jobId = req.params.jobId;
    const { projectId, featureName } = req.body;
    
    console.log(`\n🔄 [ResumeRoute] Resume request received for job: ${jobId}`);
    console.log(`   Project: ${projectId}, Feature: ${featureName}`);
    
    try {
      // ✅ Find job type from session files
      const fs = require('fs');
      const sessionDir = path.join(deps.workspaceRoot, projectId, featureName, 'sessions');
      
      let jobType: 'design' | 'code' | 'learn' | null = null;
      
      for (const type of ['design', 'code', 'learn'] as const) {
        const sessionPath = path.join(sessionDir, `${type}.json`);
        if (fs.existsSync(sessionPath)) {
          const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
          if (sessionData.state?.jobId === jobId) {
            jobType = type;
            console.log(`   ✅ Found job in ${type}.json`);
            break;
          }
        }
      }
      
      if (!jobType) {
        console.log(`   ❌ Job ${jobId} not found in any session file`);
        return res.status(404).json({ 
          error: 'Job not found',
          message: `Job ${jobId} not found in session files`
        });
      }
      
      console.log(`   Job type: ${jobType}`);
      console.log(`   Starting resume job execution...`);
      
      // ✅ Execute job with correct type (will resume from session)
      const params: ExecuteJobParams = {
        agent: 'architect',
        task: jobType,
        project: projectId,
        feature: featureName,
        inputFile: path.join(
          deps.workspaceRoot,
          projectId,
          featureName,
          `inputs/directives/${jobType}/directive.md`
        ),
        enableEvaluation: false,
        overrideDirective: undefined,
        chatSource: false
      };
      
      const result = await deps.executeJob(params);
      
      console.log(`   ✅ Resume job started: ${result.jobId}`);
      console.log(`   ✅ Resume request completed\n`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        originalJobId: jobId,
        jobType,
        message: `Job resumed from ${jobId}`
      });
    } catch (error: any) {
      console.error(`   ❌ Resume failed:`, error);
      res.status(500).json({ 
        error: error.message,
        jobId
      });
    }
  });
  
  return router;
}

