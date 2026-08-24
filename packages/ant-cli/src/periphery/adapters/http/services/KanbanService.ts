import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver, WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../core/types/user';
import { toBaseRelative, readTextContainedBase } from '../../../../core/config/containedIo';
import { StateStorePort } from '../../../../core/ports/stateStore';
import type { TaskQueueSnapshot, KanbanData } from '../../../../core/types/task';
import type { SessionState } from '../../../../core/types/session';
import { getSessionFilePathByJob, getAgentForJobSafe } from '../../../../core/utils/sessionPaths';
import { projectSessionStateToKanban } from '../../../../core/realtime/projectSessionStateToKanban';
import { deriveResumableState } from '../../../../core/session/resumable';
import type { SessionableJobType } from '@ant/shared';

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
    jobType: SessionableJobType
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

  /**
   * Redis is the SSOT for "what job is currently running" for a feature.
   * Returns the jobId of a job of `jobType` that Redis reports as running,
   * or undefined. Used to prefer the actually-running job over a
   * present-but-stale `session.state.jobId` (e.g. the visual runner writes
   * its jobId to the session only at completion, so a resume leaves the
   * prior turn's id — and its completed session — on disk for the whole run).
   */
  private async discoverRunningJobId(
    userContext: UserContext | undefined,
    projectId: string,
    featureName: string,
    jobType: string,
  ): Promise<string | undefined> {
    if (!this.stateStore) return undefined;
    try {
      const featureJobs = await this.stateStore.listJobsByFeature(userContext, projectId, featureName);
      const runningJob = featureJobs.find(
        j => j.status === 'running' && j.type === jobType
      );
      return runningJob?.jobId;
    } catch (error) {
      if (process.env.DEBUG_KANBAN === '1') console.error(`   Failed to discover running job from Redis:`, error);
      return undefined;
    }
  }

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
    
    // ✅ Redis is the SSOT for "what's running" (Unified Distributed System
    // Principle). Prefer any job of this type that Redis reports as running
    // over `session.state.jobId`, which can be absent (Planner never writes
    // it) OR stale — the visual runner writes its jobId only at completion,
    // so a resume leaves the PRIOR turn's id (and its completed session) on
    // disk for the whole run. Trusting that stale id made getKanbanData
    // report the wrong, not-running job (`isRunning=false`) for the entire
    // live job. A running job in Redis wins regardless of the session flag.
    let adoptedLiveJob = false;
    const runningJobId = await this.discoverRunningJobId(userContext, projectId, featureName, jobType);
    if (runningJobId) {
      if (runningJobId !== sessionJobId) {
        dlog(`   Redis reports running ${jobType} job ${runningJobId}; preferring over session jobId ${sessionJobId || 'none'}`);
      }
      sessionJobId = runningJobId;
      adoptedLiveJob = true; // a currently-running job is, by definition, not completed
    }

    const hasInterruption = !!sessionState.interruption;
    const hasTasksRemaining = sessionTaskQueue.length > 0 || !!currentTask;
    // When we adopted a live-running job, the (possibly stale) session's
    // `completedAt` must NOT mark it completed — that flag describes the
    // prior turn's session, not the running job we just adopted.
    const isJobCompleted = !adoptedLiveJob && !!sessionState.jobTiming?.completedAt && !hasInterruption && !hasTasksRemaining;
    
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
          tokenUsageByModel: liveSnapshot.tokenUsageByModel ?? sessionState.tokenUsageByModel,
          estimatingTokenUsage: liveSnapshot.estimatingTokenUsage ?? sessionState.estimatingTokenUsage,
          estimatingLabel: liveSnapshot.estimatingLabel,
          estimatingStartedAt: liveSnapshot.estimatingStartedAt,
          estimatingNodeId: liveSnapshot.estimatingNodeId,
          jobType,
          agent: getAgentForJobSafe(jobType),
        };
        dlog(`\n🎬 [KanbanService] ESTIMATING STARTED (estimatingLabel=${liveSnapshot.estimatingLabel})`);
        dlog(`[KanbanService] RETURN path=ESTIMATING jobId=${sessionJobId} todo=${result.todo.length} ip=0 done=${result.completed.length} ds=estimating`);
        return result;
      }
      
      dlog(`\n🔴 [KanbanService] LIVE DATA from Redis returned\n`);
      dlog(`[KanbanService] RETURN path=LIVE jobId=${sessionJobId} todo=${liveQueue.length} ip=${liveCurrentTasks.length} done=${liveCompletedTasks.length} ds=live`);
      
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
        tokenUsageByModel: liveSnapshot.tokenUsageByModel ?? sessionState.tokenUsageByModel,
        estimatingTokenUsage: liveSnapshot.estimatingTokenUsage ?? sessionState.estimatingTokenUsage,
        ...(liveSnapshot.checklist && { checklist: liveSnapshot.checklist }),
        jobType,
        agent: getAgentForJobSafe(jobType),
      };
    }

    // Priority 2: ESTIMATING (job running but no live snapshot yet)
    if (sessionJobId && !isJobCompleted && isActuallyRunning && !liveSnapshot) {
      dlog(`\n🎯 [KanbanService] ESTIMATING STATE (no live snapshot yet)`);
      dlog(`[KanbanService] RETURN path=ESTIMATING_NO_SNAPSHOT jobId=${sessionJobId} todo=${sessionTaskQueue.length} ip=0 done=${completedTasksDetails.length} ds=estimating`);
      
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
    //
    // Read-side self-heal (focal-jetting-ember RCA): an orphaned job — one
    // that crashed mid-execution (deploy / SIGKILL / OOM) while its
    // interruption projection never landed — persists `runningTasks` /
    // `currentTask` in the session with NO `interruption`. The pure projector
    // gates paused-mode on `!!sessionState.interruption`, so without it the
    // leftover tasks freeze in `inProgress` with `isRunning=false, paused=false`
    // (a stuck board, no Resume/Dismiss affordance) and no cancelled card.
    // The write-side handoff (poison-gated child → API-side pauseJob) can miss
    // for several reasons, so recover on the READ side here where Redis is
    // authoritative: when the job is definitively not running yet leftover work
    // remains and no interruption was recorded, synthesize a default
    // `server_crash` interruption (canResume derived from jobType by the shared
    // single owner) so the projector moves the tasks to `todo` (paused) and
    // surfaces the interruption. `isJobCompleted` (completedAt + no
    // interruption + no remaining work) already excludes genuinely-finished
    // jobs — kept out of the pure projector so its direct-call invariant
    // (unmarked running stays inProgress when isActuallyRunning=false) is
    // preserved.
    // Single owner of the resume verdict (code-job-flickering-sparkle):
    // `deriveResumableState` computes hasResumableWork (taskQueue | currentTask
    // | runningTasks) and the synthesized `server_crash` interruption with a
    // jobType-gated canResume, so this card and the `/resume` route can never
    // diverge. We still self-heal only when NO explicit interruption was
    // persisted (the write-side handoff missed) and the job is not running/done.
    const verdict = deriveResumableState(sessionState, jobType, { isActuallyRunning });
    const isOrphanedUncarded =
      !isActuallyRunning && !isJobCompleted && !hasInterruption && verdict.hasResumableWork;

    if (isOrphanedUncarded && verdict.interruption) {
      const healedSession = {
        ...sessionData,
        state: { ...sessionState, interruption: verdict.interruption },
      };
      console.log(
        `[KanbanService] SELF-HEAL orphaned uncarded job=${sessionJobId ?? 'none'} jobType=${jobType} canResume=${verdict.interruption.canResume}`,
      );
      return this.buildSessionKanbanData(healedSession, sessionJobId, jobType, false);
    }

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
    return projectSessionStateToKanban(sessionState, sessionJobId, jobType, isActuallyRunning);
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
   * Takes the finalizing `jobId` explicitly. The shared `session.state`
   * slot is last-writer-wins across all jobs of this jobType, so it is a
   * trusted source for THIS jobId's final board only when it actually
   * belongs to this jobId. On a confirmed mismatch we return `null` so the
   * caller skips both the snapshot persist and the SSE broadcast — never
   * projecting another (or stale) job's board onto the finalizing jobId
   * (plain-dimming-flock RCA). The built board is stamped with the target
   * `jobId` so downstream identity guards line up.
   */
  async getFinalSnapshotKanbanData(
    projectId: string,
    featureName: string,
    jobType: string,
    jobId: string,
    userContext?: UserContext,
  ): Promise<any | null> {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);

    const sessionData = await this.safeReadSession(sessionPath);
    const sessionJobId: string | undefined = sessionData?.state?.jobId;

    // Identity guard — only a CONFIRMED different jobId blocks the build
    // (an absent sessionJobId falls through and is stamped to the target).
    if (sessionJobId && sessionJobId !== jobId) {
      console.warn(
        `⚠️ [KanbanService] Final snapshot skipped — session.state belongs to ${sessionJobId}, not ${jobId}`,
      );
      return null;
    }

    // isActuallyRunning is forced false: by the time finalize/pauseJob
    // calls this, the job is logically terminal even if the Redis status
    // write hasn't landed yet. The flag only feeds the diagnostic log.
    // Stamp the target jobId so the persisted snapshot is correctly keyed.
    return this.buildSessionKanbanData(sessionData, jobId, jobType, false);
  }

  /**
   * Read the persisted `SessionState` for a job, through the same single
   * file-access owner as the Kanban projection. Returns `undefined` when the
   * session file is absent/unreadable. Used by StaleJobRecovery Phase 1 to
   * consult `deriveResumableState` (the durable "what's left" SSOT) before
   * deciding pause-vs-finalize — so recovery cannot open the session file on
   * its own path and drift from this reader.
   */
  async readSessionState(
    projectId: string,
    featureName: string,
    jobType: string,
    userContext?: UserContext,
  ): Promise<Partial<SessionState> | undefined> {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const sessionPath = getSessionFilePathByJob(featurePath, jobType);

    const sessionData = await this.safeReadSession(sessionPath);
    return sessionData?.state ?? undefined;
  }

  /**
   * Read the session file with a small retry loop and last-known-good
   * fallback. Extracted so both `getKanbanData` and
   * `getFinalSnapshotKanbanData` share one I/O policy.
   */
  private async safeReadSession(sessionPath: string): Promise<any | null> {
    const debug = process.env.DEBUG_KANBAN === '1';
    const derr = (...args: any[]) => { if (debug) console.error(...args); };

    // Bind the read to a base descent when in-base so a reparented feature root
    // cannot return another tenant's session JSON to this HTTP/SSE response
    // (H-017). Out-of-base (repoType:local) keeps the raw read.
    const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), sessionPath);
    if (!br) {
      try {
        await fs.promises.access(sessionPath);
      } catch {
        return null;
      }
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let raw: string;
        if (br) {
          const read = readTextContainedBase(br);
          if (!read.ok) {
            if (read.reason === 'missing') return null;
            throw new Error(`session read failed: ${read.reason}`);
          }
          raw = read.text;
        } else {
          raw = await fs.promises.readFile(sessionPath, 'utf-8');
        }
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
