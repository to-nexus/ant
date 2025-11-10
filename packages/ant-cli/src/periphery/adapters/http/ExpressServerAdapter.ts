import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import { 
  HttpServerPort, 
  JobExecutionPort, 
  ExecuteJobParams, 
  JobResult, 
  JobStatus, 
  LogEntry,
  TaskQueueUpdatePort,
  FileTreeUpdatePort,
  WorkflowStateUpdatePort
} from '../../../core/ports';
import type { InterruptionDetails } from '../../../core/types';
import * as fs from 'fs';
import * as path from 'path';
import { 
  KanbanService, 
  TaskExecutionService, 
  SessionService, 
  DevServerService, 
  ProjectService,
  SSEBroadcastService,
  GraphMetadataService,
  WorkflowStateService,
  ChatService
} from './services';
import {
  createJobRoutes,
  createKanbanRoutes,
  createDevServerRoutes,
  createProjectRoutes,
  createWorkflowRoutes
} from './routes';
import { FileJobPrerequisitesAdapter } from '../prerequisites/FileJobPrerequisitesAdapter';

/**
 * ExpressServerAdapter
 * 
 * Hexagonal Architecture - Adapter Layer
 * Implements HttpServerPort and JobExecutionPort using Express framework.
 * 
 * Coordinates services and routes, delegating business logic to service layer.
 */
export class ExpressServerAdapter implements HttpServerPort, JobExecutionPort, TaskQueueUpdatePort, FileTreeUpdatePort, WorkflowStateUpdatePort {
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
  private chatService: ChatService;
  private graphMetadataService: GraphMetadataService;
  private workflowStateService: WorkflowStateService;
  private jobPrerequisitesAdapter: FileJobPrerequisitesAdapter;
  
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
   * Check if job is completed (all tasks done)
   */
  private isJobCompleted(sessionState: any): boolean {
    // Job is completed if:
    // 1. No tasks remaining in queue AND
    // 2. No current task AND
    // 3. Has completed tasks OR has jobTiming.completedAt
    const hasNoRemainingWork = 
      (!sessionState.taskQueue || sessionState.taskQueue.length === 0) &&
      !sessionState.currentTask;
    
    const hasCompletionMarker = 
      (sessionState.completedTasks && sessionState.completedTasks.length > 0) ||
      sessionState.jobTiming?.completedAt;
    
    return hasNoRemainingWork && hasCompletionMarker;
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
    
    console.log(`\n🔄 [updateTaskQueue] Called for job ${jobId}`);
    console.log(`   currentTask: ${currentTask?.name || 'null'}`);
    console.log(`   queue length: ${queue.length}`);
    console.log(`   completedTasks param: ${completedTasks !== undefined ? completedTasks.length : 'undefined'}`);
    
    // ✅ CRITICAL: Preserve existing completed tasks if not provided
    const existingSnapshot = this.taskQueueSnapshots.get(jobId);
    const finalCompletedTasks = completedTasks !== undefined 
      ? completedTasks 
      : (existingSnapshot?.completedTasks || []);
    
    console.log(`   finalCompletedTasks length: ${finalCompletedTasks.length}`);
    
    // Update local snapshot for coordination
    this.taskQueueSnapshots.set(jobId, { 
      currentTask, 
      queue,
      completedTasks: finalCompletedTasks,
      recursionCount: recursionCount || existingSnapshot?.recursionCount || 0,
      recursionLimit: recursionLimit || existingSnapshot?.recursionLimit || 50
    });
    
    // ✅ Broadcast immediately to Kanban clients via SSE service
    const mapping = this.jobToProject.get(jobId);
    if (mapping) {
      const jobStatus = this.jobs.get(jobId);
      // ✅ Narrow jobType to supported values
      const task = jobStatus?.task;
      const jobType: 'design' | 'code' | 'learn' = 
        (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
      this.sseBroadcastService.broadcastKanbanUpdate(
        mapping.projectId, 
        mapping.featureName,
        this.jobToProject,
        this.jobs,
        this.taskQueueSnapshots,
        jobType  // ✅ Pass narrowed job type
      );
    }
  }
  
  /**
   * Clean up job state when stopped (called when job is terminated)
   * 
   * @param interruptionReason - Optional interruption details to save to session
   */
  async cleanupJobState(
    jobId: string, 
    projectId?: string, 
    featureName?: string,
    interruptionReason?: InterruptionDetails
  ): Promise<void> {
    console.log(`\n🧹 [ExpressServerAdapter] cleanupJobState called for ${jobId}`);
    console.log(`   projectId: ${projectId || 'undefined'}, featureName: ${featureName || 'undefined'}`);
    console.log(`   interruptionReason: ${interruptionReason?.reason || 'none'}`);
    
    // Get mapping before deletion (from Map or from parameters)
    let mapping = this.jobToProject.get(jobId);
    
    // ✅ If mapping not found in Map (e.g., after page refresh), use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { projectId, featureName };
      console.log(`   Using provided mapping: ${projectId}/${featureName}`);
    }
    
    // Get current snapshot to return in-progress task to queue
    const snapshot = this.taskQueueSnapshots.get(jobId);
    console.log(`   Snapshot exists: ${!!snapshot}`);
    
    // ✅ CRITICAL: Get jobStatus BEFORE deletion to determine job type
    const jobStatus = this.jobs.get(jobId);
    const jobType = (jobStatus?.task as 'design' | 'code' | 'learn') || 'code';
    console.log(`   Job type: ${jobType}`);
    
    // ✅ End workflow tracking
    this.workflowStateService.endJob(jobId);
    console.log(`   ✅ Workflow state ended`);
    
    // Clear live data
    this.taskQueueSnapshots.delete(jobId);
    this.jobToProject.delete(jobId);
    this.jobs.delete(jobId);  // ✅ CRITICAL: Delete job status to prevent UI from detecting it as active
    console.log(`   ✅ Cleared live data (snapshot, jobToProject, jobs)`);
    console.log(`   ✅ jobs.size after delete: ${this.jobs.size}`);
    console.log(`   ✅ jobToProject.size after delete: ${this.jobToProject.size}`);
    console.log(`   ✅ taskQueueSnapshots.size after delete: ${this.taskQueueSnapshots.size}`);
    
    if (this.currentJobId === jobId) {
      this.currentJobId = null;
      console.log(`   ✅ Cleared currentJobId`);
    }
    
    
  // ✅ Move in-progress task back to queue in session file
  if (mapping) {
    try {
      // ✅ Use job type already determined before deletion
      const sessionPath = path.join(
        this.WORKSPACE_ROOT,
        mapping.projectId,
        mapping.featureName || 'skeleton',
        'sessions',  // ✅ Correct directory
        `${jobType}.json`  // ✅ Job-specific session file
      );
      
      console.log(`   📄 Session file: ${sessionPath}`);
      
      const sessionData = await this.sessionService.readSessionData(
        mapping.projectId, 
        mapping.featureName || 'skeleton',
        jobType  // ✅ Pass job type
      );
      
      // ✅ CRITICAL: Always broadcast, even if no session file exists yet
      // This ensures UI shows the stopped state immediately
      let shouldBroadcast = true;
      
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
          
          // ✅ CRITICAL: Only update taskQueue, preserve ALL other fields
          // This includes pausedDueToLimit, tasksRemaining, completedTasksDetails, etc.
          sessionData.state = {
            ...sessionData.state,  // ✅ Preserve all existing fields
            taskQueue: updatedQueue,
            currentTask: undefined  // Remove currentTask
          };
          
          console.log(`   ✅ Moved interrupted task back to queue: "${interruptedTask.name}"`);
        } else {
          console.log(`   ℹ️  No currentTask to return (already completed or not started)`);
          
          // ✅ Even if no task to return, preserve all state fields
          sessionData.state = {
            ...sessionData.state
          };
        }
        
        // ✨ Update jobTiming with pausedAt
        if (sessionData.state.jobTiming) {
          sessionData.state.jobTiming = {
            ...sessionData.state.jobTiming,
            pausedAt: new Date().toISOString()
          };
          console.log(`   ⏰ Updated jobTiming.pausedAt`);
        }
        
        // ✅ NEW: Save interruption details if provided
        if (interruptionReason) {
          sessionData.state.interruption = interruptionReason;
          console.log(`   ✅ Saved interruption reason: ${interruptionReason.reason}`);
        }
        
        // ✅ Log preserved state for debugging
        console.log(`   ✅ Preserving state:`, {
          hasInterruption: !!sessionData.state.interruption,
          interruptionReason: sessionData.state.interruption?.reason,
          recursionCount: sessionData.state.recursionCount,
          recursionLimit: sessionData.state.recursionLimit,
          completedTasksDetailsCount: sessionData.state.completedTasksDetails?.length || 0
        });
        
        // Write updated session (preserving ALL fields including pausedDueToLimit, completedTasksDetails)
        await fs.promises.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      } else {
        // ✅ No session file yet - create minimal session with interruption if provided
        console.log(`   ⚠️  No session file found - creating minimal session with interruption`);
        
        if (interruptionReason) {
          const minimalSession = {
            sessionId: crypto.randomUUID(),
            projectId: mapping.projectId,
            featureName: mapping.featureName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            turns: [],
            state: {
              taskQueue: [],
              completedTasks: [],
              completedTasksDetails: [],
              interruption: interruptionReason
            }
          };
          
          // Ensure directory exists
          await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
          await fs.promises.writeFile(sessionPath, JSON.stringify(minimalSession, null, 2), 'utf-8');
          console.log(`   ✅ Created minimal session with interruption: ${interruptionReason.reason}`);
        }
      }
      
      // ✅ CRITICAL: Always broadcast final update to notify UI that job has stopped
      if (shouldBroadcast) {
        console.log(`   📡 Broadcasting Kanban update (job stopped)...`);
        this.sseBroadcastService.broadcastKanbanUpdate(
          mapping.projectId, 
          mapping.featureName,
          this.jobToProject,
          this.jobs,
          this.taskQueueSnapshots,
          jobType  // ✅ Pass job type
        );
        console.log(`   ✅ Broadcast completed\n`);
      }
    } catch (error) {
    }
  } else {
  }
  }
  
  constructor() {
    console.log('🔧 Initializing ExpressServerAdapter...');
    this.app = express();
    
    // Initialize services
    console.log('   📦 Creating KanbanService...');
    this.kanbanService = new KanbanService(this.WORKSPACE_ROOT);
    this.taskExecutionService = new TaskExecutionService({
      onJobStatusChange: (jobId, status) => {
        // ✅ CRITICAL: Don't re-add completed/failed jobs to Map
        // cleanupJobState already handles removal, and re-adding causes
        // frontend to see "estimating" state again
        if (status.status === 'completed' || status.status === 'failed') {
          console.log(`[TaskExecutionService] ⏭️  Skipping jobs.set for ${status.status} job: ${jobId}`);
          return;
        }
        this.jobs.set(jobId, status);
      },
      onLogEntry: (jobId, log) => {
        const logs = this.logs.get(jobId) || [];
        logs.push(log);
        this.logs.set(jobId, logs);
      },
      onJobCompleted: async (jobId) => {
        // ✅ Clean up job state when job completes successfully
        await this.cleanupJobState(jobId);
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
      onSessionChange: (projectId, featureName, jobType) => {
        // ✅ Broadcast Kanban update when session changes
        // Now we know exactly which job type triggered the change
        console.log(`\n📡 [onSessionChange] Session file changed: ${projectId}/${featureName}/${jobType}`);
        console.log(`   Current jobs.size: ${this.jobs.size}`);
        console.log(`   Current jobToProject.size: ${this.jobToProject.size}`);
        console.log(`   Current taskQueueSnapshots.size: ${this.taskQueueSnapshots.size}`);
        
        // ✅ CRITICAL: Small delay to let cleanupJobState complete
        // Session file can be updated by 'learn' node BEFORE cleanupJobState deletes job from map
        // This 50ms delay ensures cleanupJobState runs first
        setTimeout(() => {
          console.log(`📡 [onSessionChange] Broadcasting after delay...`);
          console.log(`   jobs.size after delay: ${this.jobs.size}`);
          
          this.sseBroadcastService.broadcastKanbanUpdate(
            projectId, 
            featureName,
            this.jobToProject,
            this.jobs,
            this.taskQueueSnapshots,
            jobType  // ✅ Pass the job type from the watcher
          );
        }, 50);  // 50ms delay
        
        // ✅ Broadcast file tree update when session file is created/modified
        // This ensures the frontend sees session.json appear in the output tree
        this.sseBroadcastService.broadcastFileTreeUpdate(projectId, featureName);
      }
    });
    
    // Initialize graph metadata service for workflow visualization
    console.log('   📊 Creating GraphMetadataService...');
    this.graphMetadataService = new GraphMetadataService();
    
    // Initialize workflow state service for real-time workflow tracking
    console.log('   🔄 Creating WorkflowStateService...');
    this.workflowStateService = new WorkflowStateService();
    
    // Initialize ChatService
    console.log('   💬 Creating ChatService...');
    this.chatService = new ChatService(this.WORKSPACE_ROOT);
    
    // Initialize job prerequisites adapter
    console.log('   ✅ Creating JobPrerequisitesAdapter...');
    this.jobPrerequisitesAdapter = new FileJobPrerequisitesAdapter(this.WORKSPACE_ROOT);
    
    console.log('   ⚙️  Setting up middleware...');
    this.setupMiddleware();
    console.log('   🛣️  Setting up routes...');
    this.setupRoutes();
    
    // Set singleton instance
    ExpressServerAdapter.instance = this;
    console.log('✅ ExpressServerAdapter initialized successfully\n');
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
    this.app.post('/api/internal/task-queue', express.json(), (req: Request, res: Response) => {
      const { taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit } = req.body;
      if (!taskId) {
        return res.status(400).json({ error: 'taskId is required' });
      }
      this.updateTaskQueue(taskId, currentTask, queue, completedTasks, recursionCount, recursionLimit);
      res.json({ success: true });
    });
    
    // Project routes (includes health, agents, projects, features, files, chat)
    const projectRoutes = createProjectRoutes({
      projectService: this.projectService,
      workspaceRoot: this.WORKSPACE_ROOT,
      fileTreeSSE: this.sseBroadcastService.getFileTreeSSE(),
      chatService: this.chatService
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
    
    // Workflow routes (LangGraph visualization)
    const workflowRoutes = createWorkflowRoutes({
      graphMetadataService: this.graphMetadataService,
      workflowStateService: this.workflowStateService
    });
    this.app.use('/api', workflowRoutes);
    
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
      cleanupJobState: this.cleanupJobState.bind(this),
      workflowStateService: this.workflowStateService  // ✅ CRITICAL: Pass for node tracking
    });
    this.app.use('/api', jobRoutes);
  }
  
  // =====================================
  // JobExecutionPort implementation
  // =====================================
  
  async executeJob(params: ExecuteJobParams): Promise<JobResult> {
    // ✅ Validate required feature parameter first
    if (!params.feature) {
      throw new Error('Feature name is required for job execution');
    }
    
    const projectId = params.project;
    const featureName = params.feature;
    
    // Determine job type
    const jobType = (params.task === 'design' || params.task === 'code' || params.task === 'learn') 
      ? params.task 
      : 'code';
    
    // ✨ NEW: Check session for existing jobId (Resume support)
    let jobId: string;
    let isResume = false;
    
    try {
      const sessionData = await this.sessionService.readSessionData(projectId, featureName, jobType);
      
      // Resume if: session has jobId AND job is not completed
      if (sessionData?.state?.jobId && !this.isJobCompleted(sessionData.state)) {
        jobId = sessionData.state.jobId;
        isResume = true;
        console.log(`\n🔄 [ExecuteJob] Resuming with existing Job ID: ${jobId}`);
      } else {
        // Create new jobId
        jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`\n🆕 [ExecuteJob] Creating new Job ID: ${jobId}`);
      }
    } catch (error) {
      // Session doesn't exist or error reading - create new jobId
      jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`\n🆕 [ExecuteJob] No session found, creating new Job ID: ${jobId}`);
    }
    
    console.log(`   Project: ${projectId}`);
    console.log(`   Feature: ${featureName}`);
    console.log(`   Agent: ${params.agent}`);
    console.log(`   Task: ${params.task}`);
    
    // ✅ VALIDATE PREREQUISITES
    console.log(`\n📋 [Prerequisites] Validating required materials...`);
    
    const validationResult = await this.jobPrerequisitesAdapter.validate(
      projectId,
      featureName,
      jobType
    );
    
    if (!validationResult.isValid) {
      console.log(`\n❌ [Prerequisites] Validation failed!`);
      console.log(validationResult.errorMessage);
      
      // Return validation error
      return {
        jobId,
        success: false,
        error: validationResult.errorMessage,
        missingMaterials: validationResult.missingMaterials
      };
    }
    
    console.log(`✅ [Prerequisites] All required materials present\n`);
    
    // Initialize job tracking
    this.jobs.set(jobId, {
      jobId,
      status: 'pending',
      task: jobType,  // ✅ Track job type
      startedAt: new Date().toISOString()
    });
    this.logs.set(jobId, []);
    
    console.log(`   ✅ Job status set to 'pending'`);
    
    // Map jobId to project/feature for Kanban tracking
    this.jobToProject.set(jobId, { projectId, featureName });
    
    console.log(`   ✅ Job mapped: ${projectId}/${featureName} -> ${jobId}`);
    console.log(`   Total jobs in map: ${this.jobToProject.size}`);
    
    
    // ✅ Start workflow tracking for Agent Workflow visualization
    this.startJob(jobId);
    console.log(`   ✅ Workflow tracking started`);
    
    // Start session file watcher for real-time Kanban updates
    this.watchSessionFile(jobId, projectId, featureName, jobType);  // ✅ Use narrowed jobType
    
    console.log(`   ✅ Session file watcher started`);
    
    // ✅ CRITICAL: Broadcast immediately to show "estimating" state via SSE service
    // This ensures UI updates INSTANTLY when job starts, even before decompose
    console.log(`   🔥 Broadcasting Kanban update to show ESTIMATING state...`);
    this.sseBroadcastService.broadcastKanbanUpdate(
      projectId, 
      featureName,
      this.jobToProject,  // ✅ Pass job map
      this.jobs,           // ✅ Pass jobs status
      this.taskQueueSnapshots,  // ✅ Pass snapshots
      jobType  // ✅ Pass narrowed job type
    );
    console.log(`   ✅ Kanban broadcast completed\n`);
    
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
      
      
      const { spawn } = await import('child_process');
      
      // ✅ Ensure PATH includes common locations for git and other tools
      const ensuredPath = process.env.PATH 
        ? `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`
        : '/usr/local/bin:/usr/bin:/bin';
      
      const childProcess = spawn('npx', ['tsx', ...args], {
        cwd: process.cwd(),
        env: { 
          ...process.env,
          PATH: ensuredPath,  // ✅ Explicitly ensure PATH includes standard locations
          ANT_JOB_ID: jobId,  // ✅ Pass jobId via environment variable
          ANT_SERVER_PORT: '4100',  // ✅ Pass server port for HTTP updates
          ANT_PROJECT_ID: params.project || '',  // ✅ Pass project ID
          ANT_FEATURE_NAME: params.feature || ''  // ✅ Pass feature name
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false  // ✅ Keep in same process group for easier killing
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
            // ✅ CRITICAL: Check session for interruption details (recursion limit, etc.)
            // Even with exit code 0, the task may be paused/interrupted
            const mapping = this.jobToProject.get(jobId);
            let interruption: InterruptionDetails | undefined;
            
            if (mapping) {
              try {
                const sessionData = await this.sessionService.readSessionData(mapping.projectId, mapping.featureName);
                if (sessionData?.state?.interruption) {
                  const sessionInterruption = sessionData.state.interruption;
                  interruption = sessionInterruption;
                  console.log(`   ⏸️  Session has interruption: ${sessionInterruption.reason}`);
                  
                  // Update status to 'paused' instead of 'completed'
                  status.status = 'paused';
                  status.completedAt = new Date().toISOString();
                  
                  const logEntry: LogEntry = {
                    type: 'stdout',
                    message: `\n⏸️  Job paused: ${sessionInterruption.message}`,
                    timestamp: new Date().toISOString()
                  };
                  this.logs.get(jobId)!.push(logEntry);
                  this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
                } else {
                  // True completion (no interruption)
                  status.status = 'completed';
                  status.completedAt = new Date().toISOString();
                  
                  const logEntry: LogEntry = {
                    type: 'stdout',
                    message: '\n✅ Job completed successfully!',
                    timestamp: new Date().toISOString()
                  };
                  this.logs.get(jobId)!.push(logEntry);
                  this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
                }
              } catch (error) {
                console.warn(`   ⚠️  Failed to read session for interruption check:`, error);
                // Fallback to completed
                status.status = 'completed';
                status.completedAt = new Date().toISOString();
                
                const logEntry: LogEntry = {
                  type: 'stdout',
                  message: '\n✅ Job completed successfully!',
                  timestamp: new Date().toISOString()
                };
                this.logs.get(jobId)!.push(logEntry);
                this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
              }
            } else {
              // No mapping, assume completed
              status.status = 'completed';
              status.completedAt = new Date().toISOString();
              
              const logEntry: LogEntry = {
                type: 'stdout',
                message: '\n✅ Job completed successfully!',
                timestamp: new Date().toISOString()
              };
              this.logs.get(jobId)!.push(logEntry);
              this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
            }
            
            // ✅ Clean up job state (pass interruption if exists)
            console.log(`\n🧹 [ExpressServerAdapter.runJob] Job ${jobId} completed, calling cleanupJobState...`);
            console.log(`   interruption: ${interruption ? interruption.reason : 'none'}`);
            await this.cleanupJobState(jobId, undefined, undefined, interruption);
            console.log(`   ✅ cleanupJobState completed\n`);
            
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
            
            // ✅ Analyze logs to determine interruption reason
            let interruption: InterruptionDetails | undefined;
            
            if (!signal) {
              // Get all stderr logs for analysis
              const allLogs = this.logs.get(jobId) || [];
              const stderrLogs = allLogs
                .filter(log => log.type === 'stderr')
                .map(log => log.message)
                .join('\n');
              
              // Check for specific API error patterns
              const overloadedMatch = stderrLogs.match(/overloaded_error|overloaded/i);
              const rateLimitMatch = stderrLogs.match(/rate_limit_error|rate.*limit/i);
              const authErrorMatch = stderrLogs.match(/invalid_api_key|authentication_error|unauthorized/i);
              const modelNotFoundMatch = stderrLogs.match(/404.*?model.*?not.*?found/i);
              const modelNameMatch = stderrLogs.match(/model:\s*([^\s"]+)/i);
              
              // Check if this is any API error (generic detection)
              const isApiError = stderrLogs.match(/Error:.*?"type":\s*"error"|api.*error|llm.*error/i);
              
              if (overloadedMatch) {
                // API overloaded - temporary issue
                interruption = {
                  reason: 'api_error',
                  message: `LLM API is currently overloaded. Please try again in a few moments.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'api_overloaded',
                    exitCode: code,
                    suggestion: 'Wait a few minutes and resume the task'
                  }
                };
              } else if (rateLimitMatch) {
                // Rate limit exceeded
                interruption = {
                  reason: 'api_error',
                  message: `LLM API rate limit exceeded. Please wait before resuming.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'rate_limit',
                    exitCode: code,
                    suggestion: 'Wait for rate limit to reset'
                  }
                };
              } else if (authErrorMatch) {
                // Authentication error
                interruption = {
                  reason: 'api_error',
                  message: `LLM API authentication failed. Please check your API key.`,
                  timestamp: new Date().toISOString(),
                  canResume: false,
                  metadata: {
                    errorType: 'authentication',
                    exitCode: code,
                    suggestion: 'Verify API key in environment variables'
                  }
                };
              } else if (modelNotFoundMatch) {
                // Model not found
                const modelName = modelNameMatch ? modelNameMatch[1] : 'unknown';
                interruption = {
                  reason: 'api_error',
                  message: `LLM model not found or unavailable: ${modelName}`,
                  timestamp: new Date().toISOString(),
                  canResume: false,
                  metadata: {
                    errorType: 'model_not_found',
                    modelName: modelName,
                    exitCode: code,
                    suggestion: 'Check model name in config'
                  }
                };
              } else if (isApiError) {
                // Generic API error (catch-all for unrecognized API errors)
                interruption = {
                  reason: 'api_error',
                  message: `LLM API error occurred. Check logs for details.`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    errorType: 'unknown_api_error',
                    exitCode: code,
                    suggestion: 'Review error logs and try again'
                  }
                };
              } else {
                // Process crash (not API-related)
                interruption = {
                  reason: 'process_crash',
                  message: `Process crashed with exit code ${code}`,
                  timestamp: new Date().toISOString(),
                  canResume: true,
                  metadata: {
                    exitCode: code,
                    signal: signal
                  }
                };
              }
            }
            // Don't save interruption for user stops (already handled in jobRoutes)
            
            // ✅ CRITICAL: Clean up job state even on failure (recursion limit, errors)
            // This moves currentTask back to queue and broadcasts to UI
            await this.cleanupJobState(jobId, undefined, undefined, interruption);
            
            reject(new Error(status.error));
          }
        });
        
        childProcess.on('error', async (error) => {
          this.childProcesses.delete(jobId);
          
          status.status = 'failed';
          status.completedAt = new Date().toISOString();
          status.error = error.message;
          
          const logEntry: LogEntry = {
            type: 'stderr',
            message: `\n❌ Process error: ${error.message}`,
            timestamp: new Date().toISOString()
          };
          this.logs.get(jobId)!.push(logEntry);
          this.logStreams.get(jobId)?.forEach(listener => listener(logEntry));
          
          // ✅ Create interruption details for process error
          const interruption: InterruptionDetails = {
            reason: 'process_crash',
            message: `Process error: ${error.message}`,
            timestamp: new Date().toISOString(),
            canResume: true,
            metadata: {
              errorType: 'process_error',
              errorMessage: error.message
            }
          };
          
          await this.cleanupJobState(jobId, undefined, undefined, interruption);
          
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
      
      // ✅ Create interruption details for job startup/execution failure
      const interruption: InterruptionDetails = {
        reason: 'unknown',
        message: `Job execution failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        canResume: true,
        metadata: {
          errorType: 'execution_failure',
          errorMessage: error.message,
          stack: error.stack
        }
      };
      
      await this.cleanupJobState(jobId, undefined, undefined, interruption);
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
  private watchSessionFile(jobId: string, projectId: string, featureName: string, task: string): void {
    const key = `${projectId}/${featureName}`;
    const sseClientChecker = () => {
      const clients = this.sseBroadcastService.getKanbanSSE().get(key);
      return clients ? clients.size > 0 : false;
    };
    
    // Map task to job type
    const job = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
    
    this.sessionService.watchSessionFile(projectId, featureName, job, sseClientChecker);
  }
  
  /**
   * Notify file tree update (implements FileTreeUpdatePort)
   */
  notifyFileTreeUpdate(projectId: string, featureName: string): void {
    console.log(`[ExpressServerAdapter] 📡 notifyFileTreeUpdate called: ${projectId}/${featureName}`);
    this.sseBroadcastService.broadcastFileTreeUpdate(projectId, featureName);
    console.log(`[ExpressServerAdapter] ✅ broadcastFileTreeUpdate dispatched`);
  }
  
  // =====================================
  // WorkflowStateUpdatePort implementation
  // =====================================
  
  /**
   * Start workflow tracking for a job
   */
  startJob(jobId: string, llmInfo?: import('../../../core/ports/workflow').LLMInfo): void {
    console.log(`\n🚀 [ExpressServerAdapter] startJob called: ${jobId}`);
    if (llmInfo) {
      console.log(`   🤖 LLM: ${llmInfo.provider} / ${llmInfo.model}`);
    }
    this.workflowStateService.startJob(jobId, llmInfo);
  }
  
  /**
   * Track node entry
   * ✅ Returns Promise to ensure SSE ordering
   */
  async enterNode(jobId: string, nodeId: string, taskInfo?: import('../../../core/ports/workflow').TaskInfo, llmInfo?: import('../../../core/ports/workflow').LLMInfo): Promise<void> {
    console.log(`\n🎯 [ExpressServerAdapter] enterNode called: ${nodeId} (job: ${jobId})`);
    if (taskInfo) {
      console.log(`   📋 Task: ${taskInfo.name}`);
    }
    if (llmInfo) {
      console.log(`   🤖 LLM: ${llmInfo.provider} / ${llmInfo.model}`);
    }
    await this.workflowStateService.enterNode(jobId, nodeId, taskInfo, llmInfo);
  }
  
  /**
   * Track node exit
   */
  exitNode(jobId: string, nodeId: string): void {
    this.workflowStateService.exitNode(jobId, nodeId);
  }
  
  /**
   * Track actor interaction start
   */
  startActorInteraction(jobId: string, actorId: string): void {
    this.workflowStateService.startActorInteraction(jobId, actorId);
  }
  
  /**
   * Track actor interaction end
   */
  endActorInteraction(jobId: string, actorId: string): void {
    this.workflowStateService.endActorInteraction(jobId, actorId);
  }
  
  /**
   * End workflow tracking for a job
   */
  endJob(jobId: string): void {
    this.workflowStateService.endJob(jobId);
  }
  
  // =====================================
  // HttpServerPort implementation
  // =====================================
  
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.running = true;
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
