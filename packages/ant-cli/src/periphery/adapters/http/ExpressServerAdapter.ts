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
  
  // Workspace root path - relative to packages/ant-cli directory
  private readonly WORKSPACE_ROOT = path.join(process.cwd(), '../../workspace');
  
  // Task tracking
  private tasks: Map<string, TaskStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
  }
  
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    // List projects
    this.app.get('/api/projects', async (_req: Request, res: Response) => {
      try {
        const projects = await fs.promises.readdir(this.WORKSPACE_ROOT);
        
        // Filter out hidden files and get only directories
        const projectDirs = await Promise.all(
          projects
            .filter(p => !p.startsWith('.'))
            .map(async (p) => {
              const stat = await fs.promises.stat(path.join(this.WORKSPACE_ROOT, p));
              return stat.isDirectory() ? p : null;
            })
        );
        
        res.json(projectDirs.filter(Boolean));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Create a new project
    this.app.post('/api/projects', async (req: Request, res: Response) => {
      try {
        const { id } = req.body;
        
        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Project ID is required and must be a string' });
        }

        // Validate project ID (no special characters except hyphens and underscores)
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
          return res.status(400).json({ error: 'Project ID can only contain letters, numbers, hyphens, and underscores' });
        }
        
        const projectPath = path.join(this.WORKSPACE_ROOT, id);
        
        // Check if project already exists
        try {
          await fs.promises.access(projectPath);
          return res.status(409).json({ error: 'Project already exists' });
        } catch (error: any) {
          // Project doesn't exist, which is what we want
        }
        
        // Create project directory structure
        await fs.promises.mkdir(projectPath, { recursive: true });
        
        // Create basic project structure
        const configPath = path.join(projectPath, 'config.json');
        const defaultConfig = {
          name: id,
          createdAt: new Date().toISOString(),
          description: `Project ${id}`,
          features: []
        };
        
        await fs.promises.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
        
        res.json({ success: true, id });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete a project
    this.app.delete('/api/projects/:id', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const projectPath = path.join(this.WORKSPACE_ROOT, projectId);
        
        // Check if project exists
        try {
          await fs.promises.access(projectPath);
        } catch (error: any) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        // Delete project directory recursively
        await fs.promises.rm(projectPath, { recursive: true, force: true });
        
        res.json({ success: true, message: `Project ${projectId} deleted` });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get session for a project
    this.app.get('/api/projects/:id/session', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const sessionPath = path.join(
          this.WORKSPACE_ROOT,
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
    
    // Get features for a project
    this.app.get('/api/projects/:id/features', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const projectPath = path.join(this.WORKSPACE_ROOT, projectId);
        
        // Check if project exists
        const exists = await fs.promises.access(projectPath)
          .then(() => true)
          .catch(() => false);
        
        if (!exists) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }
        
        // List all directories in project (each is a feature)
        const entries = await fs.promises.readdir(projectPath, { withFileTypes: true });
        const features = entries
          .filter(entry => entry.isDirectory())
          .map(entry => ({
            name: entry.name,
            path: path.join(projectPath, entry.name)
          }));
        
        res.json(features);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Create a new feature
    this.app.post('/api/projects/:id/features', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const { featureName } = req.body;
        
        if (!featureName) {
          res.status(400).json({ error: 'featureName is required' });
          return;
        }
        
        const featurePath = path.join(this.WORKSPACE_ROOT, projectId, featureName);
        
        // Create feature directory structure
        await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/code'), { recursive: true });
        await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/design'), { recursive: true });
        await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/learn'), { recursive: true });
        await fs.promises.mkdir(path.join(featurePath, 'inputs/sources'), { recursive: true });
        await fs.promises.mkdir(path.join(featurePath, 'outputs/design'), { recursive: true });
        await fs.promises.mkdir(path.join(featurePath, 'outputs/reports'), { recursive: true });
        
        // Create empty directive.md files
        await fs.promises.writeFile(
          path.join(featurePath, 'inputs/directives/code/directive.md'),
          '# Code Directive\n\nDescribe what you want to build here.\n'
        );
        await fs.promises.writeFile(
          path.join(featurePath, 'inputs/directives/design/directive.md'),
          '# Design Directive\n\nDescribe the design requirements here.\n'
        );
        await fs.promises.writeFile(
          path.join(featurePath, 'inputs/directives/learn/directive.md'),
          '# Learn Directive\n\nDescribe what you want to learn here.\n'
        );
        
        // Create empty session.json
        const defaultSession = {
          id: `session-${Date.now()}`,
          featureName,
          createdAt: new Date().toISOString(),
          tasks: [],
          status: "created"
        };
        await fs.promises.writeFile(
          path.join(featurePath, 'outputs/session.json'),
          JSON.stringify(defaultSession, null, 2)
        );
        
        res.json({ success: true, featureName, path: featurePath });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Delete a feature
    this.app.delete('/api/projects/:id/features/:feature', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        
        const featurePath = path.join(this.WORKSPACE_ROOT, projectId, featureName);
        
        // Check if feature exists
        const exists = await fs.promises.access(featurePath)
          .then(() => true)
          .catch(() => false);
        
        if (!exists) {
          res.status(404).json({ error: 'Feature not found' });
          return;
        }
        
        // Delete feature directory recursively
        await fs.promises.rm(featurePath, { recursive: true, force: true });
        
        res.json({ success: true, message: `Feature ${featureName} deleted` });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get session for a specific feature
    this.app.get('/api/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        const sessionPath = path.join(
          this.WORKSPACE_ROOT,
          projectId,
          featureName,
          'outputs/session.json'
        );
        
        // Check if session file exists
        const exists = await fs.promises.access(sessionPath)
          .then(() => true)
          .catch(() => false);
        
        if (!exists) {
          res.json(null);
          return;
        }
        
        try {
          const sessionData = await fs.promises.readFile(sessionPath, 'utf-8');
          const parsedData = JSON.parse(sessionData);
          res.json(parsedData);
        } catch (parseError) {
          res.status(500).json({ error: 'Invalid JSON in session file' });
        }
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get file tree for a feature
    this.app.get('/api/projects/:id/features/:feature/files', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        const featurePath = path.join(this.WORKSPACE_ROOT, projectId, featureName);
        
        const buildFileTree = async (dirPath: string, relativePath: string = ''): Promise<any[]> => {
          const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          const nodes = await Promise.all(
            entries.map(async (entry) => {
              const fullPath = path.join(dirPath, entry.name);
              const relPath = path.join(relativePath, entry.name);
              
              if (entry.isDirectory()) {
                const children = await buildFileTree(fullPath, relPath);
                return {
                  name: entry.name,
                  path: relPath,
                  type: 'directory',
                  children
                };
              } else {
                return {
                  name: entry.name,
                  path: relPath,
                  type: 'file'
                };
              }
            })
          );
          return nodes;
        };
        
        const tree = await buildFileTree(featurePath);
        res.json(tree);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Get file content (using regex pattern for catch-all)
    this.app.get(/^\/api\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
      try {
        const projectId = req.params[0];
        const featureName = req.params[1];
        const filePath = req.params[2];
        
        if (!filePath) {
          res.status(400).json({ error: 'File path is required' });
          return;
        }
        
        const fullPath = path.join(
          this.WORKSPACE_ROOT,
          projectId,
          featureName,
          filePath
        );
        
        // Check if file exists
        const exists = await fs.promises.access(fullPath)
          .then(() => true)
          .catch(() => false);
        
        if (!exists) {
          res.status(404).json({ error: 'File not found' });
          return;
        }
        
        const stats = await fs.promises.stat(fullPath);
        if (stats.isDirectory()) {
          res.status(400).json({ error: 'Path is a directory, not a file' });
          return;
        }
        
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        res.json({ path: filePath, content });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Update file content (using regex pattern for catch-all)
    this.app.put(/^\/api\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
      try {
        const projectId = req.params[0];
        const featureName = req.params[1];
        const filePath = req.params[2];
        const { content } = req.body;
        
        if (!filePath) {
          res.status(400).json({ error: 'File path is required' });
          return;
        }
        
        if (content === undefined) {
          res.status(400).json({ error: 'content is required' });
          return;
        }
        
        const fullPath = path.join(
          this.WORKSPACE_ROOT,
          projectId,
          featureName,
          filePath
        );
        
        // Create directory if it doesn't exist
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        
        // Write file
        await fs.promises.writeFile(fullPath, content, 'utf-8');
        
        res.json({ success: true, path: filePath });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Upload files to a feature directory
    this.app.post('/api/projects/:id/features/:feature/upload', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        
        // For now, this is a placeholder. In a real implementation, you would:
        // 1. Use multer or similar middleware for file uploads
        // 2. Process the files from req.files
        // 3. Save them to the appropriate directory
        
        res.status(501).json({ 
          error: 'File upload not yet implemented. Use file creation for text files.' 
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Create directory in a feature
    this.app.post('/api/projects/:id/features/:feature/directory', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        const { path: dirPath } = req.body;
        
        if (!dirPath) {
          return res.status(400).json({ error: 'Directory path is required' });
        }
        
        const projectPath = path.join(this.WORKSPACE_ROOT, projectId);
        const fullPath = path.join(projectPath, dirPath);
        
        // Create directory recursively
        await fs.promises.mkdir(fullPath, { recursive: true });
        
        res.json({ success: true, path: dirPath });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete file or directory in a feature
    this.app.delete('/api/projects/:id/features/:feature/item', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const featureName = req.params.feature;
        const { path: itemPath } = req.body;
        
        if (!itemPath) {
          return res.status(400).json({ error: 'Item path is required' });
        }
        
        // Build full path: workspace/project/feature/itemPath
        const featurePath = path.join(this.WORKSPACE_ROOT, projectId, featureName);
        const fullPath = path.join(featurePath, itemPath);
        
        // Check if path exists
        const stats = await fs.promises.stat(fullPath);
        
        if (stats.isDirectory()) {
          // Remove directory recursively
          await fs.promises.rm(fullPath, { recursive: true, force: true });
        } else {
          // Remove file
          await fs.promises.unlink(fullPath);
        }
        
        res.json({ success: true, path: itemPath });
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File or directory not found' });
        } else {
          res.status(500).json({ error: error.message });
        }
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
            this.WORKSPACE_ROOT,
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

    // Abort/Stop task
    this.app.post('/api/tasks/:taskId/stop', (req: Request, res: Response) => {
      const taskId = req.params.taskId;
      const abortController = this.abortControllers.get(taskId);
      
      if (!abortController) {
        res.status(404).json({ error: 'Task not found or not running' });
        return;
      }
      
      // Abort the task
      abortController.abort();
      
      // Update task status
      const status = this.tasks.get(taskId);
      if (status && status.status === 'running') {
        status.status = 'failed';
        status.completedAt = new Date().toISOString();
        status.error = 'Task aborted by user';
      }
      
      // Clean up
      this.abortControllers.delete(taskId);
      
      res.json({ success: true, message: 'Task stopped' });
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
    
    // Create abort controller for this task
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);
    
    // Start task execution (non-blocking)
    this.runTask(taskId, params, abortController.signal).catch(error => {
      console.error(`Task ${taskId} failed:`, error);
    });

    return {
      taskId,
      success: true,
      message: 'Task started'
    };
  }
  
  private async runTask(taskId: string, params: ExecuteTaskParams, abortSignal?: AbortSignal): Promise<void> {
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
      // Check if task was aborted before starting
      if (abortSignal?.aborted) {
        throw new Error('Task was aborted before execution');
      }
      
      // Read input file
      const input = await fs.promises.readFile(params.inputFile, 'utf-8');
      
      // Check if task was aborted after reading input
      if (abortSignal?.aborted) {
        throw new Error('Task was aborted during input processing');
      }
      
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
      // Check if this was an abort
      const isAborted = abortSignal?.aborted || error.message.includes('aborted');
      
      // Mark as failed
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      
      if (isAborted) {
        captureLog('stderr', '\n🛑 Task was stopped by user');
      } else {
        captureLog('stderr', `\n❌ Task failed: ${error.message}`);
      }
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
