import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { ChildProcess } from 'child_process';
import { 
  HttpServerPort, 
  JobExecutionPort, 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry,
  TaskQueueUpdatePort,
  FileTreeUpdatePort
} from '../../../core/ports';
import * as fs from 'fs';
import * as path from 'path';
import { 
  KanbanService, 
  TaskExecutionService, 
  SessionService, 
  DevServerService, 
  ProjectService,
  SSEBroadcastService
} from './services';
import {
  createJobRoutes,
  createKanbanRoutes,
  createDevServerRoutes,
  createProjectRoutes
} from './routes';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer
 * Implements HttpServerPort and JobExecutionPort using Express framework.
 * 
 * Coordinates services and routes, delegating business logic to service layer.
 */
export class ExpressServerAdapter implements HttpServerPort, JobExecutionPort, TaskQueueUpdatePort, FileTreeUpdatePort {
  private app: Express;
  private server: any;
  private running: boolean = false;
  
  // Singleton instance for global access
  private static instance: ExpressServerAdapter | null = null;
  
  // Workspace root path
  private readonly WORKSPACE_ROOT = path.join(process.cwd(), '../../workspace');
  
  // Services
  private kanbanService: KanbanService;
  private taskExecutionService: TaskExecutionService;
  private sessionService: SessionService;
  private devServerService: DevServerService;
  private projectService: ProjectService;
  private sseBroadcastService: SSEBroadcastService;
  
  // Job tracking (agent execution instances)
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private sseResponses: Map<string, Set<Response>> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private currentJobId: string | null = null;
  
  // Kanban tracking (Task Board tasks - maintained for coordination between services)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
    completedTasks: any[];  // ✅ Add completed tasks to live snapshot
    recursionCount?: number;  // ✅ Current recursion iteration
    recursionLimit?: number;  // ✅ Maximum recursion limit
  }> = new Map();
  private jobToProject: Map<string, { projectId: string; featureName: string }> = new Map();
  
  /**
   * Get current job ID (for CLI subprocess)
   * First tries environment variable, then falls back to instance
   */
  static getCurrentJobId(): string | null {
    // ✅ Priority 1: Environment variable (for child processes)
    if (process.env.ANT_JOB_ID) {
      return process.env.ANT_JOB_ID;
    }
    // Priority 2: Instance (for parent process)
    return ExpressServerAdapter.instance?.currentJobId || null;
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   * Note: This manages Task Board tasks, not job execution
   */
  updateTaskQueue(
    jobId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    console.log(`\n🔥🔥🔥 [updateTaskQueue] CALLED 🔥🔥🔥`);
    console.log(`  Job ID: ${jobId}`);
    console.log(`  Current Task:`, currentTask?.name || 'null');
    console.log(`  Queue Length:`, queue?.length || 0);
    console.log(`  Queue Tasks:`, queue?.map((t: any) => t.name).join(', ') || 'empty');
    console.log(`  Completed Tasks:`, completedTasks?.length || 0);
    console.log(`  Recursion: ${recursionCount || 0}/${recursionLimit || 50}`);
    
    // ✅ CRITICAL: Preserve existing completed tasks if not provided
    const existingSnapshot = this.taskQueueSnapshots.get(jobId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    // Update local snapshot for coordination
    this.taskQueueSnapshots.set(jobId, { 
      currentTask, 
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || 50
    });
    console.log(`  ✅ Saved to taskQueueSnapshots (including ${finalCompletedTasks.length} completed)`);
    console.log(`  📊 Total snapshots in memory:`, this.taskQueueSnapshots.size);
    
    // ✅ Broadcast immediately to Kanban clients via SSE service
    const mapping = this.jobToProject.get(jobId);
    if (mapping) {
      console.log(`  📡 Broadcasting to: ${mapping.projectId}/${mapping.featureName}\n`);
      this.sseBroadcastService.broadcastKanbanUpdate(mapping.projectId, mapping.featureName);
    } else {
      console.log(`  ⚠️  No mapping found for jobId: ${jobId}\n`);
    }
  }
  
  /**
   * Clean up job state when stopped (called when job is terminated)
   */
  async cleanupJobState(jobId: string, projectId?: string, featureName?: string): Promise<void> {
    console.log(`\n🧹 [cleanupJobState] Cleaning up job ${jobId}`);
    
    // Get mapping before deletion (from Map or from parameters)
    let mapping = this.jobToProject.get(jobId);
    
    // ✅ If mapping not found in Map (e.g., after page refresh), use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { projectId, featureName };
      console.log(`  ℹ️  Using provided project info: ${projectId}/${featureName}`);
    }
    
    // Get current snapshot to return in-progress task to queue
    const snapshot = this.taskQueueSnapshots.get(jobId);
    
    // Clear live data
    this.taskQueueSnapshots.delete(jobId);
    this.jobToProject.delete(jobId);
    
    if (this.currentJobId === jobId) {
      this.currentJobId = null;
    }
    
    console.log(`  ✅ Cleared live snapshots and mappings`);
    
  // ✅ Move in-progress task back to queue in session file
  if (mapping) {
    try {
      const sessionPath = path.join(
        this.WORKSPACE_ROOT,
        mapping.projectId,
        'skeleton',
        'outputs',
        'session.json'
      );
      
      const sessionData = await this.sessionService.readSessionData(mapping.projectId, mapping.featureName);
      if (sessionData?.state) {
        // Check if there's a currentTask to move back (either from snapshot or session file)
        const taskToReturn = snapshot?.currentTask || sessionData.state.currentTask;
        
        if (taskToReturn) {
          // Mark task as interrupted
          const interruptedTask = {
            ...taskToReturn,
            interrupted: true
          };
          
          // ✅ Put currentTask back at the front of the queue (filter out duplicates)
          const existingQueue = sessionData.state.taskQueue || [];
          const filteredQueue = existingQueue.filter((task: any) => task.id !== taskToReturn.id);
          const updatedQueue = [
            interruptedTask,
            ...filteredQueue
          ];
          
          sessionData.state.taskQueue = updatedQueue;
          delete sessionData.state.currentTask;  // ✅ Remove currentTask completely
          
          // Write updated session
          await fs.promises.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
          
          console.log(`  ✅ Returned in-progress task "${taskToReturn.name}" to queue (marked as interrupted)`);
          console.log(`  📊 Queue now has ${updatedQueue.length} tasks\n`);
        } else {
          console.log(`  ℹ️  No in-progress task to return to queue\n`);
        }
          
        // Broadcast final update to switch to session data via SSE service
        this.sseBroadcastService.broadcastKanbanUpdate(mapping.projectId, mapping.featureName);
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to update session file:`, error);
    }
  } else {
    console.log(`  ℹ️  No mapping found for jobId ${jobId}\n`);
  }
  }
  
  constructor() {
    this.app = express();
    
    // Initialize services
    this.kanbanService = new KanbanService(this.WORKSPACE_ROOT);
    this.taskExecutionService = new TaskExecutionService({
      onJobStatusChange: (jobId, status) => {
        this.jobs.set(jobId, status);
      },
      onLogEntry: (jobId, log) => {
        const logs = this.logs.get(jobId) || [];
        logs.push(log);
        this.logs.set(jobId, logs);
      }
    });
    this.projectService = new ProjectService(this.WORKSPACE_ROOT);
    this.devServerService = new DevServerService({
      onStatusChange: (projectId) => {
        this.sseBroadcastService.broadcastDevServerStatus(projectId);
      }
    });
    
    // Initialize SSE broadcast service (requires other services to be initialized first)
    this.sseBroadcastService = new SSEBroadcastService(
      this.kanbanService,
      this.devServerService,
      this.projectService
    );
    
    // Initialize session service with SSE callback
    this.sessionService = new SessionService(this.WORKSPACE_ROOT, {
      onSessionChange: (projectId, featureName) => {
        this.sseBroadcastService.broadcastKanbanUpdate(projectId, featureName);
      }
    });
    
    this.setupMiddleware();
    this.setupRoutes();
    
    // Set singleton instance
    ExpressServerAdapter.instance = this;
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): ExpressServerAdapter | null {
    return ExpressServerAdapter.instance;
  }
  
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
  }
  
  private setupRoutes(): void {
    // Internal API for task queue updates (from child processes)
    this.app.post('/api/internal/task-queue', express.json(), (req, res) => {
      const { taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit } = req.body;
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }
      this.updateTaskQueue(taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit);
      res.json({ success: true });
    });
    
    // Project routes (includes health, agents, projects, features, files)
    const projectRoutes = createProjectRoutes({
      projectService: this.projectService,
      workspaceRoot: this.WORKSPACE_ROOT,
      fileTreeSSE: this.sseBroadcastService.getFileTreeSSE()
    });
    this.app.use('/api', projectRoutes);
    
    // Kanban routes
    const kanbanRoutes = createKanbanRoutes({
      kanbanService: this.kanbanService,
      kanbanSSE: this.sseBroadcastService.getKanbanSSE(),
      jobToProject: this.jobToProject,
      jobs: this.jobs,
      taskQueueSnapshots: this.taskQueueSnapshots,
      watchSessionFile: this.watchSessionFile.bind(this)
    });
    this.app.use('/api', kanbanRoutes);
    
    // Dev server routes
    const devServerRoutes = createDevServerRoutes({
      projectService: this.projectService,
      devServerService: this.devServerService,
      devServerSSE: this.sseBroadcastService.getDevServerSSE(),
      broadcastDevServerStatus: this.sseBroadcastService.broadcastDevServerStatus.bind(this.sseBroadcastService)
    });
    this.app.use('/api', devServerRoutes);
    
    // Job execution routes
    const jobRoutes = createJobRoutes({
      workspaceRoot: this.WORKSPACE_ROOT,
      executeJob: this.executeJob.bind(this),
      getJobStatus: this.getJobStatus.bind(this),
      getLogs: this.getLogs.bind(this),
      logStreams: this.logStreams,
      sseResponses: this.sseResponses,
      logs: this.logs,
      childProcesses: this.childProcesses,
      jobs: this.jobs,
      cleanupJobState: this.cleanupJobState.bind(this)
    });
    this.app.use('/api', jobRoutes);
  }
  
  // =====================================
  // JobExecutionPort implementation
  // =====================================
  
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize job tracking
    this.jobs.set(jobId, {
      jobId,
      status: 'pending',
      startedAt: new Date().toISOString()
    });
    this.logs.set(jobId, []);
    
    // ✅ Validate required feature parameter
    if (!params.feature) {
      throw new Error('Feature name is required for job execution');
    }
    
    const projectId = params.project;
    const featureName = params.feature;
    
    // Map jobId to project/feature for Kanban tracking
    this.jobToProject.set(jobId, { projectId, featureName });
    
    console.log(`[executeJob] Job ${jobId} mapped to ${projectId}/${featureName}`);
    
    // Start session file watcher for real-time Kanban updates
    this.watchSessionFile(jobId, projectId, featureName);
    
    // ✅ CRITICAL: Broadcast immediately to show "estimating" state via SSE service
    // This ensures UI updates INSTANTLY when job starts, even before decompose
    console.log(`[executeJob] 🎬 Broadcasting initial "estimating" state for ${projectId}/${featureName}`);
    this.sseBroadcastService.broadcastKanbanUpdate(projectId, featureName);
    
    // Start job execution in child process (non-blocking)
    this.runJob(jobId, params).catch(error => {
      console.error(`Job ${jobId} failed:`, error);
    });

    return {
      jobId,
      success: true,
      message: 'Job started'
    };
  }
  
  /**
   * Run job in child process
   */
  private async runJob(jobId: string, params: ExecuteJobParams): Promise<void> {
    const status = this.jobs.get(jobId)!;
    status.status = 'running';
    this.currentJobId = jobId;
    
    try {
      // Build ant CLI command
      const antCliSrc = path.join(process.cwd(), 'src/index.ts');
      const args = [
        antCliSrc,
        params.agent,
        params.task
      ];
      
      if (params.inputFile) {
        args.push(params.inputFile);
      }
      
      if (params.mode && params.task === 'code') {
        args.push('--mode', params.mode);
      }
      
      if (params.project) {
        args.push('--project', params.project);
      }
      
      if (params.enableEvaluation && params.task === 'code') {
        args.push('--eval');
      }
      
      console.log(`[Job Execution] Starting job ${jobId}: tsx ${args.join(' ')}`);
      
      const { spawn } = await import('child_process');
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { 
          ...process.env,
          ANT_JOB_ID: jobId,  // ✅ Pass jobId via environment variable
          ANT_SERVER_PORT: '4100'  // ✅ Pass server port for HTTP updates
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.childProcesses.set(jobId, childProcess);
      
      // Line buffering for stdout/stderr
      let stdoutBuffer = '';
      let stderrBuffer = '';
      
      const flushBuffer = (buffer: string, type: 'stdout' | 'stderr') => {
        if (!buffer) return;
        
        const logEntry: LogEntry = {
          type,
          message: buffer,
          timestamp: new Date().toISOString()
        };
        
        this.logs.get(jobId)!.push(logEntry);
        this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
        
        if (type === 'stdout') {
          process.stdout.write(buffer);
        } else {
          process.stderr.write(buffer);
        }
      };
      
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.substring(0, newlineIndex + 1);
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stdout');
        }
      });
      
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = stderrBuffer.indexOf('\n')) !== -1) {
          const line = stderrBuffer.substring(0, newlineIndex + 1);
          stderrBuffer = stderrBuffer.substring(newlineIndex + 1);
          flushBuffer(line, 'stderr');
        }
      });
      
      await new Promise<void>((resolve, reject) => {
        childProcess.on('exit', async (code, signal) => {
          this.childProcesses.delete(jobId);
          
          if (stdoutBuffer) flushBuffer(stdoutBuffer, 'stdout');
          if (stderrBuffer) flushBuffer(stderrBuffer, 'stderr');
          
          if (code === 0) {
            status.status = 'completed';
            status.completedAt = new Date().toISOString();
            
            const logEntry: LogEntry = {
              type: 'stdout',
              message: '\n✅ Job completed successfully!',
              timestamp: new Date().toISOString()
            };
            this.logs.get(jobId)!.push(logEntry);
            this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            
            // ✅ Clean up job state (clear live snapshots, update UI)
            await this.cleanupJobState(jobId);
            
            resolve();
          } else {
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            
            const logEntry: LogEntry = {
              type: 'stderr',
              message: signal 
                ? `\n🛑 Job stopped by user (${signal})`
                : `\n❌ Job failed with exit code ${code}`,
              timestamp: new Date().toISOString()
            };
            this.logs.get(jobId)!.push(logEntry);
            this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            
            // ✅ CRITICAL: Clean up job state even on failure (recursion limit, errors)
            // This moves currentTask back to queue and broadcasts to UI
            await this.cleanupJobState(jobId);
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', (error) => {
          this.childProcesses.delete(jobId);
          reject(error);
        });
      });
    } catch (error: any) {
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      
      const logEntry: LogEntry = {
        type: 'stderr',
        message: `\n❌ Job failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      this.logs.get(jobId)!.push(logEntry);
      this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
    } finally {
      if (this.currentJobId === jobId) {
        this.currentJobId = null;
      }
    }
  }
  
  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }
  
  getLogs(jobId: string): LogEntry[] {
    return this.logs.get(jobId) || [];
  }
  
  async *streamLogs(jobId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(jobId) || [];
    
    // Yield existing logs
    for (const log of logs) {
      yield log;
    }
  }
  
  // =====================================
  // Kanban-related methods
  // =====================================
  
  /**
   * Watch session file for changes
   */
  private watchSessionFile(jobId: string, projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const sseClientChecker = () => {
      const clients = this.sseBroadcastService.getKanbanSSE().get(key);
      return clients ? clients.size > 0 : false;
    };
    
    this.sessionService.watchSessionFile(projectId, featureName, sseClientChecker);
  }
  
  /**
   * Notify file tree update (implements FileTreeUpdatePort)
   */
  notifyFileTreeUpdate(projectId: string, featureName: string): void {
    console.log(`📡 [FileTree] Notifying update for ${projectId}/${featureName}`);
    this.sseBroadcastService.broadcastFileTreeUpdate(projectId, featureName);
  }
  
  // =====================================
  // HttpServerPort implementation
  // =====================================
  
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.running = true;
          console.log(`🚀 ANT Server running on http://localhost:${port}`);
          console.log(`📊 Health check: http://localhost:${port}/health`);
          console.log(`📚 API documentation: http://localhost:${port}/api`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Stop all child processes
        this.childProcesses.forEach((proc) => {
          proc.kill('SIGTERM');
        });
        this.childProcesses.clear();
        
        // Cleanup services
        this.sessionService.cleanup();
        this.devServerService.cleanup();
        this.sseBroadcastService.cleanup(); // Cleanup all SSE connections
        
        this.server.close(() => {
          this.running = false;
          console.log('🛑 ANT Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  isRunning(): boolean {
    return this.running;
  }
}
