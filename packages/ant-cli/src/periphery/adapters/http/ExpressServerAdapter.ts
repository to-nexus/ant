import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { ChildProcess } from 'child_process';
import { 
  HttpServerPort, 
  TaskExecutionPort, 
  ExecuteTaskParams, 
  TaskResult, 
  TaskStatus, 
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
  ProjectService 
} from './services';
import {
  createTaskRoutes,
  createKanbanRoutes,
  createDevServerRoutes,
  createProjectRoutes
} from './routes';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer
 * Implements HttpServerPort and TaskExecutionPort using Express framework.
 * 
 * Coordinates services and routes, delegating business logic to service layer.
 */
export class ExpressServerAdapter implements HttpServerPort, TaskExecutionPort, TaskQueueUpdatePort, FileTreeUpdatePort {
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
  
  // Task tracking (maintained for compatibility and coordination)
  private tasks: Map<string, TaskStatus> = new Map();
  private logs: Map<string, LogEntry[]> = new Map();
  private logStreams: Map<string, Set<(log: LogEntry) => void>> = new Map();
  private sseResponses: Map<string, Set<Response>> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private currentTaskId: string | null = null;
  
  // Kanban tracking (maintained for coordination between services)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
    completedTasks: any[];  // ✅ Add completed tasks to live snapshot
    recursionCount?: number;  // ✅ Current recursion iteration
    recursionLimit?: number;  // ✅ Maximum recursion limit
  }> = new Map();
  private taskToProject: Map<string, { projectId: string; featureName: string }> = new Map();
  private kanbanSSE: Map<string, Set<Response>> = new Map();
  
  // File tree SSE
  private fileTreeSSE: Map<string, Set<Response>> = new Map();
  
  // Dev server SSE
  private devServerSSE: Map<string, Set<Response>> = new Map();
  
  /**
   * Get current task ID (for CLI subprocess)
   * First tries environment variable, then falls back to instance
   */
  static getCurrentTaskId(): string | null {
    // ✅ Priority 1: Environment variable (for child processes)
    if (process.env.ANT_TASK_ID) {
      return process.env.ANT_TASK_ID;
    }
    // Priority 2: Instance (for parent process)
    return ExpressServerAdapter.instance?.currentTaskId || null;
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   */
  updateTaskQueue(
    taskId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    console.log(`\n🔥🔥🔥 [updateTaskQueue] CALLED 🔥🔥🔥`);
    console.log(`  Task ID: ${taskId}`);
    console.log(`  Current Task:`, currentTask?.name || 'null');
    console.log(`  Queue Length:`, queue?.length || 0);
    console.log(`  Queue Tasks:`, queue?.map((t: any) => t.name).join(', ') || 'empty');
    console.log(`  Completed Tasks:`, completedTasks?.length || 0);
    console.log(`  Recursion: ${recursionCount || 0}/${recursionLimit || 50}`);
    
    // ✅ CRITICAL: Preserve existing completed tasks if not provided
    const existingSnapshot = this.taskQueueSnapshots.get(taskId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    // Update local snapshot for coordination
    this.taskQueueSnapshots.set(taskId, { 
      currentTask, 
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || 50
    });
    console.log(`  ✅ Saved to taskQueueSnapshots (including ${finalCompletedTasks.length} completed)`);
    console.log(`  📊 Total snapshots in memory:`, this.taskQueueSnapshots.size);
    
    // ✅ Broadcast immediately to Kanban clients
    const mapping = this.taskToProject.get(taskId);
    if (mapping) {
      console.log(`  📡 Broadcasting to: ${mapping.projectId}/${mapping.featureName}\n`);
      this.broadcastKanbanUpdate(mapping.projectId, mapping.featureName);
    } else {
      console.log(`  ⚠️  No mapping found for taskId: ${taskId}\n`);
    }
  }
  
  /**
   * Clean up task state when stopped (called when task is terminated)
   */
  async cleanupTaskState(taskId: string, projectId?: string, featureName?: string): Promise<void> {
    console.log(`\n🧹 [cleanupTaskState] Cleaning up task ${taskId}`);
    
    // Get mapping before deletion (from Map or from parameters)
    let mapping = this.taskToProject.get(taskId);
    
    // ✅ If mapping not found in Map (e.g., after page refresh), use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { projectId, featureName };
      console.log(`  ℹ️  Using provided project info: ${projectId}/${featureName}`);
    }
    
    // Get current snapshot to return in-progress task to queue
    const snapshot = this.taskQueueSnapshots.get(taskId);
    
    // Clear live data
    this.taskQueueSnapshots.delete(taskId);
    this.taskToProject.delete(taskId);
    
    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
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
          
        // Broadcast final update to switch to session data
        this.broadcastKanbanUpdate(mapping.projectId, mapping.featureName);
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to update session file:`, error);
    }
  } else {
    console.log(`  ℹ️  No mapping found for taskId ${taskId}\n`);
  }
  }
  
  constructor() {
    this.app = express();
    
    // Initialize services
    this.kanbanService = new KanbanService(this.WORKSPACE_ROOT);
    this.taskExecutionService = new TaskExecutionService({
      onTaskStatusChange: (taskId, status) => {
        this.tasks.set(taskId, status);
      },
      onLogEntry: (taskId, log) => {
        const logs = this.logs.get(taskId) || [];
        logs.push(log);
        this.logs.set(taskId, logs);
      }
    });
    this.sessionService = new SessionService(this.WORKSPACE_ROOT, {
      onSessionChange: (projectId, featureName) => {
        this.broadcastKanbanUpdate(projectId, featureName);
      }
    });
    this.devServerService = new DevServerService({
      onStatusChange: (projectId) => {
        this.broadcastDevServerStatus(projectId);
      }
    });
    this.projectService = new ProjectService(this.WORKSPACE_ROOT);
    
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
      fileTreeSSE: this.fileTreeSSE
    });
    this.app.use('/api', projectRoutes);
    
    // Kanban routes
    const kanbanRoutes = createKanbanRoutes({
      getKanbanData: this.getKanbanData.bind(this),
      kanbanSSE: this.kanbanSSE,
      taskToProject: this.taskToProject,
      watchSessionFile: this.watchSessionFile.bind(this)
    });
    this.app.use('/api', kanbanRoutes);
    
    // Dev server routes
    const devServerRoutes = createDevServerRoutes({
      getProjectConfig: this.getProjectConfig.bind(this),
      resolveLocalPath: this.projectService.resolveLocalPath.bind(this.projectService),
      startDevServer: this.devServerService.startDevServer.bind(this.devServerService),
      stopDevServer: this.devServerService.stopDevServer.bind(this.devServerService),
      getDevServerStatus: this.getDevServerStatus.bind(this),
      devServerSSE: this.devServerSSE,
      broadcastDevServerStatus: this.broadcastDevServerStatus.bind(this)
    });
    this.app.use('/api', devServerRoutes);
    
    // Task execution routes
    const taskRoutes = createTaskRoutes({
      workspaceRoot: this.WORKSPACE_ROOT,
      executeTask: this.executeTask.bind(this),
      getTaskStatus: this.getTaskStatus.bind(this),
      getLogs: this.getLogs.bind(this),
      logStreams: this.logStreams,
      sseResponses: this.sseResponses,
      logs: this.logs,
      childProcesses: this.childProcesses,
      tasks: this.tasks,
      cleanupTaskState: this.cleanupTaskState.bind(this)  // ✅ Add cleanup method
    });
    this.app.use('/api', taskRoutes);
  }
  
  // =====================================
  // TaskExecutionPort implementation
  // =====================================
  
  async executeTask(params: ExecuteTaskParams): Promise<TaskResult> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize task tracking
    this.tasks.set(taskId, {
      taskId,
      status: 'pending',
      startedAt: new Date().toISOString()
    });
    this.logs.set(taskId, []);
    
    // ✅ Validate required feature parameter
    if (!params.feature) {
      throw new Error('Feature name is required for task execution');
    }
    
    const projectId = params.project;
    const featureName = params.feature;
    
    // Map taskId to project/feature for Kanban tracking
    this.taskToProject.set(taskId, { projectId, featureName });
    
    console.log(`[executeTask] Task ${taskId} mapped to ${projectId}/${featureName}`);
    
    // Start session file watcher for real-time Kanban updates
    this.watchSessionFile(taskId, projectId, featureName);
    
    // ✅ CRITICAL: Broadcast immediately to show "estimating" state
    // This ensures UI updates INSTANTLY when task starts, even before decompose
    console.log(`[executeTask] 🎬 Broadcasting initial "estimating" state for ${projectId}/${featureName}`);
    this.broadcastKanbanUpdate(projectId, featureName);
    
    // Start task execution in child process (non-blocking)
    this.runTask(taskId, params).catch(error => {
      console.error(`Task ${taskId} failed:`, error);
    });

    return {
      taskId,
      success: true,
      message: 'Task started'
    };
  }
  
  /**
   * Run task in child process
   */
  private async runTask(taskId: string, params: ExecuteTaskParams): Promise<void> {
    const status = this.tasks.get(taskId)!;
    status.status = 'running';
    this.currentTaskId = taskId;
    
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
      
      console.log(`[Task Execution] Starting task ${taskId}: tsx ${args.join(' ')}`);
      
      const { spawn } = await import('child_process');
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { 
          ...process.env,
          ANT_TASK_ID: taskId,  // ✅ Pass taskId via environment variable
          ANT_SERVER_PORT: '4100'  // ✅ Pass server port for HTTP updates
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      this.childProcesses.set(taskId, childProcess);
      
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
        
        this.logs.get(taskId)!.push(logEntry);
        this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
        
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
          this.childProcesses.delete(taskId);
          
          if (stdoutBuffer) flushBuffer(stdoutBuffer, 'stdout');
          if (stderrBuffer) flushBuffer(stderrBuffer, 'stderr');
          
          if (code === 0) {
            status.status = 'completed';
            status.completedAt = new Date().toISOString();
            
            const logEntry: LogEntry = {
              type: 'stdout',
              message: '\n✅ Task completed successfully!',
              timestamp: new Date().toISOString()
            };
            this.logs.get(taskId)!.push(logEntry);
            this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
            
            // ✅ Clean up task state (clear live snapshots, update UI)
            await this.cleanupTaskState(taskId);
            
            resolve();
          } else {
            status.status = 'failed';
            status.completedAt = new Date().toISOString();
            status.error = signal ? `Killed by ${signal}` : `Exit code: ${code}`;
            
            const logEntry: LogEntry = {
              type: 'stderr',
              message: signal 
                ? `\n🛑 Task stopped by user (${signal})`
                : `\n❌ Task failed with exit code ${code}`,
              timestamp: new Date().toISOString()
            };
            this.logs.get(taskId)!.push(logEntry);
            this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
            
            // ✅ CRITICAL: Clean up task state even on failure (recursion limit, errors)
            // This moves currentTask back to queue and broadcasts to UI
            await this.cleanupTaskState(taskId);
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', (error) => {
          this.childProcesses.delete(taskId);
          reject(error);
        });
      });
    } catch (error: any) {
      status.status = 'failed';
      status.completedAt = new Date().toISOString();
      status.error = error.message;
      
      const logEntry: LogEntry = {
        type: 'stderr',
        message: `\n❌ Task failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
      this.logs.get(taskId)!.push(logEntry);
      this.logStreams.get(taskId)?.forEach(listener => listener(logEntry));
    } finally {
      if (this.currentTaskId === taskId) {
        this.currentTaskId = null;
      }
    }
  }
  
  getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId);
  }
  
  getLogs(taskId: string): LogEntry[] {
    return this.logs.get(taskId) || [];
  }
  
  async *streamLogs(taskId: string): AsyncIterableIterator<LogEntry> {
    const logs = this.logs.get(taskId) || [];
    
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
  private watchSessionFile(taskId: string, projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const sseClientChecker = () => {
      const clients = this.kanbanSSE.get(key);
      return clients ? clients.size > 0 : false;
    };
    
    this.sessionService.watchSessionFile(projectId, featureName, sseClientChecker);
  }
  
  /**
   * Get Kanban data with hybrid strategy
   * 
   * Data Source Priority:
   * 1. Live snapshot (real-time memory state from running task)
   * 2. Estimating state (task running but no data yet)
   * 3. Session file (persistent state for completed/paused tasks)
   */
  private async getKanbanData(projectId: string, featureName: string): Promise<any> {
    // 1. Find active taskId for this project/feature
    let activeTaskId: string | null = null;
    for (const [taskId, mapping] of this.taskToProject.entries()) {
      if (mapping.projectId === projectId && mapping.featureName === featureName) {
        const taskStatus = this.tasks.get(taskId);
        // ✅ Check for both 'pending' and 'running' states
        if (taskStatus && (taskStatus.status === 'running' || taskStatus.status === 'pending')) {
          activeTaskId = taskId;
          break;
        }
      }
    }
    
    // 2. Try to get LIVE data from memory snapshot
    let liveSnapshot = null;
    if (activeTaskId) {
      liveSnapshot = this.taskQueueSnapshots.get(activeTaskId);
      console.log(`  🔍 Looking for live snapshot with taskId: ${activeTaskId}`);
      console.log(`  📊 Available snapshots:`, Array.from(this.taskQueueSnapshots.keys()));
      console.log(`  ${liveSnapshot ? '✅ FOUND' : '❌ NOT FOUND'}`);
    }
    
    // 3. Get SESSION data from file
    const sessionData = await this.sessionService.readSessionData(projectId, featureName);
    const sessionState = sessionData?.state || {};
    const sessionTaskQueue = sessionState.taskQueue || [];
    const completedTaskIds = sessionState.completedTasks || [];
    const completedTasksDetails = sessionState.completedTasksDetails || [];
    const currentTask = sessionState.currentTask || null;
    
    // 4. Determine state and build Kanban data
    
    // ✅ DEBUG: Log ALL decision factors with snapshot details
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[Kanban] 🔍 Data source decision for ${projectId}/${featureName}:`);
    console.log(`  📌 Active Task:`, activeTaskId || 'NONE');
    console.log(`  💾 Live Snapshot:`, !!liveSnapshot ? 'EXISTS' : 'NONE');
    if (liveSnapshot) {
      console.log(`     - Current Task:`, liveSnapshot.currentTask?.name || 'null');
      console.log(`     - Queue Length:`, liveSnapshot.queue?.length || 0);
      console.log(`     - Queue Tasks:`, liveSnapshot.queue?.map((t: any) => t.name).join(', ') || 'empty');
    }
    console.log(`  📄 Session Data:`);
    console.log(`     - Queue Length:`, sessionTaskQueue.length);
    console.log(`     - Current Task:`, currentTask?.name || 'null');
    console.log(`     - Completed Count:`, completedTasksDetails.length);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Priority 1: LIVE DATA (most recent, real-time)
    // ✅ Changed: Accept live snapshot if it EXISTS, even if queue/currentTask are empty
    // This ensures we use live data as soon as orchestrator starts updating
    if (activeTaskId && liveSnapshot) {
      console.log(`[Kanban] ✅ Using LIVE DATA for ${projectId}/${featureName}`);
      console.log(`         Queue: ${liveSnapshot.queue?.length || 0} tasks, Current: ${liveSnapshot.currentTask?.name || 'none'}`);
      console.log(`         Completed (live): ${liveSnapshot.completedTasks?.length || 0}\n`);
      
      // ✅ Use completed tasks from LIVE snapshot (not session!)
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      return {
        todo: liveSnapshot.queue || [],
        inProgress: liveSnapshot.currentTask || null,
        completed: liveCompletedTasks.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: false,
        dataSource: 'live',
        recursionCount: liveSnapshot.recursionCount,
        recursionLimit: liveSnapshot.recursionLimit,
        pausedDueToLimit: sessionState.pausedDueToLimit || false,  // From session (live doesn't track pause state)
        tasksRemaining: sessionState.tasksRemaining || 0
      };
    }
    
    // Priority 2: ESTIMATING (task running but no data yet)
    if (activeTaskId && !liveSnapshot && sessionTaskQueue.length === 0 && !currentTask) {
      console.log(`[Kanban] ✓ Task running, ESTIMATING for ${projectId}/${featureName}`);
      
      // ✅ Read recursion limit from session or environment variable
      const MINIMUM_RECURSION_LIMIT = 5;
      const DEFAULT_RECURSION_LIMIT = 50;
      const envLimit = parseInt(process.env.RECURSION_LIMIT || String(DEFAULT_RECURSION_LIMIT), 10);
      const finalLimit = isNaN(envLimit) || envLimit < 1 
        ? DEFAULT_RECURSION_LIMIT 
        : envLimit < MINIMUM_RECURSION_LIMIT 
          ? MINIMUM_RECURSION_LIMIT 
          : envLimit;
      
      return {
        todo: [],
        inProgress: null,
        completed: completedTasksDetails.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: true,
        dataSource: 'estimating',
        recursionCount: sessionState.recursionCount || 0,  // ✅ Include recursion from session
        recursionLimit: sessionState.recursionLimit || finalLimit  // ✅ Include limit from session or env
      };
    }
    
    // Priority 3: SESSION DATA (task running but live data not ready yet, OR task completed)
    console.log(`[Kanban] ✓ Using SESSION data for ${projectId}/${featureName} (${activeTaskId ? 'transitioning to live' : 'static'})`);
    
    return {
      todo: sessionTaskQueue.filter((task: any) => 
        !completedTaskIds.includes(task.id) && 
        (!currentTask || currentTask.id !== task.id)
      ),
      inProgress: currentTask,
      completed: completedTasksDetails.map((detail: any) => ({
        ...detail,
        status: 'completed',
        completed: true
      })),
      isEstimating: false,
      dataSource: 'session',
      pausedDueToLimit: sessionState.pausedDueToLimit || false,  // ✅ Include pause info
      tasksRemaining: sessionState.tasksRemaining || 0,
      recursionCount: sessionState.recursionCount,  // ✅ Include recursion count from session
      recursionLimit: sessionState.recursionLimit  // ✅ Include recursion limit from session
    };
  }
  
  /**
   * Broadcast Kanban update to SSE clients
   */
  private broadcastKanbanUpdate(projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    this.getKanbanData(projectId, featureName).then(data => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[Kanban SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
    }).catch(error => {
      console.error(`[Kanban SSE] Error getting Kanban data:`, error);
    });
  }
  
  /**
   * Notify file tree update (implements FileTreeUpdatePort)
   */
  notifyFileTreeUpdate(projectId: string, featureName: string): void {
    console.log(`📡 [FileTree] Notifying update for ${projectId}/${featureName}`);
    this.broadcastFileTreeUpdate(projectId, featureName);
  }
  
  /**
   * Broadcast file tree update to SSE clients
   */
  private async broadcastFileTreeUpdate(projectId: string, featureName: string): Promise<void> {
    const key = `${projectId}/${featureName}`;
    const clients = this.fileTreeSSE.get(key);
    
    if (!clients || clients.size === 0) {
      console.log(`  ℹ️  No file tree SSE clients for ${key}`);
      return;
    }
    
    try {
      // Fetch updated file tree
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
      
      const fileTree = await buildFileTree(featurePath);
      const message = `data: ${JSON.stringify({ type: 'update', fileTree })}\n\n`;
      
      console.log(`  📡 Broadcasting to ${clients.size} client(s)`);
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[FileTree SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
    } catch (error) {
      console.error(`[FileTree SSE] Error getting file tree:`, error);
    }
  }
  
  // =====================================
  // Dev server related methods
  // =====================================
  
  private async getProjectConfig(projectId: string): Promise<any> {
    return this.projectService.getProjectConfig(projectId);
  }
  
  private getDevServerStatus(projectId: string): any {
    const status = this.devServerService.getDevServerStatus(projectId);
    const logs = this.devServerService.getDevServerLogs(projectId);
    
    return {
      running: status.running,
      port: status.port || null,
      url: status.port ? `http://localhost:${status.port}` : null,
      logs: logs.slice(-50) // Last 50 logs
    };
  }
  
  private broadcastDevServerStatus(projectId: string): void {
    const clients = this.devServerSSE.get(projectId);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    const status = this.getDevServerStatus(projectId);
    const message = `data: ${JSON.stringify(status)}\n\n`;
    
    clients.forEach(res => {
      try {
        res.write(message);
      } catch (error) {
        console.error(`[DevServer SSE] Error sending to client:`, error);
        clients.delete(res);
      }
    });
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
        // Close all SSE connections
        this.kanbanSSE.forEach((clients) => {
          clients.forEach(res => {
            try {
              res.end();
            } catch (err) {
              // Ignore errors from already closed connections
            }
          });
        });
        this.kanbanSSE.clear();
        
        this.devServerSSE.forEach((clients) => {
          clients.forEach(res => {
            try {
              res.end();
            } catch (err) {
              // Ignore errors
            }
          });
        });
        this.devServerSSE.clear();
        
        // Stop all child processes
        this.childProcesses.forEach((proc) => {
          proc.kill('SIGTERM');
        });
        this.childProcesses.clear();
        
        // Cleanup services
        this.sessionService.cleanup();
        this.devServerService.cleanup();
        
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
