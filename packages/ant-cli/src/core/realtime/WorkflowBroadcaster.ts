/**
 * WorkflowBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Workflow state updates.
 * Used by Job Worker child processes to broadcast workflow state.
 * 
 * Architecture:
 * - Implements WorkflowStateUpdatePort for compatibility
 * - Maintains in-memory WorkflowRealtimeState (canonical type from @ant/shared)
 * - Writes to Redis and publishes via Redis Pub/Sub
 * - No HTTP intermediary required
 * 
 * Refactored for parallel execution:
 * - Uses activeNodes[] instead of currentNode/previousNode/currentTask
 * - Tracks multiple concurrent workers via activeWorkers Map
 * - workerId=0 for sequential mode, N for parallel workers
 * 
 * Flow:
 *   Job Worker Child → WorkflowBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import { WorkflowStateUpdatePort, TaskInfo, LLMInfo } from '../ports/workflow';
import type { WorkflowRealtimeState, NodeHistoryEntry } from '../ports/stateStore';
import { 
  getRealtimeWorkflowChannel,
  WORKFLOW_STATE_KEY_PREFIX,
  WORKFLOW_STATE_TTL,
  WorkflowBroadcastMessage,
  BroadcasterOptions 
} from './types';
import { UserContext } from '../types/user';

/**
 * Lightweight async mutex for serializing concurrent enterNode/exitNode calls.
 * Prevents race conditions when multiple parallel workers share the same broadcaster.
 */
class BroadcasterMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

interface ActiveWorkerInfo {
  nodeId: string;
  previousNodeId: string | null;
  taskInfo: TaskInfo;
  enteredAt: string;
}

export class WorkflowBroadcaster implements WorkflowStateUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly userContext?: UserContext;
  
  // Mutex for serializing concurrent state mutations from parallel workers
  private readonly mutex = new BroadcasterMutex();
  
  // Active worker tracking
  private activeWorkers = new Map<number, ActiveWorkerInfo>();
  
  // In-memory workflow state (canonical WorkflowRealtimeState)
  private state: WorkflowRealtimeState;
  
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
    this.userContext = options.userContext;
    
    // Initialize canonical WorkflowRealtimeState
    this.state = {
      jobId: options.jobId,
      activeNodes: [],
      llmInfo: null,
      startedAt: new Date().toISOString(),
      isCompleted: false,
      nodeHistory: [],
      activeActors: [],
    };
    
    // Error & connection event handlers for diagnostics
    this.redis.on('error', (err) => console.error(`❌ [WorkflowBroadcaster] redis error:`, err.message));
    this.redis.on('ready', () => console.log(`🟢 [WorkflowBroadcaster] redis ready`));
    this.pubRedis.on('error', (err) => console.error(`❌ [WorkflowBroadcaster] pubRedis error:`, err.message));
    this.pubRedis.on('ready', () => console.log(`🟢 [WorkflowBroadcaster] pubRedis ready`));
    
    console.log(`✅ [WorkflowBroadcaster] Initialized for job: ${this.jobId} (user: ${this.userContext?.userId}@${this.userContext?.organizationId})`);
  }

  /**
   * Start job tracking
   */
  startJob(jobId: string, llmInfo?: LLMInfo): void {
    this.activeWorkers.clear();
    this.state = {
      jobId: this.jobId,
      activeNodes: [],
      llmInfo: llmInfo || null,
      startedAt: new Date().toISOString(),
      isCompleted: false,
      nodeHistory: [],
      activeActors: [],
    };
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast startJob:`, err.message);
    });
    
    console.log(`[WorkflowBroadcaster] Job started: ${jobId}`);
  }

  /**
   * Track node entry
   * @param workerId - Worker identifier (0 for sequential, N for parallel workers)
   * Returns Promise to ensure SSE ordering
   * Uses mutex to prevent race conditions from concurrent worker calls
   */
  async enterNode(
    jobId: string, 
    nodeId: string,
    workerId: number,
    taskInfo?: TaskInfo, 
    llmInfo?: LLMInfo,
    recursionCount?: number,
    recursionLimit?: number
  ): Promise<void> {
    await this.mutex.runExclusive(async () => {
      // Close previous node's history entry for this worker
      const prev = this.activeWorkers.get(workerId);
      if (prev) {
        this.closeHistoryEntry(prev.nodeId);
      }
      
      // Update active worker
      const enteredAt = new Date().toISOString();
      this.activeWorkers.set(workerId, {
        nodeId,
        previousNodeId: prev?.nodeId ?? null,
        taskInfo: taskInfo ?? { name: 'unknown' },
        enteredAt,
      });
      
      // Rebuild activeNodes array from map
      this.rebuildActiveNodes();
      
      // Add to history
      this.state.nodeHistory.push({
        nodeId,
        enteredAt,
      });
      
      if (llmInfo) {
        this.state.llmInfo = llmInfo;
      }
      if (recursionCount !== undefined) {
        this.state.recursionCount = recursionCount;
      }
      if (recursionLimit !== undefined) {
        this.state.recursionLimit = recursionLimit;
      }
      
      await this.broadcastState(false);
      console.log(`[WorkflowBroadcaster] Enter node: ${nodeId} (worker=${workerId}${taskInfo ? `, task: ${taskInfo.name}` : ''})`);
    });
  }

  /**
   * Track node exit
   * @param workerId - Worker identifier (0 for sequential, N for parallel workers)
   * Now async with mutex to prevent race conditions with concurrent enterNode/exitNode calls
   */
  async exitNode(jobId: string, nodeId: string, workerId: number): Promise<void> {
    try {
      await this.mutex.runExclusive(async () => {
        this.activeWorkers.delete(workerId);
        this.rebuildActiveNodes();
        this.closeHistoryEntry(nodeId);
        
        await this.broadcastState(false);
      });
    } catch (err: any) {
      // Catch internally to prevent unhandled rejection from non-awaited callers
      console.warn(`[WorkflowBroadcaster] Failed to broadcast exitNode(${nodeId}, worker=${workerId}):`, err.message);
    }
  }

  /**
   * Track actor interaction start
   */
  startActorInteraction(jobId: string, actorId: string): void {
    if (!this.state.activeActors.includes(actorId)) {
      this.state.activeActors.push(actorId);
    }
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast startActor:`, err.message);
    });
  }

  /**
   * Track actor interaction end
   */
  endActorInteraction(jobId: string, actorId: string): void {
    this.state.activeActors = this.state.activeActors.filter(a => a !== actorId);
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast endActor:`, err.message);
    });
  }

  /**
   * Clear stale worker entries after parallel orchestrator completes.
   * Workers' last node (usually 'learn') stays in activeWorkers until cleared.
   */
  async clearWorkers(jobId: string, workerIds?: number[]): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (workerIds) {
        for (const wId of workerIds) {
          const info = this.activeWorkers.get(wId);
          if (info) {
            this.closeHistoryEntry(info.nodeId);
            this.activeWorkers.delete(wId);
          }
        }
      } else {
        // Clear all workers
        for (const info of this.activeWorkers.values()) {
          this.closeHistoryEntry(info.nodeId);
        }
        this.activeWorkers.clear();
      }
      this.rebuildActiveNodes();
      await this.broadcastState(false);
      console.log(`[WorkflowBroadcaster] Cleared workers: ${workerIds ? workerIds.join(',') : 'all'}`);
    });
  }

  /**
   * End job tracking
   */
  async endJob(jobId: string): Promise<void> {
    // Close all remaining history entries
    for (const worker of this.activeWorkers.values()) {
      this.closeHistoryEntry(worker.nodeId);
    }

    // Clear all active state
    this.activeWorkers.clear();
    this.state.activeNodes = [];
    this.state.isCompleted = true;
    this.state.endedAt = new Date().toISOString();
    this.state.activeActors = [];

    // Await broadcast to ensure endJob event is delivered before process exits
    try {
      await this.broadcastState(true);
    } catch (err: any) {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast endJob:`, err.message);
    }

    console.log(`[WorkflowBroadcaster] Job ended: ${jobId}`);
  }

  // ============================================
  // Internal helpers
  // ============================================

  /**
   * Rebuild activeNodes array from activeWorkers map
   */
  private rebuildActiveNodes(): void {
    this.state.activeNodes = Array.from(this.activeWorkers.entries())
      .map(([wId, info]) => ({
        workerId: wId,
        nodeId: info.nodeId,
        previousNodeId: info.previousNodeId,
        taskName: info.taskInfo.name,
        taskId: info.taskInfo.id || '',
        enteredAt: info.enteredAt,
      }));
  }

  /**
   * Close the most recent matching history entry
   */
  private closeHistoryEntry(nodeId: string): void {
    for (let i = this.state.nodeHistory.length - 1; i >= 0; i--) {
      const entry = this.state.nodeHistory[i];
      if (entry.nodeId === nodeId && !entry.exitedAt) {
        const exitTime = new Date().toISOString();
        entry.exitedAt = exitTime;
        entry.duration = new Date(exitTime).getTime() - new Date(entry.enteredAt).getTime();
        break;
      }
    }
  }

  /**
   * Broadcast workflow state via user-scoped Redis Pub/Sub channel
   */
  private async broadcastState(isEndEvent: boolean): Promise<void> {
    // 1. Write canonical WorkflowRealtimeState to Redis
    const key = `${WORKFLOW_STATE_KEY_PREFIX}${this.jobId}`;
    await this.redis.set(key, JSON.stringify(this.state), 'EX', WORKFLOW_STATE_TTL);

    // 2. Broadcast via user-scoped Redis Pub/Sub channel
    if (!this.userContext?.organizationId || !this.userContext?.userId) {
      console.warn(`[WorkflowBroadcaster] ⚠️ Cannot broadcast without userContext`);
      return;
    }
    
    const message: WorkflowBroadcastMessage = {
      jobId: this.jobId,
      data: this.state,
      isEndEvent,
      userContext: this.userContext,
    };

    const channel = getRealtimeWorkflowChannel(this.userContext.organizationId, this.userContext.userId);
    await this.pubRedis.publish(channel, JSON.stringify(message));
  }

  /**
   * Close Redis connections
   */
  async close(): Promise<void> {
    await this.redis.quit();
    await this.pubRedis.quit();
  }
}
