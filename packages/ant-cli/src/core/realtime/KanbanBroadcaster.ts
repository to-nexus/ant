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
import type { JobTiming } from '@ant/shared';
import { 
  getRealtimeBroadcastChannel,
  TASK_QUEUE_KEY_PREFIX,
  TASK_QUEUE_TTL,
  BroadcasterOptions 
} from './types';
import { UserContext } from '../types/user';

export class KanbanBroadcaster implements TaskQueueUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly projectId: string;
  private readonly featureName: string;
  private readonly jobType: DecomposableJobType;
  private readonly userContext?: UserContext;
  private jobTiming?: JobTiming;  // ✅ Stored once, included in every broadcast
  private estimatingLabel?: string;       // Current non-task node activity label
  private estimatingStartedAt?: string;   // ISO timestamp when current phase started
  private estimatingNodeId?: string;      // Node ID for UI-specific rendering
  
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
    
    // Broadcast immediately so frontend banner updates in real-time
    this.broadcastKanbanUpdate(
      this.jobId,
      [],    // no current tasks during estimating
      [],    // no tasks yet
      [],    // no completed tasks yet
    ).catch(err => {
      console.warn(`[KanbanBroadcaster] Failed to broadcast estimating activity:`, err.message);
    });
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
    // Normalize to array
    const currentTasks: BaseTask[] = currentTask
      ? (Array.isArray(currentTask) ? currentTask : [currentTask])
      : [];

    // Fire-and-forget with error logging
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
    });
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
    }

    // 1. Build snapshot for Redis state storage
    const snapshot: TaskQueueSnapshot = {
      currentTask: currentTasks[0] || null,
      currentTasks: currentTasks.length > 0 ? currentTasks : undefined,  // Store ALL running tasks for parallel execution
      queue,
      completedTasks,
      recursionCount: recursionCount ?? 0,
      recursionLimit: recursionLimit ?? 50,
      tokenUsage,
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
    const isEstimating = queue.length === 0 && currentTasks.length === 0 && completedTasks.length === 0;
    
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
      tokenUsage,
      jobType: this.jobType,
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
    
    const currentNames = currentTasks.map(t => t.name).join(', ') || 'none';
    console.log(`[KanbanBroadcaster] ✅ Broadcast sent to ${channel} (task: ${taskId}, current: [${currentNames}], queue: ${queue.length}, completed: ${completedTasks.length})`);
  }

  /**
   * Close Redis connections
   */
  async close(): Promise<void> {
    await this.redis.quit();
    await this.pubRedis.quit();
  }
}
