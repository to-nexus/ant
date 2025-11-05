import { Router, Request, Response } from 'express';
import * as path from 'path';
import { ExecuteTaskParams, LogEntry } from '../../../../core/ports/http';

/**
 * Task execution routes
 * Handles task execution, status, logs, and control endpoints
 */
export function createTaskRoutes(deps: {
  workspaceRoot: string;
  executeTask: (params: ExecuteTaskParams) => Promise<any>;
  getTaskStatus: (taskId: string) => any;
  getLogs: (taskId: string) => LogEntry[];
  logStreams: Map<string, Set<(log: LogEntry) => void>>;
  sseResponses: Map<string, Set<Response>>;
  logs: Map<string, LogEntry[]>;
  childProcesses: Map<string, any>;
  tasks: Map<string, any>;
  cleanupTaskState: (taskId: string, projectId?: string, featureName?: string) => Promise<void>;  // ✅ Add cleanup method
}): Router {
  const router = Router();
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { task, agent = 'architect', enableEvaluation } = req.body;
      
      const params: ExecuteTaskParams = {
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
      
      const result = await deps.executeTask(params);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Execute task (legacy endpoint for backward compatibility - uses skeleton)
  router.post('/projects/:id/execute', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { task, agent = 'architect', enableEvaluation } = req.body;
      
      const params: ExecuteTaskParams = {
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
      
      const result = await deps.executeTask(params);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get task status
  router.get('/tasks/:taskId/status', (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const status = deps.getTaskStatus(taskId);
    
    if (!status) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    
    res.json(status);
  });
  
  // Get task logs (all at once)
  router.get('/tasks/:taskId/logs', (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const logs = deps.getLogs(taskId);
    res.json(logs);
  });
  
  // Stream logs (SSE)
  router.get('/tasks/:taskId/stream', (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send existing logs
    const existingLogs = deps.logs.get(taskId) || [];
    existingLogs.forEach(log => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
    
    // Subscribe to new logs
    const listener = (log: LogEntry) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };
    
    if (!deps.logStreams.has(taskId)) {
      deps.logStreams.set(taskId, new Set());
    }
    deps.logStreams.get(taskId)!.add(listener);
    
    // Store SSE response for later closing
    if (!deps.sseResponses.has(taskId)) {
      deps.sseResponses.set(taskId, new Set());
    }
    deps.sseResponses.get(taskId)!.add(res);
    
    // Clean up on disconnect
    req.on('close', () => {
      deps.logStreams.get(taskId)?.delete(listener);
      deps.sseResponses.get(taskId)?.delete(res);
      res.end();
    });
  });

  // Stop task
  router.post('/tasks/:taskId/stop', async (req: Request, res: Response) => {
    const taskId = req.params.taskId;
    const { projectId, featureName } = req.body;  // ✅ Accept project info from frontend
    const childProcess = deps.childProcesses.get(taskId);
    
    console.log(`[Server] Stop request for task ${taskId}, project: ${projectId}/${featureName}, has childProcess: ${!!childProcess}`);
    
    // Kill the process if it exists
    if (childProcess) {
      console.log(`[Server] Stopping task ${taskId}, PID: ${childProcess.pid}`);
      childProcess.kill('SIGTERM');
      
      // Update task status
      const status = deps.tasks.get(taskId);
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
        deps.logs.get(taskId)?.push(logEntry);
        deps.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
      }
      
      // Clean up child process
      deps.childProcesses.delete(taskId);
    }
    
    // ✅ ALWAYS clean up task state (live snapshots, return in-progress to queue)
    // This is important even if childProcess doesn't exist (e.g., after page refresh)
    await deps.cleanupTaskState(taskId, projectId, featureName);
    
    res.json({ success: true, message: 'Task stopped' });
  });
  
  return router;
}

