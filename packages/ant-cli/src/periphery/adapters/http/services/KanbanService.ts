import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';
import { StateStorePort } from '../../../../core/ports/stateStore';
import type { TaskQueueSnapshot, KanbanData } from '../../../../core/types/task';
import { getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';

/**
 * KanbanService
 * 
 * Manages Kanban board state for real-time task tracking.
 * 
 * Cloud-safe: Uses Redis StateStore for cross-pod task queue sharing.
 * Data Source Priority:
 * 1. Redis StateStore (live snapshot from Job Worker)
 * 2. Session file (persistent state for completed/paused jobs)
 */
export class KanbanService {
  private readonly workspaceRoot: string;
  private readonly workspaceResolver?: WorkspaceResolver;
  
  // StateStore for Redis-based state (Cloud mode)
  private stateStore?: StateStorePort;
  
  // Last-known-good session cache to survive partial writes (file read fallback)
  private lastGoodSessionByPath: Map<string, any> = new Map();
  
  /**
   * Calculate total elapsed time for a job
   */
  private calculateTotalElapsedTime(
    jobTiming: any | undefined,
    completedTasksDetails: any[],
    currentTask: any | null
  ): number {
    if (!jobTiming) {
      if (process.env.DEBUG_KANBAN === '1') {
        console.warn(`⚠️  [KanbanService] calculateTotalElapsedTime: No jobTiming data!`);
      }
      return 0;
    }
    
    let totalElapsed = 0;
    
    // 1. Add estimating duration
    if (jobTiming.estimatingDuration) {
      totalElapsed += jobTiming.estimatingDuration;
    }
    
    // 2. Add completed tasks elapsed time
    for (const task of completedTasksDetails) {
      if (task.timing?.elapsedTime) {
        totalElapsed += task.timing.elapsedTime;
      } else if (task.elapsedTime) {
        totalElapsed += task.elapsedTime;
      }
    }
    
    // 3. Add current task elapsed time (if in progress)
    if (currentTask?.timing?.startedAt) {
      const currentTaskStartTime = new Date(currentTask.timing.startedAt).getTime();
      const currentTaskElapsed = Date.now() - currentTaskStartTime - (currentTask.timing.totalPausedDuration || 0);
      totalElapsed += currentTaskElapsed;
    }
    
    return Math.max(0, totalElapsed);
  }
  
  constructor(workspaceRoot: string, workspaceResolver?: WorkspaceResolver, stateStore?: StateStorePort) {
    this.workspaceRoot = workspaceRoot;
    this.workspaceResolver = workspaceResolver;
    this.stateStore = stateStore;
  }
  
  /**
   * Setup StateStore for Redis-based state management
   */
  setStateStore(stateStore: StateStorePort): void {
    this.stateStore = stateStore;
  }
  
  /**
   * Invalidate session cache for a specific path
   */
  invalidateSessionCache(sessionPath: string): void {
    if (this.lastGoodSessionByPath.has(sessionPath)) {
      this.lastGoodSessionByPath.delete(sessionPath);
      console.log(`[KanbanService] 🗑️ Invalidated cache for: ${sessionPath}`);
    }
  }
  
  /**
   * Invalidate session cache by project/feature/jobType
   */
  invalidateSessionCacheByFeature(
    userContext: UserContext | undefined,
    projectId: string,
    featureName: string,
    jobType: 'design' | 'code' | 'learn'
  ): void {
    if (!this.workspaceResolver || !userContext) {
      console.warn('[KanbanService] Cannot invalidate cache: missing workspaceResolver or userContext');
      return;
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);
    this.invalidateSessionCache(sessionPath);
  }
  
  /**
   * Clear job-related state for a specific jobId
   */
  async clearJobMemory(jobId: string): Promise<void> {
    // Clear from Redis StateStore
    if (this.stateStore) {
      await this.stateStore.deleteTaskQueue(jobId);
      console.log(`[KanbanService] 🗑️ Cleared Redis taskQueue for job: ${jobId}`);
    }
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   * Stores in Redis StateStore for cross-pod access
   */
  async updateTaskQueue(
    taskId: string, 
    currentTask: any, 
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): Promise<void> {
    const snapshot: TaskQueueSnapshot = {
      currentTask,
      queue,
      completedTasks,
      recursionCount: recursionCount ?? 0,
      recursionLimit: recursionLimit ?? 50
    };
    
    if (this.stateStore) {
      await this.stateStore.updateTaskQueue(taskId, snapshot);
    }
  }
  
  /**
   * Unregister task and clean up Redis state
   */
  async unregisterTask(taskId: string): Promise<void> {
    if (this.stateStore) {
      await this.stateStore.deleteTaskQueue(taskId);
    }
  }
  
  /**
   * Get Kanban data with hybrid strategy
   * 
   * Data Source Priority:
   * 1. Redis StateStore (live snapshot from running job)
   * 2. Estimating state (job running but no data yet)
   * 3. Session file (persistent state for completed/paused jobs)
   */
  async getKanbanData(
    projectId: string,
    featureName: string,
    jobType: string,
    jobToProject?: Map<string, { projectId: string; featureName: string }>,
    jobs?: Map<string, any>,
    taskQueueSnapshots?: Map<string, any>,
    userContext?: UserContext
  ): Promise<any> {
    const debug = process.env.DEBUG_KANBAN === '1';
    const dlog = (...args: any[]) => { if (debug) console.log(...args); };
    const derr = (...args: any[]) => { if (debug) console.error(...args); };
    
    // 1. Get SESSION data from file (single source of truth)
    dlog(`\n📂 [KanbanService] Loading session: ${projectId}/${featureName}/${jobType}.json`);
    
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);
    
    let sessionData: any = null;
    const safeReadSession = async (): Promise<any | null> => {
      if (!fs.existsSync(sessionPath)) return null;
      
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const raw = fs.readFileSync(sessionPath, 'utf-8');
          if (!raw || raw.trim().length === 0) {
            if (attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, 25 * attempt));
              continue;
            }
            return null;
          }
          const parsed = JSON.parse(raw);
          this.lastGoodSessionByPath.set(sessionPath, parsed);
          return parsed;
        } catch (error: any) {
          const isSyntax = error instanceof SyntaxError;
          derr(`❌ [KanbanService] Error reading session file (attempt ${attempt}/${maxAttempts}):`, error);
          if (attempt < maxAttempts && isSyntax) {
            await new Promise(r => setTimeout(r, 25 * attempt));
            continue;
          }
          const cached = this.lastGoodSessionByPath.get(sessionPath);
          if (cached) return cached;
          return null;
        }
      }
      return null;
    };
    
    try {
      sessionData = await safeReadSession();
    } catch (error) {
      derr(`❌ [KanbanService] Unexpected error in safeReadSession:`, error);
      sessionData = this.lastGoodSessionByPath.get(sessionPath) || null;
    }
    
    const sessionState = sessionData?.state || {};
    let sessionJobId = sessionState.jobId;
    const sessionTaskQueue = sessionState.taskQueue || [];
    const completedTaskIds = sessionState.completedTasks || [];
    const completedTasksDetails = sessionState.completedTasksDetails || [];
    const currentTask = sessionState.currentTask || null;
    
    // ✅ Fallback: 세션 파일에 jobId가 없으면 Redis에서 실행 중인 job 탐색
    // Planner 등 세션 파일에 jobId를 기록하지 않는 에이전트를 위한 처리
    if (!sessionJobId && this.stateStore) {
      try {
        const featureJobs = await this.stateStore.listJobsByFeature(projectId, featureName);
        const runningJob = featureJobs.find(
          j => j.status === 'running' && j.type === jobType
        );
        if (runningJob) {
          sessionJobId = runningJob.jobId;
          dlog(`   Discovered running job from Redis: ${sessionJobId} (type: ${jobType})`);
        }
      } catch (error) {
        derr(`   Failed to discover running job from Redis:`, error);
      }
    }
    
    const hasInterruption = !!sessionState.interruption;
    const hasTasksRemaining = sessionTaskQueue.length > 0 || !!currentTask;
    const isJobCompleted = !!sessionState.jobTiming?.completedAt && !hasInterruption && !hasTasksRemaining;
    
    dlog(`   Session jobId: ${sessionJobId || 'none'}`);
    dlog(`   Has interruption: ${hasInterruption}`);
    dlog(`   Job completed: ${isJobCompleted}`);
    dlog(`   Completed tasks: ${completedTasksDetails.length}`);
    
    // 2. Try to get LIVE data from Redis StateStore (if job is running)
    let liveSnapshot: TaskQueueSnapshot | null = null;
    
    // ✅ Cloud-safe: Get job status from Redis instead of local Map
    // This ensures multi-pod environments can correctly detect running jobs
    let isActuallyRunning = false;
    if (sessionJobId && this.stateStore) {
      const jobStatus = await this.stateStore.getJobStatus(sessionJobId);
      isActuallyRunning = !!jobStatus && jobStatus.status === 'running';
      dlog(`   Job status from Redis: ${jobStatus?.status || 'not found'}, isActuallyRunning: ${isActuallyRunning}`);
    } else {
      // Fallback to local jobs Map (local mode)
      const runningStatus = sessionJobId ? (jobs as any)?.get?.(sessionJobId) : undefined;
      isActuallyRunning = !!runningStatus && runningStatus.status === 'running';
    }
    
    if (sessionJobId && !isJobCompleted && isActuallyRunning && this.stateStore) {
      liveSnapshot = await this.stateStore.getTaskQueue(sessionJobId);
      if (liveSnapshot) {
        dlog(`   Found live snapshot from Redis for ${sessionJobId} (${liveSnapshot.queue?.length || 0} tasks)`);
      } else {
        dlog(`   ⏳ No live snapshot in Redis yet for jobId: ${sessionJobId}`);
      }
    }
    
    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
      ? MIN_RECURSION_LIMIT 
      : recursionLimit;
    
    // Priority 1: LIVE DATA (most recent, real-time from Redis)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && liveSnapshot) {
      const liveQueue = liveSnapshot.queue || [];
      const liveCurrentTask = liveSnapshot.currentTask || null;
      // Use currentTasks array when available (parallel execution), fall back to single currentTask
      const liveCurrentTasks = liveSnapshot.currentTasks || (liveCurrentTask ? [liveCurrentTask] : []);
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      // SPECIAL CASE: Empty snapshot with NO completed tasks = "estimating started"
      const isEstimating = liveQueue.length === 0 && liveCurrentTasks.length === 0 && liveCompletedTasks.length === 0;
      
      if (isEstimating) {
        dlog(`\n🎬 [KanbanService] ESTIMATING STARTED (empty live snapshot)`);
        
        const totalElapsedTime = this.calculateTotalElapsedTime(
          sessionState.jobTiming,
          completedTasksDetails,
          null
        );
        
        return {
          jobId: sessionJobId,
          todo: sessionTaskQueue,
          inProgress: [],
          completed: completedTasksDetails.map((detail: any) => ({
            ...detail,
            status: 'completed',
            completed: true
          })),
          isEstimating: true,
          dataSource: 'estimating',
          recursionCount: sessionState.recursionCount || 0,
          recursionLimit: sessionState.recursionLimit || finalLimit,
          totalElapsedTime,
          jobTiming: sessionState.jobTiming,
          tokenUsage: sessionState.tokenUsage,
          estimatingTokenUsage: (sessionState as any).estimatingTokenUsage,
          // Node activity banner from snapshot
          estimatingLabel: liveSnapshot.estimatingLabel,
          estimatingStartedAt: liveSnapshot.estimatingStartedAt,
          estimatingNodeId: liveSnapshot.estimatingNodeId,
        };
      }
      
      dlog(`\n🔴 [KanbanService] LIVE DATA from Redis returned\n`);
      
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        liveCompletedTasks,
        liveCurrentTask
      );
      
      return {
        jobId: sessionJobId,
        todo: liveQueue,
        inProgress: liveCurrentTasks,
        completed: liveCompletedTasks.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: false,
        dataSource: 'live',
        recursionCount: liveSnapshot.recursionCount,
        recursionLimit: liveSnapshot.recursionLimit || finalLimit,
        pausedDueToLimit: sessionState.pausedDueToLimit || false,
        tasksRemaining: sessionState.tasksRemaining || 0,
        totalElapsedTime,
        jobTiming: sessionState.jobTiming,
        tokenUsage: sessionState.tokenUsage,
        estimatingTokenUsage: (sessionState as any).estimatingTokenUsage
      };
    }
    
    // Priority 2: ESTIMATING (job running but no live snapshot yet)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && !liveSnapshot) {
      dlog(`\n🎯 [KanbanService] ESTIMATING STATE (no live snapshot yet)`);
      
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        completedTasksDetails,
        null
      );
      
      return {
        jobId: sessionJobId,
        todo: sessionTaskQueue,
        inProgress: [],
        completed: completedTasksDetails.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: true,
        dataSource: 'estimating',
        recursionCount: sessionState.recursionCount || 0,
        recursionLimit: sessionState.recursionLimit || finalLimit,
        totalElapsedTime,
        jobTiming: sessionState.jobTiming,
        tokenUsage: sessionState.tokenUsage,
        estimatingTokenUsage: (sessionState as any).estimatingTokenUsage
      };
    }
    
    // Priority 3: SESSION DATA (job completed or no session)
    dlog(`\n📁 [KanbanService] SESSION DATA returned`);
    
    const totalElapsedTime = this.calculateTotalElapsedTime(
      sessionState.jobTiming,
      completedTasksDetails,
      currentTask
    );
    
    return {
      jobId: sessionJobId,
      todo: sessionTaskQueue.filter((task: any) => 
        !completedTaskIds.includes(task.id) && 
        (!currentTask || currentTask.id !== task.id)
      ),
      inProgress: currentTask ? [currentTask] : [],
      completed: completedTasksDetails.map((detail: any) => ({
        ...detail,
        status: 'completed',
        completed: true
      })),
      isEstimating: false,
      dataSource: 'session',
      interruption: sessionState.interruption,
      recursionCount: sessionState.recursionCount,
      recursionLimit: sessionState.recursionLimit || finalLimit,
      totalElapsedTime,
      jobTiming: sessionState.jobTiming,
      tokenUsage: sessionState.tokenUsage,
      estimatingTokenUsage: (sessionState as any).estimatingTokenUsage
    };
  }
}
