import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../core/types/user';
import { StateStorePort } from '../../../../core/ports/stateStore';
import type { TaskQueueSnapshot, KanbanData } from '../../../../core/types/task';
import type { SessionState } from '../../../../core/types/session';
import { getSessionFilePathByJob, getAgentForJobSafe } from '../../../../core/utils/sessionPaths';

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
    jobType: 'design' | 'code' | 'learn' | 'plan'
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
    try {
      sessionData = await this.safeReadSession(sessionPath);
    } catch (error) {
      derr(`❌ [KanbanService] Unexpected error in safeReadSession:`, error);
      sessionData = this.lastGoodSessionByPath.get(sessionPath) || null;
    }
    
    const sessionState: Partial<SessionState> = sessionData?.state || {};
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

      // Fetch live snapshot BEFORE stale check — a live snapshot in Redis
      // proves the worker is actively writing, regardless of how long ago
      // the job started.
      if (isActuallyRunning && !isJobCompleted) {
        liveSnapshot = await this.stateStore.getTaskQueue(sessionJobId);
        if (liveSnapshot) {
          dlog(`   Found live snapshot from Redis for ${sessionJobId} (${liveSnapshot.queue?.length || 0} tasks)`);
        } else {
          dlog(`   ⏳ No live snapshot in Redis yet for jobId: ${sessionJobId}`);
        }
      }

      // Defensive staleness check: only when NO live snapshot exists.
      // If there's a live snapshot, the worker is clearly active.
      // Without a snapshot, a job that started > STALE_THRESHOLD ago is likely
      // a crashed process that StaleJobRecovery hasn't cleaned up yet.
      if (isActuallyRunning && !liveSnapshot && jobStatus) {
        const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 min (lockDuration 30s + stalledInterval 30s + buffer)
        const refTime = jobStatus.startedAt || jobStatus.timestamp;
        if (refTime) {
          const elapsed = Date.now() - new Date(refTime).getTime();
          if (elapsed > STALE_THRESHOLD_MS) {
            dlog(`   ⚠️ Job ${sessionJobId} looks stale (running for ${Math.round(elapsed / 60000)}min, no live snapshot), treating as not running`);
            isActuallyRunning = false;
          }
        }
      }

      dlog(`   Job status from Redis: ${jobStatus?.status || 'not found'}, isActuallyRunning: ${isActuallyRunning}`);
    } else {
      // Fallback to local jobs Map (local mode)
      const runningStatus = sessionJobId ? (jobs as any)?.get?.(sessionJobId) : undefined;
      isActuallyRunning = !!runningStatus && runningStatus.status === 'running';
    }
    
    // (liveSnapshot already fetched above when stateStore is available)
    
    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
      ? 200 
      : recursionLimit;
    
    // Priority 1: LIVE DATA (most recent, real-time from Redis)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && liveSnapshot) {
      const liveQueue = liveSnapshot.queue || [];
      const liveCurrentTask = liveSnapshot.currentTask || null;
      // Use currentTasks array when available (parallel execution), fall back to single currentTask
      const liveCurrentTasks = liveSnapshot.currentTasks || (liveCurrentTask ? [liveCurrentTask] : []);
      const liveCompletedTasks = liveSnapshot.completedTasks || [];
      
      // Estimating = node activity banner is active (explicit signal from KanbanBroadcaster).
      // Previously checked array-emptiness, but setEstimatingActivity now preserves
      // completedTasks in the snapshot, so emptiness alone is no longer reliable.
      const isEstimating = !!liveSnapshot.estimatingLabel;
      
      if (isEstimating && liveCurrentTasks.length === 0 && liveQueue.length === 0) {
        // Use live completedTasks if available (preserved by setEstimatingActivity),
        // fall back to session for backward compatibility with old snapshots.
        const estimatingCompleted = liveCompletedTasks.length > 0 ? liveCompletedTasks : completedTasksDetails;
        // When live completed tasks exist, remaining session todo excludes them.
        const estimatingTodo = liveCompletedTasks.length > 0
          ? sessionTaskQueue.filter((task: any) => !liveCompletedTasks.some((c: any) => c.id === task.id))
          : sessionTaskQueue;
        
        const result = {
          jobId: sessionJobId,
          todo: estimatingTodo,
          inProgress: [],
          completed: estimatingCompleted.map((detail: any) => ({
            ...detail,
            status: 'completed',
            completed: true
          })),
          isEstimating: true,
          dataSource: 'estimating' as const,
          recursionCount: sessionState.recursionCount || 0,
          recursionLimit: sessionState.recursionLimit || finalLimit,
          jobTiming: liveSnapshot.jobTiming ?? sessionState.jobTiming,
          tokenUsage: liveSnapshot.tokenUsage ?? sessionState.tokenUsage,
          estimatingTokenUsage: liveSnapshot.estimatingTokenUsage ?? sessionState.estimatingTokenUsage,
          estimatingLabel: liveSnapshot.estimatingLabel,
          estimatingStartedAt: liveSnapshot.estimatingStartedAt,
          estimatingNodeId: liveSnapshot.estimatingNodeId,
          jobType,
          agent: getAgentForJobSafe(jobType),
        };
        dlog(`\n🎬 [KanbanService] ESTIMATING STARTED (estimatingLabel=${liveSnapshot.estimatingLabel})`);
        console.log(`[KanbanService] RETURN path=ESTIMATING jobId=${sessionJobId} todo=${result.todo.length} ip=0 done=${result.completed.length} ds=estimating`);
        return result;
      }
      
      dlog(`\n🔴 [KanbanService] LIVE DATA from Redis returned\n`);
      console.log(`[KanbanService] RETURN path=LIVE jobId=${sessionJobId} todo=${liveQueue.length} ip=${liveCurrentTasks.length} done=${liveCompletedTasks.length} ds=live`);
      
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
        pausedDueToLimit: sessionState.interruption?.reason === 'recursion_limit',
        tasksRemaining: sessionState.interruption?.metadata?.tasksRemaining || 0,
        jobTiming: liveSnapshot.jobTiming ?? sessionState.jobTiming,
        tokenUsage: liveSnapshot.tokenUsage ?? sessionState.tokenUsage,
        estimatingTokenUsage: liveSnapshot.estimatingTokenUsage ?? sessionState.estimatingTokenUsage,
        jobType,
        agent: getAgentForJobSafe(jobType),
      };
    }
    
    // Priority 2: ESTIMATING (job running but no live snapshot yet)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && !liveSnapshot) {
      dlog(`\n🎯 [KanbanService] ESTIMATING STATE (no live snapshot yet)`);
      console.log(`[KanbanService] RETURN path=ESTIMATING_NO_SNAPSHOT jobId=${sessionJobId} todo=${sessionTaskQueue.length} ip=0 done=${completedTasksDetails.length} ds=estimating`);
      
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
        jobTiming: sessionState.jobTiming,
        tokenUsage: sessionState.tokenUsage,
        estimatingTokenUsage: sessionState.estimatingTokenUsage,
        estimatingLabel: sessionState.estimatingLabel,
        estimatingStartedAt: sessionState.estimatingStartedAt,
        estimatingNodeId: sessionState.estimatingNodeId,
        jobType,
        agent: getAgentForJobSafe(jobType),
      };
    }
    
    // Priority 3: SESSION DATA (job completed or no session)
    return this.buildSessionKanbanData(sessionData, sessionJobId, jobType, isActuallyRunning);
  }

  /**
   * Build a SESSION-mode KanbanData payload from a session file's state.
   *
   * Single source of truth for `dataSource: 'session'` projection — used by
   * `getKanbanData`'s Priority 3 fall-through and by
   * `getFinalSnapshotKanbanData` (lifecycle finalize/pause broadcast).
   * Pure derivation from `sessionData`, no Redis access.
   */
  private buildSessionKanbanData(
    sessionData: any,
    sessionJobId: string | undefined,
    jobType: string,
    isActuallyRunning: boolean,
  ): any {
    const sessionState: Partial<SessionState> = sessionData?.state || {};
    const sessionTaskQueue = sessionState.taskQueue || [];
    const completedTaskIds = sessionState.completedTasks || [];
    const completedTasksDetails = sessionState.completedTasksDetails || [];
    const currentTask = sessionState.currentTask || null;
    // Parallel mode: in-flight workers persist tasks under `runningTasks`
    // (separate from `taskQueue`) without defensive marking. Tasks here
    // carry `interrupted:true` only when a real interrupt event stamped them
    // (handleInterruption → captureWorkerSnapshots). Split per-task by that
    // flag so:
    //   - Marked running tasks (graceful stop in progress) render in `todo`
    //     and TaskCard surfaces the Paused badge — matches the UX of tasks
    //     that already moved to `taskQueue` via reportStopped.
    //   - Unmarked running tasks (job actively running, periodic checkpoint)
    //     render in `inProgress` so a page refresh during normal run does
    //     not show "Paused".
    // Hard-kill orphans never reach this branch unmarked — JobCleanupManager
    // projects them into `taskQueue` with marks at cleanup time.
    const sessionRunningTasks: any[] = (sessionState as any).runningTasks || [];
    const runningPaused = sessionRunningTasks.filter((t: any) => t?.interrupted === true);
    const runningLive = sessionRunningTasks.filter((t: any) => t?.interrupted !== true);
    const runningIds = new Set<string>([
      ...(currentTask ? [currentTask.id] : []),
      ...sessionRunningTasks.map((t: any) => t.id),
    ]);

    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT)
      ? 200
      : recursionLimit;

    const inProgress = currentTask
      ? [currentTask, ...runningLive]
      : runningLive;

    console.log(`[KanbanService] RETURN path=SESSION jobId=${sessionJobId ?? 'none'} todo=${sessionTaskQueue.length + runningPaused.length} ip=${inProgress.length} done=${completedTasksDetails.length} ds=session isRunning=${isActuallyRunning}`);

    return {
      jobId: sessionJobId,
      todo: [
        ...runningPaused,
        ...sessionTaskQueue.filter((task: any) =>
          !completedTaskIds.includes(task.id) &&
          !runningIds.has(task.id)
        ),
      ],
      inProgress,
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
      jobTiming: sessionState.jobTiming,
      tokenUsage: sessionState.tokenUsage,
      estimatingTokenUsage: sessionState.estimatingTokenUsage,
      jobType,
      agent: getAgentForJobSafe(jobType),
    };
  }

  /**
   * Build a final-snapshot KanbanData payload for lifecycle broadcast
   * (`finalizeTerminalJob` → `cleanupJobState` → `broadcastFinalUpdate`).
   *
   * Why a dedicated entry point: at broadcast time the Redis job status
   * may still be `running` (updateJobStatus runs after cleanupJobState)
   * and the live taskQueue may still exist (sealJobRedisState runs even
   * later), which would steer `getKanbanData` into its LIVE / ESTIMATING
   * branches and publish stale "in-progress" tasks. cleanupJobState has
   * already projected Redis checkpoint into the session file and written
   * it atomically, so the session file IS the final state and must be
   * the SSOT for the broadcast — regardless of Redis state at the moment.
   *
   * Mirrors `getKanbanData`'s signature so call sites swap one method
   * for the other without rewiring arguments. The `jobToProject` /
   * `jobs` / `taskQueueSnapshots` parameters are accepted for signature
   * symmetry but unused here (final snapshot derives only from disk).
   */
  async getFinalSnapshotKanbanData(
    projectId: string,
    featureName: string,
    jobType: string,
    _jobToProject?: Map<string, { projectId: string; featureName: string }>,
    _jobs?: Map<string, any>,
    _taskQueueSnapshots?: Map<string, any>,
    userContext?: UserContext,
  ): Promise<any> {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);

    const sessionData = await this.safeReadSession(sessionPath);
    const sessionJobId: string | undefined = sessionData?.state?.jobId;

    // isActuallyRunning is forced false: by the time finalize/pauseJob
    // calls this, the job is logically terminal even if the Redis status
    // write hasn't landed yet. The flag only feeds the diagnostic log.
    return this.buildSessionKanbanData(sessionData, sessionJobId, jobType, false);
  }

  /**
   * Read the session file with a small retry loop and last-known-good
   * fallback. Extracted so both `getKanbanData` and
   * `getFinalSnapshotKanbanData` share one I/O policy.
   */
  private async safeReadSession(sessionPath: string): Promise<any | null> {
    const debug = process.env.DEBUG_KANBAN === '1';
    const derr = (...args: any[]) => { if (debug) console.error(...args); };

    try {
      await fs.promises.access(sessionPath);
    } catch {
      return null;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const raw = await fs.promises.readFile(sessionPath, 'utf-8');
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
  }
}
