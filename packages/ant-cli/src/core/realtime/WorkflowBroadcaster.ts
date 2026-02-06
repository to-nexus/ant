/**
 * WorkflowBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for Workflow state updates.
 * Replaces HTTP-based WorkflowHttpClient for Job Worker child processes.
 * 
 * Architecture:
 * - Implements WorkflowStateUpdatePort for compatibility
 * - Directly writes to Redis (state storage + Pub/Sub broadcast)
 * - No HTTP intermediary required
 * 
 * Flow:
 *   Job Worker Child → WorkflowBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import { WorkflowStateUpdatePort, TaskInfo, LLMInfo } from '../ports/workflow';
import { 
  getSSEWorkflowChannel,
  WORKFLOW_STATE_KEY_PREFIX,
  WORKFLOW_STATE_TTL,
  WorkflowState,
  WorkflowBroadcastMessage,
  BroadcasterOptions 
} from './types';
import { UserContext } from '../types/user';

export class WorkflowBroadcaster implements WorkflowStateUpdatePort {
  private redis: Redis;
  private pubRedis: Redis; // Separate connection for publish
  private readonly jobId: string;
  private readonly userContext?: UserContext;
  
  // In-memory state tracking (for building workflow state)
  private currentNode?: string;
  private nodeHistory: string[] = [];
  private activeActors: Set<string> = new Set();
  private startTime: number = Date.now();
  private lastUpdate: number = Date.now();
  private taskInfo?: TaskInfo;
  private llmInfo?: LLMInfo;
  private recursionCount?: number;
  private recursionLimit?: number;
  
  constructor(options: BroadcasterOptions) {
    const redisOpts = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      ...(options.redisTLS ? { tls: options.redisTLS } : {}),
    };
    this.redis = new Redis(options.redisUrl, redisOpts);
    this.pubRedis = new Redis(options.redisUrl, redisOpts);
    this.jobId = options.jobId;
    this.userContext = options.userContext;
    
    console.log(`✅ [WorkflowBroadcaster] Initialized for job: ${this.jobId}`);
  }

  /**
   * Start job tracking
   */
  startJob(jobId: string, llmInfo?: LLMInfo): void {
    this.startTime = Date.now();
    this.lastUpdate = Date.now();
    this.llmInfo = llmInfo;
    this.nodeHistory = [];
    this.activeActors.clear();
    this.currentNode = undefined;
    
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
    this.lastUpdate = Date.now();
    this.currentNode = nodeId;
    this.nodeHistory.push(nodeId);
    
    if (taskInfo) {
      this.taskInfo = taskInfo;
    }
    if (llmInfo) {
      this.llmInfo = llmInfo;
    }
    if (recursionCount !== undefined) {
      this.recursionCount = recursionCount;
    }
    if (recursionLimit !== undefined) {
      this.recursionLimit = recursionLimit;
    }
    
    await this.broadcastState(false);
    console.log(`[WorkflowBroadcaster] Enter node: ${nodeId}${taskInfo ? ` (task: ${taskInfo.name})` : ''}`);
  }

  /**
   * Track node exit
   */
  exitNode(jobId: string, nodeId: string): void {
    this.lastUpdate = Date.now();
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast exitNode:`, err.message);
    });
  }

  /**
   * Track actor interaction start
   */
  startActorInteraction(jobId: string, actorId: string): void {
    this.lastUpdate = Date.now();
    this.activeActors.add(actorId);
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast startActor:`, err.message);
    });
  }

  /**
   * Track actor interaction end
   */
  endActorInteraction(jobId: string, actorId: string): void {
    this.lastUpdate = Date.now();
    this.activeActors.delete(actorId);
    
    // Fire-and-forget broadcast
    this.broadcastState(false).catch(err => {
      console.warn(`[WorkflowBroadcaster] Failed to broadcast endActor:`, err.message);
    });
  }

  /**
   * End job tracking
   */
  endJob(jobId: string): void {
    this.lastUpdate = Date.now();
    
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
    // 1. Build state
    const state: WorkflowState = {
      jobId: this.jobId,
      currentNode: this.currentNode,
      nodeHistory: [...this.nodeHistory],
      activeActors: Array.from(this.activeActors),
      startTime: this.startTime,
      lastUpdate: this.lastUpdate,
      taskInfo: this.taskInfo,
      llmInfo: this.llmInfo,
      recursionCount: this.recursionCount,
      recursionLimit: this.recursionLimit,
    };

    // 2. Save state to Redis (use central key prefix for consistency)
    const key = `${WORKFLOW_STATE_KEY_PREFIX}${this.jobId}`;
    await this.redis.set(key, JSON.stringify(state), 'EX', WORKFLOW_STATE_TTL);

    // 3. Broadcast via user-scoped Redis Pub/Sub channel
    if (!this.userContext?.organizationId || !this.userContext?.userId) {
      console.warn(`[WorkflowBroadcaster] ⚠️ Cannot broadcast without userContext`);
      return;
    }
    
    const message: WorkflowBroadcastMessage = {
      jobId: this.jobId,
      data: state,
      isEndEvent,
      userContext: this.userContext,
    };

    const channel = getSSEWorkflowChannel(this.userContext.organizationId, this.userContext.userId);
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
