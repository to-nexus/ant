import * as fs from 'fs';
import * as path from 'path';

/**
 * KanbanService
 * 
 * Manages Kanban board state for real-time task tracking.
 * Implements hybrid data strategy: live memory snapshots + session file fallback.
 */
export class KanbanService {
  private readonly workspaceRoot: string;
  
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
      console.warn(`⚠️  [KanbanService] calculateTotalElapsedTime: No jobTiming data!`);
      console.warn(`   This indicates the job was started before jobTiming was implemented.`);
      console.warn(`   Please restart the job to track timing correctly.`);
      return 0;
    }
    
    let totalElapsed = 0;
    
    // 1. Add estimating duration
    if (jobTiming.estimatingDuration) {
      totalElapsed += jobTiming.estimatingDuration;
    }
    
    // 2. Add completed tasks elapsed time
    for (const task of completedTasksDetails) {
      if (task.elapsedTime) {
        totalElapsed += task.elapsedTime;
      }
    }
    
    // 3. Add current task elapsed time (if in progress)
    if (currentTask?.timing?.startedAt) {
      const currentTaskStartTime = new Date(currentTask.timing.startedAt).getTime();
      const currentTaskElapsed = Date.now() - currentTaskStartTime - (currentTask.timing.totalPausedDuration || 0);
      totalElapsed += currentTaskElapsed;
    }
    
    // 4. Subtract total paused duration
    if (jobTiming.totalPausedDuration) {
      totalElapsed -= jobTiming.totalPausedDuration;
    }
    
    return Math.max(0, totalElapsed); // Never return negative
  }
  
  // Task to project/feature mapping
  private taskToProject: Map<string, { projectId: string; featureName: string }> = new Map();
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
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
    taskQueueSnapshots?: Map<string, any>
  ): Promise<any> {
    const snapshots = taskQueueSnapshots || this.taskQueueSnapshots;
    
    // 1. Get SESSION data from file (single source of truth)
    console.log(`\n📂 [KanbanService] Loading session: ${projectId}/${featureName}/${jobType}.json`);
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${jobType}.json`
    );
    
    let sessionData: any = null;
    try {
      if (fs.existsSync(sessionPath)) {
        sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      }
    } catch (error) {
      console.error(`❌ [KanbanService] Error reading session file:`, error);
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
    
    console.log(`   Session jobId: ${sessionJobId || 'none'}`);
    console.log(`   Has interruption: ${hasInterruption}`);
    console.log(`   Job completed: ${isJobCompleted}`);
    console.log(`   Completed tasks: ${completedTasksDetails.length}`);
    
    // 2. Try to get LIVE data from memory snapshot (if job is running)
    let liveSnapshot = null;
    if (sessionJobId && !isJobCompleted) {
      liveSnapshot = snapshots.get(sessionJobId);
      if (liveSnapshot) {
        const taskCount = liveSnapshot?.queue?.length || 0;
        console.log(`   ✅ Found live snapshot for ${sessionJobId} (${taskCount} tasks)`);
      } else {
        console.log(`   ⏳ No live snapshot yet for jobId: ${sessionJobId}`);
        console.log(`   📋 Available snapshot keys: ${Array.from(snapshots.keys()).join(', ')}`);
      }
    }
    
    // Priority 1: LIVE DATA (most recent, real-time)
    if (sessionJobId && !isJobCompleted && liveSnapshot) {
      const liveQueue = liveSnapshot.queue || [];
      const liveCurrentTask = liveSnapshot.currentTask || null;
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      // ✅ SPECIAL CASE: Empty snapshot = "estimating started" signal
      // If queue is empty and no current task → still estimating (decompose in progress)
      if (liveQueue.length === 0 && !liveCurrentTask) {
        console.log(`\n🎬 [KanbanService] ESTIMATING STARTED (empty live snapshot)`);
        console.log(`   Preserving completed tasks from session: ${completedTasksDetails.length}\n`);
        
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
          jobTiming: sessionState.jobTiming
        };
      }
      
      console.log(`\n🔴 [KanbanService] LIVE DATA returned\n`);
      
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        liveCompletedTasks,
        liveCurrentTask
      );
      
      return {
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
        recursionLimit: liveSnapshot.recursionLimit,
        pausedDueToLimit: sessionState.pausedDueToLimit || false,
        tasksRemaining: sessionState.tasksRemaining || 0,
        totalElapsedTime,
        jobTiming: sessionState.jobTiming
      };
    }
    
    // Priority 2: ESTIMATING (job running but no live snapshot yet)
    // ✅ CRITICAL: Skip ESTIMATING if job has any interruption (stopped/paused/failed)
    if (sessionJobId && !isJobCompleted && !liveSnapshot && !hasInterruption) {
      console.log(`\n🎯 [KanbanService] ESTIMATING STATE (no live snapshot yet)`);
      
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
        jobTiming: sessionState.jobTiming
      };
    }
    
    // Priority 3: SESSION DATA (job completed or no session)
    console.log(`\n📁 [KanbanService] SESSION DATA returned`);
    console.log(`   Session jobId: ${sessionJobId || 'MISSING!'}`);
    console.log(`   Job completed: ${isJobCompleted}`);
    console.log(`   Completed tasks: ${completedTasksDetails.length}`);
    console.log(`   Has interruption: ${!!sessionState.interruption}`);
    console.log(`   Interruption reason: ${sessionState.interruption?.reason || 'none'}\n`);
    
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
      recursionLimit: sessionState.recursionLimit,
      totalElapsedTime,
      jobTiming: sessionState.jobTiming
    };
  }
}


