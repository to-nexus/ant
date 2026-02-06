/**
 * WorkflowBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Workflow state updates.
 * Used by Job Worker child processes to broadcast workflow state.
 * 
 * Architecture:
 * - Implements WorkflowStateUpdatePort for compatibility
 * - Maintains in-memory WorkflowRealtimeState (canonical type from core/ports/stateStore.ts)
 * - Writes to Redis and publishes via Redis Pub/Sub
 * - No HTTP intermediary required
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

export class WorkflowBroadcaster implements WorkflowStateUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly userContext?: UserContext;
  
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
      currentNode: null,
      previousNode: null,
      currentTask: null,
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
    this.state = {
      jobId: this.jobId,
      currentNode: null,
      previousNode: null,
      currentTask: null,
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
   * Returns Promise to ensure SSE ordering
   */
  async enterNode(
    jobId: string, 
    nodeId: string, 
    taskInfo?: TaskInfo, 
    llmInfo?: LLMInfo,
    recursionCount?: number,
    recursionLimit?: number
  ): Promise<void> {
    // Close previous node's history entry
    if (this.state.currentNode && this.state.nodeHistory.length > 0) {
      const lastEntry = this.state.nodeHistory[this.state.nodeHistory.length - 1];
      if (lastEntry && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
      }
    }
    
    // Update state
    this.state.previousNode = this.state.currentNode;
    this.state.currentNode = nodeId;
    this.state.nodeHistory.push({
      nodeId,
      enteredAt: new Date().toISOString()
    });
    
    if (taskInfo) {
      this.state.currentTask = taskInfo;
    }
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
    console.log(`[WorkflowBroadcaster] Enter node: ${nodeId}${taskInfo ? ` (task: ${taskInfo.name})` : ''}`);
  }

  /**
   * Track node exit
   */
  exitNode(jobId: string, nodeId: string): void {
    // Close matching node's history entry
    if (this.state.nodeHistory.length > 0) {
      const lastEntry = this.state.nodeHistory[this.state.nodeHistory.length - 1];
      if (lastEntry && lastEntry.nodeId === nodeId && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
      }
    }
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast exitNode:`, err.message);
    });
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
   * End job tracking
   */
  endJob(jobId: string): void {
    // Close last node's history entry
    if (this.state.currentNode && this.state.nodeHistory.length > 0) {
      const lastEntry = this.state.nodeHistory[this.state.nodeHistory.length - 1];
      if (lastEntry && !lastEntry.exitedAt) {
        const exitTime = new Date().toISOString();
        lastEntry.exitedAt = exitTime;
        lastEntry.duration = new Date(exitTime).getTime() - new Date(lastEntry.enteredAt).getTime();
      }
    }
    
    // Mark as completed
    this.state.isCompleted = true;
    this.state.endedAt = new Date().toISOString();
    this.state.currentNode = null;
    this.state.activeActors = [];
    
    // Fire-and-forget broadcast (isEndEvent: true)
    this.broadcastState(true).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast endJob:`, err.message);
    });
    
    console.log(`[WorkflowBroadcaster] Job ended: ${jobId}`);
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
