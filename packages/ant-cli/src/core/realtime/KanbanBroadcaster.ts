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
 * 
 * (Previous Flow):
 *   Job Worker Child → HTTP → API Server → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import { TaskQueueUpdatePort } from '../ports';
import { 
  getSSEBroadcastChannel,
  TASK_QUEUE_KEY_PREFIX,
  TASK_QUEUE_TTL,
  TaskQueueSnapshot, 
  KanbanBroadcastMessage,
  BroadcasterOptions 
} from './types';
import { UserContext } from '../types/user';

export class KanbanBroadcaster implements TaskQueueUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly projectId: string;
  private readonly featureName: string;
  private readonly jobType: 'design' | 'code' | 'learn';
  private readonly userContext?: UserContext;
  
  constructor(options: BroadcasterOptions) {
    this.redis = new Redis(options.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    this.pubRedis = new Redis(options.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    this.jobId = options.jobId;
    this.projectId = options.projectId;
    this.featureName = options.featureName;
    this.jobType = options.jobType || 'code';
    this.userContext = options.userContext;
    
    console.log(`✅ [KanbanBroadcaster] Initialized for ${this.projectId}/${this.featureName} (job: ${this.jobId})`);
  }

  /**
   * Update task queue snapshot
   * Implements TaskQueueUpdatePort interface
   */
  updateTaskQueue(
    taskId: string,
    currentTask: any | undefined,
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { 
      inputTokens: number; 
      outputTokens: number; 
      totalTokens: number; 
      cacheReadTokens?: number; 
      cacheCreationTokens?: number;
    }
  ): void {
    // Fire-and-forget with error logging (same pattern as before)
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
    currentTask: any | undefined,
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { 
      inputTokens: number; 
      outputTokens: number; 
      totalTokens: number; 
      cacheReadTokens?: number; 
      cacheCreationTokens?: number;
    }
  ): Promise<void> {
    // 1. Build snapshot
    const snapshot: TaskQueueSnapshot = {
      currentTask,
      queue,
      completedTasks,
      recursionCount,
      recursionLimit,
      tokenUsage,
    };

    // 2. Save snapshot to Redis (state storage)
    // Use central key prefix for consistency with RedisStateStore
    const key = `${TASK_QUEUE_KEY_PREFIX}${this.jobId}`;
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', TASK_QUEUE_TTL);

    // 3. Build Kanban data for broadcast
    // Format that frontend expects (same as KanbanService.getKanbanData output)
    const kanbanData = {
      current: currentTask ? {
        id: currentTask.id || taskId,
        title: currentTask.name || currentTask.title || 'Current Task',
        status: 'inProgress',
        progress: 50, // Default progress
        ...currentTask,
      } : null,
      queue: queue.map((task, index) => ({
        id: task.id || `queue-${index}`,
        title: task.name || task.title || `Task ${index + 1}`,
        status: 'todo',
        ...task,
      })),
      completed: completedTasks.map((task, index) => ({
        id: task.id || `completed-${index}`,
        title: task.name || task.title || `Completed Task ${index + 1}`,
        status: 'done',
        ...task,
      })),
      summary: {
        total: queue.length + completedTasks.length + (currentTask ? 1 : 0),
        completed: completedTasks.length,
        inProgress: currentTask ? 1 : 0,
        todo: queue.length,
        recursionCount,
        recursionLimit,
        tokenUsage,
      },
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
    const channel = getSSEBroadcastChannel(this.userContext.organizationId, this.userContext.userId);
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
