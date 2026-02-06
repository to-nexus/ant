/**
 * KanbanBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Kanban (Task Queue) updates.
 * Replaces HTTP-based KanbanHttpClient for Job Worker child processes.
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
   * Update task queue snapshot
   * Implements TaskQueueUpdatePort interface
   */
  updateTaskQueue(
    taskId: string,
    currentTask: BaseTask | null | undefined,
    queue: BaseTask[],
    completedTasks: BaseTask[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: TaskTokenUsage
  ): void {
    // Fire-and-forget with error logging
    this.broadcastKanbanUpdate(
      taskId, 
      currentTask, 
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
    currentTask: BaseTask | null | undefined,
    queue: BaseTask[],
    completedTasks: BaseTask[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: TaskTokenUsage
  ): Promise<void> {
    // 1. Build snapshot for Redis state storage
    const snapshot: TaskQueueSnapshot = {
      currentTask: currentTask || null,
      queue,
      completedTasks,
      recursionCount: recursionCount ?? 0,
      recursionLimit: recursionLimit ?? 50,
      tokenUsage,
    };

    // 2. Save snapshot to Redis
    const key = `${TASK_QUEUE_KEY_PREFIX}${this.jobId}`;
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', TASK_QUEUE_TTL);

    // 3. Build KanbanData for broadcast (matches frontend KanbanData interface)
    const isEstimating = queue.length === 0 && !currentTask && completedTasks.length === 0;
    
    const kanbanData: KanbanData = {
      jobId: this.jobId,
      todo: queue,
      inProgress: currentTask || null,
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
    
    console.log(`[KanbanBroadcaster] ✅ Broadcast sent to ${channel} (task: ${taskId}, current: ${currentTask?.name || 'none'}, queue: ${queue.length}, completed: ${completedTasks.length})`);
  }

  /**
   * Close Redis connections
   */
  async close(): Promise<void> {
    await this.redis.quit();
    await this.pubRedis.quit();
  }
}
