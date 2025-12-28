import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../core/types/user';

/**
 * KanbanService
 * 
 * Manages Kanban board state for real-time task tracking.
 * Implements hybrid data strategy: live memory snapshots + session file fallback.
 */
export class KanbanService {
  private readonly workspaceRoot: string;
  private readonly workspaceResolver?: WorkspaceResolver;
  
  // ✅ Last-known-good session cache to survive partial writes (0-byte / truncated JSON)
  // Keyed by absolute sessionPath.
  private lastGoodSessionByPath: Map<string, any> = new Map();
  
  // Real-time queue tracking (direct from state, not parsed)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
    completedTasks: any[];
    recursionCount?: number;
    recursionLimit?: number;
  }> = new Map();
  
  /**
   * Calculate total elapsed time for a job
   * 
   * Formula:
   * totalElapsedTime = estimatingDuration + completedTasksTime + currentTaskTime - totalPausedDuration
   * 
   * @returns elapsed time in milliseconds
   */
  private calculateTotalElapsedTime(
    jobTiming: any | undefined,
    completedTasksDetails: any[],
    currentTask: any | null
  ): number {
    if (!jobTiming) {
      // This is noisy and not actionable during normal operation; keep it behind DEBUG_KANBAN.
      if (process.env.DEBUG_KANBAN === '1') {
        console.warn(`⚠️  [KanbanService] calculateTotalElapsedTime: No jobTiming data!`);
        console.warn(`   This indicates the job was started before jobTiming was implemented.`);
        console.warn(`   Please restart the job to track timing correctly.`);
      }
      return 0;
    }
    
    let totalElapsed = 0;
    
    // 1. Add estimating duration
    if (jobTiming.estimatingDuration) {
      totalElapsed += jobTiming.estimatingDuration;
    }
    
    // 2. Add completed tasks elapsed time
    let completedTasksTime = 0;
    for (const task of completedTasksDetails) {
      if (task.timing?.elapsedTime) {
        completedTasksTime += task.timing.elapsedTime;
        totalElapsed += task.timing.elapsedTime;
      } else if (task.elapsedTime) {
        // Fallback: elapsedTime might be at root level
        completedTasksTime += task.elapsedTime;
        totalElapsed += task.elapsedTime;
      }
    }
    
    // 3. Add current task elapsed time (if in progress)
    if (currentTask?.timing?.startedAt) {
      const currentTaskStartTime = new Date(currentTask.timing.startedAt).getTime();
      const currentTaskElapsed = Date.now() - currentTaskStartTime - (currentTask.timing.totalPausedDuration || 0);
      totalElapsed += currentTaskElapsed;
    } 
    // ❌ REMOVED: Don't subtract jobTiming.totalPausedDuration again!
    // Why: completedTasksDetails[].elapsedTime already excludes pause time
    // and currentTask calculation above also excludes pause time.
    // Subtracting jobTiming.totalPausedDuration here causes DOUBLE DEDUCTION
    // and makes totalElapsed go negative → reset to 0 → UI shows 0s!
    
    return Math.max(0, totalElapsed); // Never return negative
  }
  
  // Task to project/feature mapping
  private taskToProject: Map<string, { projectId: string; featureName: string }> = new Map();
  
  constructor(workspaceRoot: string, workspaceResolver?: WorkspaceResolver) {
    this.workspaceRoot = workspaceRoot;
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   * This provides real-time queue data without parsing logs
   * Note: Broadcasting is now handled by SSEBroadcastService through ExpressServerAdapter
   */
  updateTaskQueue(
    taskId: string, 
    currentTask: any, 
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    const isFirstUpdate = !this.taskQueueSnapshots.has(taskId);
    
    this.taskQueueSnapshots.set(taskId, { 
      currentTask, 
      queue,
      completedTasks,  // ✅ CRITICAL: Store completedTasks in snapshot
      recursionCount,
      recursionLimit
    });
    
    if (isFirstUpdate) {
    } else {
    }
  }
  
  /**
   * Register task to project/feature mapping
   */
  registerTask(taskId: string, projectId: string, featureName: string): void {
    this.taskToProject.set(taskId, { projectId, featureName });
  }
  
  /**
   * Unregister task mapping
   */
  unregisterTask(taskId: string): void {
    this.taskToProject.delete(taskId);
    this.taskQueueSnapshots.delete(taskId);
  }
  
  /**
   * Get Kanban data with hybrid strategy
   * 
   * Data Source Priority:
   * 1. Live snapshot (real-time memory state from running job)
   * 2. Estimating state (job running but no data yet)
   * 3. Session file (persistent state for completed/paused jobs)
   */
  async getKanbanData(
    projectId: string,
    featureName: string,
    jobType: 'design' | 'code' | 'learn',
    jobToProject?: Map<string, { projectId: string; featureName: string }>,
    jobs?: Map<string, any>,
    taskQueueSnapshots?: Map<string, any>,
    userContext?: UserContext
  ): Promise<any> {
    const debug = process.env.DEBUG_KANBAN === '1';
    const dlog = (...args: any[]) => {
      if (debug) console.log(...args);
    };
    const derr = (...args: any[]) => {
      if (debug) console.error(...args);
    };
    const snapshots = taskQueueSnapshots || this.taskQueueSnapshots;
    
    // 1. Get SESSION data from file (single source of truth)
    dlog(`\n📂 [KanbanService] Loading session: ${projectId}/${featureName}/${jobType}.json`);
    
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    // ✅ Use WorkspaceResolver for proper path resolution
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = `${featurePath}/sessions/${jobType}.json`;
    
    let sessionData: any = null;
    // ✅ Robust session read: tolerate transient partial writes (e.g., writer truncates then rewrites)
    // - retry a few times with short backoff
    // - fall back to last-known-good cache to avoid UI dropping to empty
    const safeReadSession = async (): Promise<any | null> => {
      if (!fs.existsSync(sessionPath)) return null;
      
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const raw = fs.readFileSync(sessionPath, 'utf-8');
          if (!raw || raw.trim().length === 0) {
            // empty file (writer in progress) → retry
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
    const sessionJobId = sessionState.jobId;
    const sessionTaskQueue = sessionState.taskQueue || [];
    const completedTaskIds = sessionState.completedTasks || [];
    const completedTasksDetails = sessionState.completedTasksDetails || [];
    const currentTask = sessionState.currentTask || null;
    
    // ✅ CRITICAL: Job is completed ONLY if:
    // 1. Has completedAt timestamp
    // 2. No interruption (user_stopped, recursion_limit, etc.)
    // 3. Task queue is empty (all work done)
    const hasInterruption = !!sessionState.interruption;
    const hasTasksRemaining = sessionTaskQueue.length > 0 || !!currentTask;
    const isJobCompleted = !!sessionState.jobTiming?.completedAt && !hasInterruption && !hasTasksRemaining;
    
    dlog(`   Session jobId: ${sessionJobId || 'none'}`);
    dlog(`   Has interruption: ${hasInterruption}`);
    dlog(`   Job completed: ${isJobCompleted}`);
    dlog(`   Completed tasks: ${completedTasksDetails.length}`);
    
    // 2. Try to get LIVE data from memory snapshot (if job is running)
    let liveSnapshot = null;
    const runningStatus = sessionJobId ? (jobs as any)?.get?.(sessionJobId) : undefined;
    const isActuallyRunning = !!runningStatus && runningStatus.status === 'running';
    
    // ✅ Use live snapshots ONLY when the job is actually running.
    // This fixes:
    // - Stop 후 stale snapshot으로 inProgress가 남는 문제
    // - Resume/Continue 후 session.interruption이 남아도 running UI(Stop 버튼/진행상태)가 떠야 하는 문제
    if (sessionJobId && !isJobCompleted && isActuallyRunning) {
      liveSnapshot = snapshots.get(sessionJobId);
      if (liveSnapshot) {
        const taskCount = liveSnapshot?.queue?.length || 0;
        dlog(`   Found live snapshot for ${sessionJobId} (${taskCount} tasks)`);
      } else {
        dlog(`   ⏳ No live snapshot yet for jobId: ${sessionJobId}`);
        dlog(`   📋 Available snapshot keys: ${Array.from(snapshots.keys()).join(', ')}`);
      }
    }
    
    // Priority 1: LIVE DATA (most recent, real-time)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && liveSnapshot) {
      const liveQueue = liveSnapshot.queue || [];
      const liveCurrentTask = liveSnapshot.currentTask || null;
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      // ✅ SPECIAL CASE: Empty snapshot with NO completed tasks = "estimating started"
      // Distinguish between:
      // 1. Estimating: queue=0, currentTask=null, completedTasks=0 (decompose in progress)
      // 2. All done: queue=0, currentTask=null, completedTasks>0 (work finished, going to learn)
      const isEstimating = liveQueue.length === 0 && !liveCurrentTask && liveCompletedTasks.length === 0;
      
      if (isEstimating) {
        dlog(`\n🎬 [KanbanService] ESTIMATING STARTED (empty live snapshot, no completed tasks)`);
        dlog(`   Preserving completed tasks from session: ${completedTasksDetails.length}\n`);
        
        const MIN_RECURSION_LIMIT = 5;
        const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
        const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
          ? MIN_RECURSION_LIMIT 
          : recursionLimit;
        
        const totalElapsedTime = this.calculateTotalElapsedTime(
          sessionState.jobTiming,
          completedTasksDetails,
          null
        );
        
        return {
          jobId: sessionJobId,
          todo: sessionTaskQueue,
          inProgress: null,
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
          tokenUsage: sessionState.tokenUsage
        };
      }
      
      dlog(`\n🔴 [KanbanService] LIVE DATA returned\n`);
      
      // ✅ Read recursion limit from environment variable (same as other branches)
      const MIN_RECURSION_LIMIT = 5;
      const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
      const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
        ? MIN_RECURSION_LIMIT 
        : recursionLimit;
      
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        liveCompletedTasks,
        liveCurrentTask
      );
      
      const result = {
        jobId: sessionJobId,
        todo: liveQueue,
        inProgress: liveCurrentTask,
        completed: liveCompletedTasks.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: false,
        dataSource: 'live',
        recursionCount: liveSnapshot.recursionCount,
        recursionLimit: liveSnapshot.recursionLimit || finalLimit,  // ✅ FIXED: Fallback to env var if not in snapshot
        pausedDueToLimit: sessionState.pausedDueToLimit || false,
        tasksRemaining: sessionState.tasksRemaining || 0,
        totalElapsedTime,
        jobTiming: sessionState.jobTiming,
        tokenUsage: sessionState.tokenUsage
      };
      dlog(`[KanbanService] 🔍 LIVE DATA recursionLimit: ${result.recursionLimit} (snapshot: ${liveSnapshot.recursionLimit}, env: ${finalLimit}, raw env: ${process.env.RECURSION_LIMIT})`);
      return result;
    }
    
    // Priority 2: ESTIMATING (job running but no live snapshot yet)
    // ✅ If job is running, show estimating even if session still has interruption.
    // (Interruption will be cleared/updated later; UI must allow Stop immediately.)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && !liveSnapshot) {
      dlog(`\n🎯 [KanbanService] ESTIMATING STATE (no live snapshot yet)`);
      
      const MIN_RECURSION_LIMIT = 5;
      const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
      const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
        ? MIN_RECURSION_LIMIT 
        : recursionLimit;
      
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        completedTasksDetails,
        null
      );
      
      return {
        jobId: sessionJobId,
        todo: sessionTaskQueue,
        inProgress: null,
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
        tokenUsage: sessionState.tokenUsage
      };
    }
    
    // Priority 3: SESSION DATA (job completed or no session)
    dlog(`\n📁 [KanbanService] SESSION DATA returned`);
    dlog(`   Session jobId: ${sessionJobId || 'MISSING!'}`);
    dlog(`   Job completed: ${isJobCompleted}`);
    dlog(`   Completed tasks: ${completedTasksDetails.length}`);
    dlog(`   Has interruption: ${!!sessionState.interruption}`);
    dlog(`   Interruption reason: ${sessionState.interruption?.reason || 'none'}\n`);
    
    // ✅ Read recursion limit from environment variable (same as other branches)
    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
      ? MIN_RECURSION_LIMIT 
      : recursionLimit;
    
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
      inProgress: currentTask,
      completed: completedTasksDetails.map((detail: any) => ({
        ...detail,
        status: 'completed',
        completed: true
      })),
      isEstimating: false,
      dataSource: 'session',
      interruption: sessionState.interruption,
      recursionCount: sessionState.recursionCount,
      recursionLimit: sessionState.recursionLimit || finalLimit,  // ✅ FIXED: Fallback to env var
      totalElapsedTime,
      jobTiming: sessionState.jobTiming,
      tokenUsage: sessionState.tokenUsage
    };
  }
}


