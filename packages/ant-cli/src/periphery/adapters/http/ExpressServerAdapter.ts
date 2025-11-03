import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { 
  HttpServerPort, 
  TaskExecutionPort, 
  ExecuteTaskParams, 
  TaskResult, 
  TaskStatus, 
  LogEntry 
} from '../../../core/ports/http';
import { orchestrator } from '../../../composition/orchestrator';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer
 * Implements HttpServerPort and TaskExecutionPort using Express framework.
 * 
 * This adapter wraps the existing orchestrator without modifying it,
 * maintaining separation between HTTP layer and core business logic.
 */
export class ExpressServerAdapter implements HttpServerPort, TaskExecutionPort {
  private app: Express;
  private server: any;
  private running: boolean = false;
  
  // Task tracking
  private tasks: Map<string, TaskStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, _res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }
  
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    // List projects
    this.app.get('/api/projects', async (_req: Request, res: Response) => {
      try {
        const workspaceRoot = path.join(process.cwd(), 'workspace');
        const projects = await fs.promises.readdir(workspaceRoot);
        
        // Filter out hidden files and get only directories
        const projectDirs = await Promise.all(
          projects
            .filter(p => !p.startsWith('.'))
            .map(async (p) => {
              const stat = await fs.promises.stat(path.join(workspaceRoot, p));
              return stat.isDirectory() ? p : null;
            })
        );
        
        res.json(projectDirs.filter(Boolean));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get session for a project
    this.app.get('/api/projects/:id/session', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const sessionPath = path.join(
          process.cwd(),
          'workspace',
          projectId,
          'skeleton/outputs/session.json'
        );
        
        // Check if session file exists
        const exists = await fs.promises.access(sessionPath)
          .then(() => true)
          .catch(() => false);
        
        if (!exists) {
          res.json(null);
          return;
        }
        
        const sessionData = await fs.promises.readFile(sessionPath, 'utf-8');
        res.json(JSON.parse(sessionData));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Execute task
    this.app.post('/api/projects/:id/execute', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const { task, agent = 'architect', mode, enableEvaluation } = req.body;
        
        const params: ExecuteTaskParams = {
          agent: agent || 'architect',
          task,
          project: projectId,
          inputFile: path.join(
            process.cwd(),
            'workspace',
            projectId,
            'skeleton/inputs/directives/code/directive.md'
          ),
          mode,
          enableEvaluation
        };
        
        const result = await this.executeTask(params);
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get task status
    this.app.get('/api/tasks/:taskId/status', (req: Request, res: Response) => {
      const taskId = req.params.taskId;
      const status = this.getTaskStatus(taskId);
      
      if (!status) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      
      res.json(status);
    });
    
    // Get task logs (all at once)
    this.app.get('/api/tasks/:taskId/logs', (req: Request, res: Response) => {
      const taskId = req.params.taskId;
      const logs = this.getLogs(taskId);
      res.json(logs);
    });
    
    // Stream logs (SSE)
    this.app.get('/api/tasks/:taskId/stream', (req: Request, res: Response) => {
      const taskId = req.params.taskId;
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Send existing logs
      const existingLogs = this.logs.get(taskId) || [];
      existingLogs.forEach(log => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      
      // Subscribe to new logs
      const listener = (log: LogEntry) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      };
      
      if (!this.logStreams.has(taskId)) {
        this.logStreams.set(taskId, new Set());
      }
      this.logStreams.get(taskId)!.add(listener);
      
      // Clean up on disconnect
      req.on('close', () => {
        this.logStreams.get(taskId)?.delete(listener);
        res.end();
      });
    });
  }
  
  // TaskExecutionPort implementation
  async executeTask(params: ExecuteTaskParams): Promise<TaskResult> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize task tracking
    this.tasks.set(taskId, {
      taskId,
      status: 'pending',
      startedAt: new Date().toISOString()
    });
    this.logs.set(taskId, []);
    
    // Start task execution (non-blocking)
    this.runTask(taskId, params).catch(error => {
      console.error(`Task ${taskId} failed:`, error);
    });
    
    return {
      taskId,
      success: true,
      message: 'Task started'
    };
  }
  
  private async runTask(taskId: string, params: ExecuteTaskParams): Promise<void> {
    // Update status to running
    const status = this.tasks.get(taskId)!;
    status.status = 'running';
    
    // Hook console.log to capture logs
    const originalLog = console.log;
    const originalError = console.error;
    
    const captureLog = (type: 'stdout' | 'stderr', ...args: any[]) => {
      const message = args.join(' ');
      const logEntry: LogEntry = {
        type,
        message,
        timestamp: new Date().toISOString()
      };
      
      // Store log
      this.logs.get(taskId)!.push(logEntry);
      
      // Notify listeners
      this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
      
      // Also output to original console
      if (type === 'stderr') {
        originalError(...args);
      } else {
        originalLog(...args);
      }
    };
    
    console.log = (...args: any[]) => captureLog('stdout', ...args);
    console.error = (...args: any[]) => captureLog('stderr', ...args);
    
    try {
      // Read input file
      const input = await fs.promises.readFile(params.inputFile, 'utf-8');
      
      // Execute via orchestrator (existing business logic)
      await orchestrator({
        agent: params.agent,
        task: params.task,
        input,
        project: params.project,
        inputFile: params.inputFile,
        mode: params.mode,
        enableEvaluation: params.enableEvaluation
      });
      
      // Mark as completed
      status.status = 'completed';
      status.completedAt = new Date().toISOString();
      
      captureLog('stdout', '\n✅ Task completed successfully!');
    } catch (error: any) {
      // Mark as failed
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      
      captureLog('stderr', `\n❌ Task failed: ${error.message}`);
    } finally {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
    }
  }
  
  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId);
  }
  
  async *streamLogs(taskId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(taskId) || [];
    
    // Yield existing logs
    for (const log of logs) {
      yield log;
    }
    
    // For new logs, would need to implement a proper queue/event system
    // This is a simplified version
  }
  
  getLogs(taskId: string): LogEntry[] {
    return this.logs.get(taskId) || [];
  }
  
  // HttpServerPort implementation
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.running = true;
          console.log(`🚀 ANT Server running on http://localhost:${port}`);
          console.log(`📊 Health check: http://localhost:${port}/health`);
          console.log(`📁 API base: http://localhost:${port}/api`);
          resolve();
        });
        
        this.server.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${port} is already in use`);
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      
      this.server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          this.running = false;
          console.log('🛑 ANT Server stopped');
          resolve();
        }
      });
    });
  }
  
  isRunning(): boolean {
    return this.running;
  }
}
