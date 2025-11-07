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
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails) => Promise<void>;
}): Router {
  const router = Router();
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task, agent = 'architect', enableEvaluation } = req.body;
      
      console.log(`\n📨 [JobRoute] POST /projects/${projectId}/features/${featureName}/execute`);
      console.log(`   Agent: ${agent}, Task: ${task}`);
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
        enableEvaluation
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
      const { task, agent = 'architect', enableEvaluation } = req.body;
      
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
        enableEvaluation
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
  
  // Stream logs (SSE)
  router.get('/jobs/:jobId/stream', (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send existing logs
    const existingLogs = deps.logs.get(jobId) || [];
    existingLogs.forEach(log => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
    
    // Subscribe to new logs
    const listener = (log: LogEntry) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };
    
    if (!deps.logStreams.has(jobId)) {
      deps.logStreams.set(jobId, new Set());
    }
    deps.logStreams.get(jobId)!.add(listener);
    
    // Store SSE response for later closing
    if (!deps.sseResponses.has(jobId)) {
      deps.sseResponses.set(jobId, new Set());
    }
    deps.sseResponses.get(jobId)!.add(res);
    
    // Clean up on disconnect
    req.on('close', () => {
      deps.logStreams.get(jobId)?.delete(listener);
      deps.sseResponses.get(jobId)?.delete(res);
      res.end();
    });
  });

  // Stop task
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName } = req.body;  // ✅ Accept project info from frontend
    const childProcess = deps.childProcesses.get(jobId);
    
    console.log(`\n🛑 [JobRoute] Stopping job ${jobId}`);
    console.log(`   childProcesses size:`, deps.childProcesses.size);
    console.log(`   childProcess found:`, !!childProcess);
    console.log(`   childProcess PID:`, childProcess?.pid);
    
    // Kill the process if it exists
    if (childProcess && childProcess.pid) {
      try {
        const pid = childProcess.pid;
        console.log(`   Killing process ${pid}...`);
        
        // ✅ Try graceful kill first
        childProcess.kill('SIGTERM');
        console.log(`   ✅ SIGTERM sent to process ${pid}`);
        
        // ✅ Forcefully kill immediately (don't wait - tsx processes often ignore SIGTERM)
        setTimeout(() => {
          try {
            // Check if still alive
            process.kill(pid, 0);  // Signal 0 checks if process exists
            console.log(`   ⚠️ Process still alive, sending SIGKILL to ${pid}...`);
            process.kill(pid, 'SIGKILL');
            console.log(`   ✅ SIGKILL sent to process ${pid}`);
          } catch (checkErr: any) {
            if (checkErr.code === 'ESRCH') {
              console.log(`   ℹ️  Process ${pid} already dead`);
            } else {
              console.log(`   ℹ️  Process check error:`, checkErr.message);
            }
          }
          deps.childProcesses.delete(jobId);
        }, 500);  // ✅ Only wait 500ms before SIGKILL
        
      } catch (error: any) {
        console.error(`   ❌ Error killing process:`, error.message);
        // Process might already be dead, continue with cleanup
        deps.childProcesses.delete(jobId);
      }
      
      // Update task status
      const status = deps.jobs.get(jobId);
      if (status && status.status === 'running') {
        status.status = 'failed';
        status.completedAt = new Date().toISOString();
        status.error = 'Task stopped by user';
        
        // Add log entry
        const logEntry: LogEntry = {
          type: 'stderr',
          message: '\n🛑 Task stopped by user',
          timestamp: new Date().toISOString()
        };
        deps.logs.get(jobId)?.push(logEntry);
        deps.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
      }
      
      // Don't delete here - let the timeout handler do it
      console.log(`   ℹ️  Waiting for process to exit...`);
    } else {
      console.log(`   ⚠️ No child process found for job ${jobId}`);
      console.log(`   Available job IDs:`, Array.from(deps.childProcesses.keys()));
    }
    
    // ✅ ALWAYS clean up task state (live snapshots, return in-progress to queue)
    // This is important even if childProcess doesn't exist (e.g., after page refresh)
    console.log(`   🧹 Cleaning up job state...`);
    
    // ✅ Create interruption details for user stop
    const interruption: InterruptionDetails = {
      reason: 'user_stopped',
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: {
        stoppedBy: 'user_action'
      }
    };
    
    await deps.cleanupJobState(jobId, projectId, featureName, interruption);
    console.log(`   ✅ Job state cleaned up\n`);
    
    res.json({ success: true, message: 'Task stopped' });
  });
  
  return router;
}

