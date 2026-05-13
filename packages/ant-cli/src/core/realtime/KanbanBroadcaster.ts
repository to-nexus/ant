/**
 * KanbanBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Kanban (Task Queue) updates.
 * 
 * Architecture:
 * - Implements TaskQueueUpdatePort for compatibility
 * - Directly writes to Redis (state storage + Pub/Sub broadcast)
 * - No HTTP intermediary required
 * 
 * Flow:
 *   Job Worker Child → KanbanBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import { TaskQueueUpdatePort } from '../ports';
import type { 
  BaseTask,
  TaskTokenUsage,
  TaskQueueSnapshot, 
  KanbanData,
  KanbanBroadcastMessage,
  DecomposableJobType
} from '../types/task';
import type { JobTiming, PhaseTokenUsage } from '@ant/shared';
import { 
  getRealtimeBroadcastChannel,
  TASK_QUEUE_KEY_PREFIX,
  TASK_QUEUE_CHECKPOINT_KEY_PREFIX,
  TASK_QUEUE_TTL,
  BroadcasterOptions 
} from './types';
import { UserContext } from '../types/user';
import { getAgentForJobSafe } from '../utils/sessionPaths';
import { InflightTracker } from './InflightTracker';

/** Sentinel key for "no workerId" snapshots stored in cachedCurrentPhaseTokenUsages. */
const MAIN_WORKER_KEY = -1;

/**
 * Phases that run on the sequential/main graph BEFORE a task queue exists.
 * Their snapshots live in the `MAIN_WORKER_KEY` slot and must be dropped
 * once tasks start executing (parallel workers take over, or the main graph
 * moves on to plan/execute) — otherwise the chat-input gauge keeps showing a
 * stale "decompose" battery for the entire parallel-orchestration phase.
 */
const ESTIMATING_PHASES = new Set(['triage', 'detect', 'decompose']);

export class KanbanBroadcaster implements TaskQueueUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly projectId: string;
  private readonly featureName: string;
  private readonly jobType: string;
  private readonly agent: string;
  private readonly userContext?: UserContext;
  private jobTiming?: JobTiming;  // ✅ Stored once, included in every broadcast
  private estimatingLabel?: string;       // Current non-task node activity label
  private estimatingStartedAt?: string;   // ISO timestamp when current phase started
  private estimatingNodeId?: string;      // Node ID for UI-specific rendering
  // ✅ Cached metrics — updated by updateTaskQueue, included in every broadcast (incl. setEstimatingActivity)
  private cachedRecursionCount?: number;
  private cachedRecursionLimit?: number;
  private cachedTokenUsage?: TaskTokenUsage;
  private cachedEstimatingTokenUsage?: TaskTokenUsage;
  private cachedPhaseTokenUsages?: PhaseTokenUsage[];
  /**
   * Per-worker latest-LLM-call snapshot, keyed by `workerId`.
   * `MAIN_WORKER_KEY` (-1) stands in for "no workerId" (sequential / main graph).
   */
  private cachedCurrentPhaseTokenUsages: Map<number, PhaseTokenUsage> = new Map();
  // Cached task lists from last updateTaskQueue (NOT from broadcastKanbanUpdate,
  // which is also called during estimating with empty arrays).
  private cachedCurrentTasks: BaseTask[] = [];
  private cachedQueue: BaseTask[] = [];
  private cachedCompletedTasks: BaseTask[] = [];

  // Tracks fire-and-forget broadcasts so close() can flush them before
  // tearing down Redis connections. Prevents end-of-job emissions from
  // racing `pubRedis.quit()` (most visible on short jobs like `plan`).
  private readonly inflight = new InflightTracker();
  
  constructor(options: BroadcasterOptions) {
    const isTLS = options.redisUrl.startsWith('rediss://');
    const tlsOptions = isTLS ? { tls: { checkServerIdentity: () => undefined as undefined } } : {};
    const redisOpts = {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    };
    this.redis = new Redis(options.redisUrl, redisOpts);
    this.pubRedis = new Redis(options.redisUrl, redisOpts);
    this.jobId = options.jobId;
    this.projectId = options.projectId;
    this.featureName = options.featureName;
    this.jobType = options.jobType || 'code';
    this.agent = getAgentForJobSafe(this.jobType);
    this.userContext = options.userContext;
    
    // Error & connection event handlers for diagnostics
    this.redis.on('error', (err) => console.error(`❌ [KanbanBroadcaster] redis error:`, err.message));
    this.redis.on('ready', () => console.log(`🟢 [KanbanBroadcaster] redis ready`));
    this.pubRedis.on('error', (err) => console.error(`❌ [KanbanBroadcaster] pubRedis error:`, err.message));
    this.pubRedis.on('ready', () => console.log(`🟢 [KanbanBroadcaster] pubRedis ready`));
    
    console.log(`✅ [KanbanBroadcaster] Initialized for ${this.projectId}/${this.featureName} (job: ${this.jobId}, user: ${this.userContext?.userId}@${this.userContext?.organizationId})`);
  }

  /**
   * Store job-level timing so every subsequent broadcast includes it.
   * Called once from resolve/decompose nodes when jobTiming is initialized.
   */
  setJobTiming(jobTiming: JobTiming): void {
    this.jobTiming = jobTiming;
    console.log(`[KanbanBroadcaster] ⏱️ jobTiming set (startedAt: ${jobTiming.startedAt})`);
  }

  /**
   * Set the current non-task node activity label.
   * Broadcasts immediately so frontend banner updates in real-time.
   * Auto-cleared when updateTaskQueue receives actual tasks.
   */
  setEstimatingActivity(label: string, nodeId?: string): void {
    this.estimatingLabel = label;
    this.estimatingStartedAt = new Date().toISOString();
    this.estimatingNodeId = nodeId;
    console.log(`[KanbanBroadcaster] 📊 Activity: ${label} (node: ${nodeId || 'unknown'})`);
    
    // Broadcast immediately so frontend banner updates in real-time.
    // Preserve cached completedTasks in the Redis snapshot so that
    // KanbanService.getKanbanData() can distinguish "between rounds" from
    // "truly empty" and avoid returning stale sessionTaskQueue as todo.
    this.inflight.track(
      this.broadcastKanbanUpdate(
        this.jobId,
        [],    // no current tasks during estimating
        [],    // no tasks in queue during estimating
        this.cachedCompletedTasks,
        this.cachedRecursionCount,
        this.cachedRecursionLimit,
        this.cachedTokenUsage,
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to broadcast estimating activity:`, err.message);
      })
    );
  }

  /**
   * Clear the estimating activity label and broadcast the cleared state.
   * Called when the graph terminates without producing tasks (e.g., triage → __end__).
   */
  clearEstimatingActivity(): void {
    if (!this.estimatingLabel) return; // Already cleared, nothing to do
    
    this.estimatingLabel = undefined;
    this.estimatingStartedAt = undefined;
    this.estimatingNodeId = undefined;
    // Also drop the estimating battery so the chat-input gauge empties
    // when a graph terminates without tasks (e.g. triage → __end__).
    this.dropMainEstimatingSnapshotIfPresent();
    console.log(`[KanbanBroadcaster] 🧹 Estimating activity cleared`);
    
    // Broadcast immediately so frontend removes the loading banner.
    // Preserve cached completedTasks (same rationale as setEstimatingActivity).
    this.inflight.track(
      this.broadcastKanbanUpdate(
        this.jobId,
        [],
        [],
        this.cachedCompletedTasks,
        this.cachedRecursionCount,
        this.cachedRecursionLimit,
        this.cachedTokenUsage,
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to broadcast cleared activity:`, err.message);
      })
    );
  }

  /**
   * Update job-level token usage and re-broadcast if in estimating mode.
   * Called after accumulateTokenUsage() during estimating phase nodes
   * (triage, detect, decompose) so the frontend badge updates in real-time.
   */
  updateTokenUsage(tokenUsage: TaskTokenUsage): void {
    this.cachedTokenUsage = tokenUsage;

    // Only re-broadcast if currently in estimating mode (no tasks yet)
    if (this.estimatingLabel) {
      this.inflight.track(
        this.broadcastKanbanUpdate(
          this.jobId,
          [],
          [],
          this.cachedCompletedTasks,
          this.cachedRecursionCount,
          this.cachedRecursionLimit,
          tokenUsage,
        ).catch(err => {
          console.warn(`[KanbanBroadcaster] Failed to broadcast token usage:`, err.message);
        })
      );
    }
  }

  /**
   * Update per-phase token breakdown and re-broadcast if in estimating mode.
   * Used by visual/plan jobs that don't have a task queue.
   */
  updatePhaseTokenUsages(phases: PhaseTokenUsage[]): void {
    this.cachedPhaseTokenUsages = phases;

    if (this.estimatingLabel) {
      this.inflight.track(
        this.broadcastKanbanUpdate(
          this.jobId,
          [],
          [],
          this.cachedCompletedTasks,
          this.cachedRecursionCount,
          this.cachedRecursionLimit,
          this.cachedTokenUsage,
        ).catch(err => {
          console.warn(`[KanbanBroadcaster] Failed to broadcast phase token usages:`, err.message);
        })
      );
    }
  }

  /**
   * Upsert the latest-LLM-call snapshot for the given `snapshot.workerId`
   * slot. Parallel workers each keep their own entry; the sequential / main
   * graph uses the reserved `MAIN_WORKER_KEY` slot.
   *
   * Fires an immediate broadcast so every battery on the chat-input gauge
   * stays real-time.
   */
  updateCurrentPhaseTokenUsage(snapshot: PhaseTokenUsage): void {
    const key = typeof snapshot.workerId === 'number' ? snapshot.workerId : MAIN_WORKER_KEY;
    this.cachedCurrentPhaseTokenUsages.set(key, snapshot);

    this.inflight.track(
      this.broadcastKanbanUpdate(
        this.jobId,
        this.cachedCurrentTasks,
        this.cachedQueue,
        this.cachedCompletedTasks,
        this.cachedRecursionCount,
        this.cachedRecursionLimit,
        this.cachedTokenUsage,
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to broadcast current phase token usage:`, err.message);
      })
    );
  }

  /**
   * Drop the per-worker snapshot when a parallel worker terminates. The next
   * broadcast will no longer include that worker's battery.
   */
  clearWorkerPhaseTokenUsage(workerId: number): void {
    if (!this.cachedCurrentPhaseTokenUsages.delete(workerId)) return;
    this.inflight.track(
      this.broadcastKanbanUpdate(
        this.jobId,
        this.cachedCurrentTasks,
        this.cachedQueue,
        this.cachedCompletedTasks,
        this.cachedRecursionCount,
        this.cachedRecursionLimit,
        this.cachedTokenUsage,
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to broadcast worker cleanup:`, err.message);
      })
    );
  }

  /**
   * Current-phase snapshots as an array for broadcast payloads.
   * Returns `undefined` when the cache is empty so the broadcaster omits the
   * field entirely (kanbanReducer then preserves the frontend's last value).
   */
  private getCurrentPhaseTokenUsagesArray(): PhaseTokenUsage[] | undefined {
    if (this.cachedCurrentPhaseTokenUsages.size === 0) return undefined;
    return Array.from(this.cachedCurrentPhaseTokenUsages.values());
  }

  /**
   * Drop the `MAIN_WORKER_KEY` slot iff it currently holds an estimating
   * snapshot (triage / detect / decompose). Used at estimating→task
   * boundaries so the stale "작업계획수립중" battery disappears.
   * Non-estimating snapshots (plan, execute, learn, etc.) are preserved —
   * sequential mode relies on them for the main-graph gauge.
   */
  private dropMainEstimatingSnapshotIfPresent(): void {
    const main = this.cachedCurrentPhaseTokenUsages.get(MAIN_WORKER_KEY);
    if (main && ESTIMATING_PHASES.has(main.phase)) {
      this.cachedCurrentPhaseTokenUsages.delete(MAIN_WORKER_KEY);
    }
  }

  /**
   * Snapshot estimating phase token usage, included in all subsequent broadcasts.
   * Called once at end of decompose node.
   */
  setEstimatingTokenUsage(tokenUsage: TaskTokenUsage): void {
    this.cachedEstimatingTokenUsage = tokenUsage;
    console.log(`[KanbanBroadcaster] 📊 Estimating token usage snapshot set (input: ${tokenUsage.inputTokens}, output: ${tokenUsage.outputTokens})`);
  }

  /**
   * Update a single in-progress task's token usage and re-broadcast
   * using cached task lists. Safe for parallel workers: each worker only
   * knows its own task, but the broadcaster holds the full cached state
   * from the last orchestrator updateTaskQueue call.
   *
   * Skips broadcast if the task is not found in cached state (e.g.,
   * orchestrator hasn't broadcast the task assignment yet).
   */
  updateInProgressTaskTokenUsage(taskId: string, taskTokenUsage: TaskTokenUsage): void {
    if (!this.cachedCurrentTasks.some(t => t.id === taskId)) {
      return;
    }

    const updatedTasks = this.cachedCurrentTasks.map(t =>
      t.id === taskId ? { ...t, tokenUsage: taskTokenUsage } : t
    );
    this.cachedCurrentTasks = updatedTasks;

    this.inflight.track(
      this.broadcastKanbanUpdate(
        this.jobId,
        updatedTasks,
        this.cachedQueue,
        this.cachedCompletedTasks,
        this.cachedRecursionCount,
        this.cachedRecursionLimit,
        this.cachedTokenUsage,
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to broadcast task token update:`, err.message);
      })
    );
  }

  /**
   * Update task queue snapshot
   * Implements TaskQueueUpdatePort interface
   */
  updateTaskQueue(
    taskId: string,
    currentTask: BaseTask | BaseTask[] | null | undefined,
    queue: BaseTask[],
    completedTasks: BaseTask[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: TaskTokenUsage
  ): void {
    // ✅ Cache metrics so setEstimatingActivity can include them
    if (recursionCount !== undefined) this.cachedRecursionCount = recursionCount;
    if (recursionLimit !== undefined) this.cachedRecursionLimit = recursionLimit;
    if (tokenUsage !== undefined) this.cachedTokenUsage = tokenUsage;

    // Normalize to array
    const currentTasks: BaseTask[] = currentTask
      ? (Array.isArray(currentTask) ? currentTask : [currentTask])
      : [];

    // Cache task lists so updateInProgressTaskTokenUsage can re-broadcast
    // without needing the full state from the caller.
    this.cachedCurrentTasks = currentTasks;
    this.cachedQueue = queue;
    this.cachedCompletedTasks = completedTasks;

    // Fire-and-forget with error logging
    this.inflight.track(
      this.broadcastKanbanUpdate(
        taskId, 
        currentTasks, 
        queue, 
        completedTasks, 
        recursionCount, 
        recursionLimit,
        tokenUsage
      ).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to update task queue:`, err.message);
      })
    );
  }

  /**
   * Broadcast Kanban update via Redis
   */
  private async broadcastKanbanUpdate(
    taskId: string,
    currentTasks: BaseTask[],
    queue: BaseTask[],
    completedTasks: BaseTask[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: TaskTokenUsage
  ): Promise<void> {
    // Auto-clear estimating activity when task work begins
    const hasTasks = currentTasks.length > 0 || queue.length > 0;
    if (hasTasks) {
      this.estimatingLabel = undefined;
      this.estimatingStartedAt = undefined;
      this.estimatingNodeId = undefined;
      // Drop the main-graph estimating snapshot so the chat-input gauge
      // stops showing a stale "decompose" battery alongside the worker
      // batteries during parallel orchestration. Idempotent: once the
      // slot is empty or holds a non-estimating phase (e.g. learn), this
      // is a no-op.
      this.dropMainEstimatingSnapshotIfPresent();
    }

    // ✅ FIX: Use cached token usage as fallback when not explicitly provided.
    // checkTaskStatus calls updateTaskQueue without tokenUsage; without this fallback,
    // broadcasts would send tokenUsage: undefined, causing frontend badge to reset to 0.
    const effectiveTokenUsage = tokenUsage ?? this.cachedTokenUsage;

    const currentPhaseTokenUsagesArray = this.getCurrentPhaseTokenUsagesArray();

    // 1. Build snapshot for Redis state storage
    const snapshot: TaskQueueSnapshot = {
      currentTask: currentTasks[0] || null,
      currentTasks: currentTasks.length > 0 ? currentTasks : undefined,  // Store ALL running tasks for parallel execution
      queue,
      completedTasks,
      recursionCount: recursionCount ?? 0,
      recursionLimit: recursionLimit ?? 50,
      tokenUsage: effectiveTokenUsage,
      ...(this.cachedEstimatingTokenUsage && { estimatingTokenUsage: this.cachedEstimatingTokenUsage }),
      ...(this.cachedPhaseTokenUsages && { phaseTokenUsages: this.cachedPhaseTokenUsages }),
      ...(currentPhaseTokenUsagesArray && { currentPhaseTokenUsages: currentPhaseTokenUsagesArray }),
      ...(this.jobTiming && { jobTiming: this.jobTiming }),
      // Include estimating activity for reconnect/recovery
      ...(this.estimatingLabel && {
        estimatingLabel: this.estimatingLabel,
        estimatingStartedAt: this.estimatingStartedAt,
        estimatingNodeId: this.estimatingNodeId,
      }),
    };

    // 2. Save snapshot to Redis
    const key = `${TASK_QUEUE_KEY_PREFIX}${this.jobId}`;
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', TASK_QUEUE_TTL);

    // 3. Build KanbanData for broadcast (matches frontend KanbanData interface)
    // Use estimatingLabel as the signal (not array emptiness) because
    // setEstimatingActivity now preserves cached completedTasks.
    const isEstimating = !!this.estimatingLabel;
    
    const kanbanData: KanbanData = {
      jobId: this.jobId,
      todo: queue,
      inProgress: currentTasks,
      completed: completedTasks.map(task => ({
        ...task,
        completed: true,
      })),
      isEstimating,
      dataSource: 'live',
      recursionCount,
      recursionLimit,
      tokenUsage: effectiveTokenUsage,
      ...(this.cachedEstimatingTokenUsage && { estimatingTokenUsage: this.cachedEstimatingTokenUsage }),
      ...(this.cachedPhaseTokenUsages && { phaseTokenUsages: this.cachedPhaseTokenUsages }),
      ...(currentPhaseTokenUsagesArray && { currentPhaseTokenUsages: currentPhaseTokenUsagesArray }),
      jobType: this.jobType,
      agent: this.agent,
      // ✅ Include job-level timing in every broadcast (set once via setJobTiming)
      ...(this.jobTiming && { jobTiming: this.jobTiming }),
      // ✅ Include node activity banner data (auto-cleared when tasks exist)
      ...(this.estimatingLabel && {
        estimatingLabel: this.estimatingLabel,
        estimatingStartedAt: this.estimatingStartedAt,
        estimatingNodeId: this.estimatingNodeId,
      }),
    };

    // 4. Broadcast via user-scoped Redis Pub/Sub channel
    if (!this.userContext?.organizationId || !this.userContext?.userId) {
      console.warn(`[KanbanBroadcaster] ⚠️ Cannot broadcast without userContext`);
      return;
    }
    
    const message: KanbanBroadcastMessage = {
      projectId: this.projectId,
      featureName: this.featureName,
      type: 'kanban',
      data: kanbanData,
      userContext: this.userContext,
    };

    // Publish to user-specific channel
    const channel = getRealtimeBroadcastChannel(this.userContext.organizationId, this.userContext.userId);
    await this.pubRedis.publish(channel, JSON.stringify(message));
  }

  /**
   * Save a checkpoint snapshot to Redis for disaster recovery.
   * 
   * Unlike updateTaskQueue/broadcastKanbanUpdate, this does NOT publish
   * via Pub/Sub — it only persists the snapshot to Redis. This prevents
   * UI flicker (briefly showing all tasks as "todo" with none in-progress).
   * 
   * The snapshot is read by cleanupJobState as a fallback when the session
   * file is unreadable (corrupted mid-write, EFS stale read, etc.).
   */
  saveCheckpointSnapshot(
    queue: BaseTask[],
    runningTasks: BaseTask[],
    completedTasks: BaseTask[],
    tokenUsage?: TaskTokenUsage
  ): void {
    const snapshot: TaskQueueSnapshot = {
      currentTask: null,
      // In-flight workers reported via `currentTasks` — same field shape as
      // the live snapshot, unifying disaster-recovery reads. The crash-recovery
      // boundary (`JobCleanupManager`) is the single site that applies
      // `interrupted:true` on resume; this snapshot itself carries no
      // defensive marking so the durable SSOT stays clean during normal run.
      currentTasks: runningTasks,
      queue,
      completedTasks,
      recursionCount: 0,
      recursionLimit: 50,
      tokenUsage,
    };

    // ✅ Use SEPARATE Redis key for checkpoint snapshots (disaster recovery only).
    // CRITICAL: Must NOT use the same key as broadcastKanbanUpdate (TASK_QUEUE_KEY_PREFIX).
    // The checkpoint snapshot now mirrors the live snapshot shape (running in
    // `currentTasks`, never pre-marked). The cleanup path applies `interrupted:true`
    // when it projects running→queue on resume.
    const key = `${TASK_QUEUE_CHECKPOINT_KEY_PREFIX}${this.jobId}`;
    // Fire-and-forget — this is a backup, not critical path. Tracked so a
    // close that lands mid-write can still flush the SET before quit.
    this.inflight.track(
      this.redis.set(key, JSON.stringify(snapshot), 'EX', TASK_QUEUE_TTL).catch(err => {
        console.warn(`[KanbanBroadcaster] Failed to save checkpoint snapshot to Redis:`, err.message);
      })
    );
  }

  /**
   * Close Redis connections. Flushes in-flight broadcasts/snapshot writes
   * first so a final emission isn't dropped by `quit()` mid-publish.
   */
  async close(): Promise<void> {
    await this.inflight.flush();
    await this.redis.quit();
    await this.pubRedis.quit();
  }
}
