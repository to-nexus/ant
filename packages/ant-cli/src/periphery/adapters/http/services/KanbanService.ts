import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * KanbanService
 * 
 * Manages Kanban board state and SSE broadcasts for real-time task tracking.
 * Implements hybrid data strategy: live memory snapshots + session file fallback.
 */
export class KanbanService {
  private readonly workspaceRoot: string;
  
  // Real-time queue tracking (direct from state, not parsed)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
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
  
  // Kanban SSE tracking - key: "projectId/featureName"
  private kanbanSSE: Map<string, Set<Response>> = new Map();
  
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
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    const isFirstUpdate = !this.taskQueueSnapshots.has(taskId);
    
    this.taskQueueSnapshots.set(taskId, { 
      currentTask, 
      queue,
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
   * Add Kanban SSE client
   */
  addSSEClient(projectId: string, featureName: string, res: Response): void {
    const key = `${projectId}/${featureName}`;
    if (!this.kanbanSSE.has(key)) {
      this.kanbanSSE.set(key, new Set());
    }
    this.kanbanSSE.get(key)!.add(res);
  }
  
  /**
   * Remove Kanban SSE client
   */
  removeSSEClient(projectId: string, featureName: string, res: Response): void {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.kanbanSSE.delete(key);
      }
    }
  }
  
  /**
   * Close all Kanban SSE connections for a project/feature
   */
  closeSSEConnections(projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const kanbanClients = this.kanbanSSE.get(key);
    if (kanbanClients) {
      kanbanClients.forEach(res => {
        try {
          res.end();
        } catch (err) {
          // Ignore errors from already closed connections
        }
      });
      this.kanbanSSE.delete(key);
    }
  }
  
  // Note: Broadcast methods are removed as they are now handled by SSEBroadcastService
  
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
    jobType: 'design' | 'code' | 'learn',  // ✅ Add job type parameter
    jobToProject?: Map<string, { projectId: string; featureName: string }>,
    jobs?: Map<string, any>,
    taskQueueSnapshots?: Map<string, any>
  ): Promise<any> {
    // Use provided data sources or fall back to service's own
    const snapshots = taskQueueSnapshots || this.taskQueueSnapshots;
    
    // 1. Find active jobId for this project/feature
    let activeJobId: string | null = null;
    if (jobToProject && jobs) {
      for (const [jobId, mapping] of jobToProject.entries()) {
        if (mapping.projectId === projectId && mapping.featureName === featureName) {
          const jobStatus = jobs.get(jobId);
          
          // Check for both 'pending' and 'running' states
          if (jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'pending')) {
            activeJobId = jobId;
            break;
          }
        }
      }
    }
    
    // 2. Try to get LIVE data from memory snapshot
    let liveSnapshot = null;
    if (activeJobId) {
      liveSnapshot = snapshots.get(activeJobId);
      const taskCount = liveSnapshot?.queue?.length || 0;
      console.log(`🔍 [KanbanService] Active job: ${activeJobId} (${projectId}/${featureName}, ${taskCount} tasks)`);
    } else if (jobToProject && jobs) {
      console.log(`❌ [KanbanService] No active job (${projectId}/${featureName})`);
    } else {
      console.log(`⚠️  [KanbanService] Missing job tracking data`);
    }
    
    // 3. Get SESSION data from file
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      `sessions/${jobType}.json`  // ✅ Use job-specific session file
    );
    
    let sessionData: any = null;
    try {
      if (fs.existsSync(sessionPath)) {
        sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      }
    } catch (error) {
      console.error(`[Kanban] Error reading session file:`, error);
    }
    
    const sessionState = sessionData?.state || {};
    const sessionTaskQueue = sessionState.taskQueue || [];
    const completedTaskIds = sessionState.completedTasks || [];
    const completedTasksDetails = sessionState.completedTasksDetails || [];
    const currentTask = sessionState.currentTask || null;
    
    // 4. Determine state and build Kanban data
    
    // ✅ DEBUG: Log ALL decision factors with snapshot details
    if (liveSnapshot) {
    }
    
    // Priority 1: LIVE DATA (most recent, real-time)
    if (activeJobId && liveSnapshot) {
      const liveQueue = liveSnapshot.queue || [];
      const liveCurrentTask = liveSnapshot.currentTask || null;
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      // ✅ SPECIAL CASE: Empty snapshot = "estimating started" signal
      // If queue is empty and no current task → still estimating (decompose in progress)
      // Note: We don't check liveCompletedTasks because during resume, tasks may already be completed
      if (liveQueue.length === 0 && !liveCurrentTask) {
        console.log(`\n🎬 [KanbanService] ESTIMATING STARTED (empty live snapshot)`);
        console.log(`   Preserving completed tasks from session: ${completedTasksDetails.length}\n`);
        
        // Read recursion limit from session or environment variable
        const MINIMUM_RECURSION_LIMIT = 5;
        const DEFAULT_RECURSION_LIMIT = 50;
        const envLimit = parseInt(process.env.RECURSION_LIMIT || String(DEFAULT_RECURSION_LIMIT), 10);
        const finalLimit = isNaN(envLimit) || envLimit < 1 
          ? DEFAULT_RECURSION_LIMIT 
          : envLimit < MINIMUM_RECURSION_LIMIT 
            ? MINIMUM_RECURSION_LIMIT 
            : envLimit;
        
        // Calculate total elapsed time
        const totalElapsedTime = this.calculateTotalElapsedTime(
          sessionState.jobTiming,
          completedTasksDetails,
          null // No current task during estimating
        );
        
        console.log(`⏱️  [KanbanService] Estimating started - Time calculation:`, {
          totalElapsedTime,
          hasJobTiming: !!sessionState.jobTiming,
          jobTimingStartedAt: sessionState.jobTiming?.startedAt,
          estimatingDuration: sessionState.jobTiming?.estimatingDuration
        });
        
        return {
          todo: sessionTaskQueue,
          inProgress: null,
          completed: completedTasksDetails.map((detail: any) => ({
            ...detail,
            status: 'completed',
            completed: true
          })),
          isEstimating: true,
          dataSource: 'estimating',
          activeJobId,
          recursionCount: sessionState.recursionCount || 0,
          recursionLimit: sessionState.recursionLimit || finalLimit,
          totalElapsedTime,
          jobTiming: sessionState.jobTiming
        };
      }
      
      console.log(`\n🔴 [KanbanService] LIVE DATA returned\n`);
      
      // Calculate total elapsed time using live data
      const totalElapsedTime = this.calculateTotalElapsedTime(
        sessionState.jobTiming,
        liveCompletedTasks,
        liveCurrentTask
      );
      
      return {
        todo: liveQueue,
        inProgress: liveCurrentTask,
        completed: liveCompletedTasks.map((detail: any) => ({
          ...detail,
          status: 'completed',
          completed: true
        })),
        isEstimating: false,
        dataSource: 'live',
        activeJobId,  // ✅ Pass job ID to UI for state restoration
        recursionCount: liveSnapshot.recursionCount,
        recursionLimit: liveSnapshot.recursionLimit,
        pausedDueToLimit: sessionState.pausedDueToLimit || false,  // From session (live doesn't track pause state)
        tasksRemaining: sessionState.tasksRemaining || 0,
        totalElapsedTime,
        jobTiming: sessionState.jobTiming
      };
    }
    
    // Priority 2: ESTIMATING (job running but no data yet)
    // ✅ FIX: If job is active but no live snapshot exists, it MUST be estimating!
    //         Don't check session data - that's stale from previous run.
    if (activeJobId && !liveSnapshot) {
      console.log(`\n🎯 [KanbanService] ESTIMATING STATE DETECTED!`);
      console.log(`   activeJobId: ${activeJobId}`);
      console.log(`   liveSnapshot: ${liveSnapshot}`);
      console.log(`   → Returning isEstimating: true\n`);
      
      // Read recursion limit from session or environment variable
      const MINIMUM_RECURSION_LIMIT = 5;
      const DEFAULT_RECURSION_LIMIT = 50;
      const envLimit = parseInt(process.env.RECURSION_LIMIT || String(DEFAULT_RECURSION_LIMIT), 10);
      const finalLimit = isNaN(envLimit) || envLimit < 1 
        ? DEFAULT_RECURSION_LIMIT 
        : envLimit < MINIMUM_RECURSION_LIMIT 
          ? MINIMUM_RECURSION_LIMIT 
          : envLimit;
      
        // Calculate total elapsed time
        const totalElapsedTime = this.calculateTotalElapsedTime(
          sessionState.jobTiming,
          completedTasksDetails,
          null // No current task during estimating
        );
        
        return {
          // FIX: estimating 상태에서도 sessionTaskQueue를 todo로 내려줌
          todo: sessionTaskQueue,
          inProgress: null,
          completed: completedTasksDetails.map((detail: any) => ({
            ...detail,
            status: 'completed',
            completed: true
          })),
          isEstimating: true,
          dataSource: 'estimating',
          activeJobId,  // ✅ Pass job ID to UI for state restoration
          recursionCount: sessionState.recursionCount || 0,
          recursionLimit: sessionState.recursionLimit || finalLimit,
          totalElapsedTime,
          jobTiming: sessionState.jobTiming
        };
    }
    
    // Priority 3: SESSION DATA (job running but live data not ready yet, OR job completed)
    console.log(`\n📁 [KanbanService] SESSION DATA returned (fallback)`);
    console.log(`   Completed tasks in session: ${completedTasksDetails.length}`);
    console.log(`   Has interruption: ${!!sessionState.interruption}`);
    console.log(`   Interruption reason: ${sessionState.interruption?.reason || 'none'}\n`);
    
    // Calculate total elapsed time using session data
    const totalElapsedTime = this.calculateTotalElapsedTime(
      sessionState.jobTiming,
      completedTasksDetails,
      currentTask
    );
    
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
      interruption: sessionState.interruption,  // ✅ Include interruption details
      recursionCount: sessionState.recursionCount,
      recursionLimit: sessionState.recursionLimit,
      totalElapsedTime,
      jobTiming: sessionState.jobTiming
    };
  }
}


