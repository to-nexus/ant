/**
 * RedisStateStore
 * 
 * Redis-based implementation of StateStorePort.
 * Suitable for cloud/distributed deployments.
 * 
 * Features:
 * - Persistent state storage
 * - Shared across multiple server instances
 * - Real-time pub/sub for state updates
 * - Automatic reconnection handling
 * 
 * Requirements:
 * - Redis server (standalone or cluster)
 * - ANT_REDIS_URL environment variable
 * 
 * @see 10-cloud-scalability-design.md Section 4.1
 */

import Redis from 'ioredis';
import {
  StateStorePort,
  JobStatusData,
  LogEntry,
  PortMapping,
  ChatSessionData,
  ChatMessageData,
  WorkflowRealtimeState,
  PendingChoiceData
} from '../../core/ports/stateStore';
import type { TaskQueueSnapshot, JobProjectMapping } from '../../core/types/task';
import { 
  PortRegistryPort, 
  PreviewState, 
  IDEState,
  PreviewPackage,
  PreviewRuntimeIssue
} from '../../core/ports/portRegistry';
import { createIDEKey, createPreviewKey } from './redisKeyUtils';
import { APP_PREFIX, REDIS_KEYS, REDIS_TTL, getRealtimeWorkflowChannel } from './redisConstants';
import { logger } from '../../utils/logger';

export interface RedisStateStoreOptions {
  url: string;
  maxRetriesPerRequest?: number;
}

export class RedisStateStore implements StateStorePort, PortRegistryPort {
  private redis: Redis;
  private subscriber: Redis;
  private subscriptions = new Map<string, Set<(message: unknown) => void>>();

  constructor(options: RedisStateStoreOptions) {
    
    // Check if TLS is enabled (rediss:// URL)
    const isTLS = options.url.startsWith('rediss://');
    
    /**
     * TLS options for AWS ElastiCache Serverless with custom CNAME
     * 
     * When using a custom domain (e.g., redis.mycompany.com) pointing to ElastiCache,
     * the TLS certificate is issued for *.serverless.*.cache.amazonaws.com, not the custom domain.
     * This causes hostname verification to fail.
     * 
     * Security Note: Skipping hostname verification is acceptable when:
     * 1. Network is trusted (VPC, private subnet, security groups)
     * 2. DNS is trusted (Route53, no risk of DNS spoofing)
     * 3. Connection is still encrypted (TLS encrypts data in transit)
     * 
     * @see infrastructure/utils/redis.ts for detailed documentation
     */
    const tlsOptions = isTLS ? {
      tls: {
        checkServerIdentity: () => undefined
      }
    } : {};
    
    // Main connection for commands
    this.redis = new Redis(options.url, {
      ...tlsOptions,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('Redis connection failed after 10 retries', { component: 'RedisStateStore' });
          return null;
        }
        return Math.min(times * 100, 3000);
      }
    });

    // Separate connection for pub/sub (required by Redis)
    this.subscriber = new Redis(options.url, {
      ...tlsOptions,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3
    });

    this.setupEventHandlers();
    this.setupSubscriber();
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('Redis connected', { component: 'RedisStateStore' });
    });

    this.redis.on('error', (err: Error) => {
      logger.error('Redis error', { component: 'RedisStateStore' }, err);
    });

    this.redis.on('close', () => {
      logger.warn('Redis connection closed', { component: 'RedisStateStore' });
    });
  }

  private setupSubscriber(): void {
    this.subscriber.on('message', (channel: string, message: string) => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        try {
          const parsed = JSON.parse(message);
          for (const callback of callbacks) {
            callback(parsed);
          }
        } catch (error) {
          logger.error(`Failed to parse pub/sub message for channel ${channel}`, { component: 'RedisStateStore' }, error);
        }
      }
    });
  }

  /** Build Redis key from central constant + parts (e.g., key(REDIS_KEYS.JOB.STATUS, jobId)) */
  private key(prefix: string, ...parts: string[]): string {
    return `${prefix}${parts.join(':')}`;
  }

  // ============================================
  // Job Status Management
  // ============================================

  async setJobStatus(jobId: string, status: JobStatusData): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.STATUS, jobId);
    const featureKey = this.key(REDIS_KEYS.INDEX.JOBS_BY_FEATURE, `${status.projectId}:${status.featureName}`);

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(status), 'EX', REDIS_TTL.JOB.STATUS);
    pipeline.sadd(featureKey, jobId);
    pipeline.expire(featureKey, REDIS_TTL.JOB.STATUS);
    
    await pipeline.exec();

    logger.debug(`Job status set: ${status.status}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatusData | null> {
    const key = this.key(REDIS_KEYS.JOB.STATUS, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async updateJobStatus(jobId: string, updates: Partial<JobStatusData>): Promise<void> {
    const current = await this.getJobStatus(jobId);
    if (current) {
      await this.setJobStatus(jobId, { ...current, ...updates });
    }
  }

  async deleteJobStatus(jobId: string): Promise<void> {
    const status = await this.getJobStatus(jobId);
    
    const pipeline = this.redis.pipeline();
    pipeline.del(this.key(REDIS_KEYS.JOB.STATUS, jobId));
    
    if (status) {
      const featureKey = this.key(REDIS_KEYS.INDEX.JOBS_BY_FEATURE, `${status.projectId}:${status.featureName}`);
      pipeline.srem(featureKey, jobId);
    }
    
    await pipeline.exec();
    
    logger.debug(`Job status deleted`, { component: 'RedisStateStore', jobId });
  }

  async listJobsByFeature(projectId: string, featureName: string): Promise<JobStatusData[]> {
    const featureKey = this.key(REDIS_KEYS.INDEX.JOBS_BY_FEATURE, `${projectId}:${featureName}`);
    const jobIds = await this.redis.smembers(featureKey);

    if (jobIds.length === 0) {
      return [];
    }

    const keys = jobIds.map((id: string) => this.key(REDIS_KEYS.JOB.STATUS, id));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => JSON.parse(r));
  }

  // ============================================
  // Job Logs Management
  // ============================================

  async appendJobLog(jobId: string, log: LogEntry): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.LOGS, jobId);
    const logWithTimestamp = {
      ...log,
      timestamp: log.timestamp || new Date().toISOString()
    };

    await this.redis.rpush(key, JSON.stringify(logWithTimestamp));
    await this.redis.expire(key, REDIS_TTL.JOB.LOGS);

    // Publish for real-time streaming
    await this.publish(`job:${jobId}:logs`, logWithTimestamp);
  }

  async getJobLogs(jobId: string): Promise<LogEntry[]> {
    const key = this.key(REDIS_KEYS.JOB.LOGS, jobId);
    const logs = await this.redis.lrange(key, 0, -1);
    return logs.map((l: string) => JSON.parse(l));
  }

  async clearJobLogs(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.LOGS, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Task Queue Snapshot Management
  // ============================================

  async updateTaskQueue(jobId: string, snapshot: TaskQueueSnapshot): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId);
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', REDIS_TTL.JOB.TASK_QUEUE);

    // Publish for real-time updates
    await this.publish(`job:${jobId}:taskQueue`, snapshot);

    logger.debug(`Task queue updated: queue=${snapshot.queue.length}, completed=${snapshot.completedTasks.length}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getTaskQueue(jobId: string): Promise<TaskQueueSnapshot | null> {
    const key = this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteTaskQueue(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Workflow State Management (Cross-Pod)
  // ============================================

  async setWorkflowState(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.WORKFLOW, jobId);
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.JOB.WORKFLOW);
    
    // Get userContext from job mapping for user-scoped channel
    const mapping = await this.getJobMapping(jobId);
    if (!mapping?.userContext?.organizationId || !mapping?.userContext?.userId) {
      logger.warn(`Cannot publish workflow state without userContext`, {
        component: 'RedisStateStore',
        jobId
      });
      return;
    }
    
    // Publish to user-scoped channel for real-time SSE updates
    const channel = getRealtimeWorkflowChannel(mapping.userContext.organizationId, mapping.userContext.userId);
    await this.publish(channel, { jobId, data: state, isEndEvent: false, userContext: mapping.userContext });
    
    logger.debug(`Workflow state set: activeNodes=${state.activeNodes?.length ?? 0}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getWorkflowState(jobId: string): Promise<WorkflowRealtimeState | null> {
    const key = this.key(REDIS_KEYS.JOB.WORKFLOW, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteWorkflowState(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.WORKFLOW, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Job-Project Mapping
  // ============================================

  async setJobMapping(jobId: string, mapping: JobProjectMapping): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.MAPPING, jobId);
    await this.redis.set(key, JSON.stringify(mapping), 'EX', REDIS_TTL.JOB.STATUS);
  }

  async getJobMapping(jobId: string): Promise<JobProjectMapping | null> {
    const key = this.key(REDIS_KEYS.JOB.MAPPING, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteJobMapping(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.MAPPING, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // User-Stopped Jobs Tracking
  // ============================================

  async markUserStopped(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.USER_STOPPED, jobId);
    await this.redis.set(key, '1', 'EX', REDIS_TTL.JOB.USER_STOPPED);
  }

  async isUserStopped(jobId: string): Promise<boolean> {
    const key = this.key(REDIS_KEYS.JOB.USER_STOPPED, jobId);
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async clearUserStopped(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.USER_STOPPED, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Port Registry - Preview (Full State Management)
  // ============================================

  /**
   * Register/Update preview state (full state)
   * Called when preview server starts
   */
  async registerPreview(state: Omit<PreviewState, 'lastAccessedAt'>): Promise<void> {
    const { tenantId, userId, projectId, feature, port, host, podId } = state;
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    
    const fullState: PreviewState = {
      ...state,
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(fullState), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    pipeline.sadd(REDIS_KEYS.INFRA.PREVIEW_LIST, portKey);
    // Index by podId for cleanup on pod restart
    pipeline.sadd(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, podId), portKey);
    await pipeline.exec();

    logger.info(`[Preview] Registered: ${portKey} → ${host}:${port} (pod: ${podId})`, { component: 'RedisStateStore' });
  }

  /**
   * Get preview state
   * Does NOT auto-update lastAccessedAt (use touchPreview for that)
   */
  async getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewState | null> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const state: PreviewState = JSON.parse(data);
    // Parse dates
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    
    return state;
  }

  /**
   * Get preview port (convenience method)
   */
  async getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const state = await this.getPreview(tenantId, userId, projectId, feature);
    return state?.port ?? null;
  }

  /**
   * Update preview state (partial update)
   * For updating running, ready, issues, packages without re-registering
   */
  async updatePreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath'>>
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      logger.warn(`[Preview] updatePreview: NOT FOUND ${portKey}`, { component: 'RedisStateStore' });
      return;
    }

    const state: PreviewState = JSON.parse(data);
    const updated: PreviewState = {
      ...state,
      ...update,
      lastAccessedAt: new Date()
    };

    await this.redis.set(key, JSON.stringify(updated), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    logger.debug(`[Preview] Updated: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * Update last accessed time (called on proxy request)
   */
  async touchPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: PreviewState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
  }

  /**
   * Unregister preview (delete state)
   */
  async unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW, portKey);
    
    // Get state to find podId for index cleanup
    const data = await this.redis.get(key);
    
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(REDIS_KEYS.INFRA.PREVIEW_LIST), portKey);
    
    // Cleanup pod index if state exists
    if (data) {
      const state: PreviewState = JSON.parse(data);
      pipeline.srem(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, state.podId), portKey);
    }
    
    await pipeline.exec();
    logger.info(`[Preview] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active previews
   */
  async listPreviews(): Promise<PreviewState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.PREVIEW_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.PREVIEW, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: PreviewState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  /**
   * List previews for a specific pod (for cleanup on pod restart)
   */
  async listPreviewsByPod(podId: string): Promise<PreviewState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.PREVIEW_BY_POD, podId));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.PREVIEW, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: PreviewState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  /**
   * Get idle previews (for auto-cleanup)
   * @param idleThresholdMs - Milliseconds since last access
   */
  async getIdlePreviews(idleThresholdMs: number): Promise<PreviewState[]> {
    const allPreviews = await this.listPreviews();
    const now = Date.now();
    
    return allPreviews.filter(preview => {
      const lastAccess = new Date(preview.lastAccessedAt).getTime();
      return (now - lastAccess) > idleThresholdMs;
    });
  }

  // ============================================
  // Port Registry - IDE (Full State Management)
  // ============================================

  /**
   * Register IDE state
   */
  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number,
    host: string,
    podId: string
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    
    const state: IDEState = {
      tenantId,
      userId,
      projectId,
      running: true,
      ready: true,
      port,
      host,
      podId,
      startedAt: new Date(),
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
    pipeline.sadd(this.key(REDIS_KEYS.INFRA.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`[IDE] Registered: ${portKey} → ${host}:${port} (pod: ${podId})`, { component: 'RedisStateStore' });
  }

  /**
   * Get IDE state
   */
  async getIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<IDEState | null> {
    // Validate all key components are present
    if (!tenantId || !userId || !projectId) {
      logger.warn(`[IDE] getIDE() INVALID ARGS: tenantId=${tenantId}, userId=${userId}, projectId=${projectId}`, { component: 'RedisStateStore' });
      return null;
    }
    
    const portKey = createIDEKey(tenantId, userId, projectId);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const state: IDEState = JSON.parse(data);
    // Parse dates
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);

    return state;
  }

  /**
   * Get IDE port (convenience method)
   */
  async getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<number | null> {
    const state = await this.getIDE(tenantId, userId, projectId);
    return state?.port ?? null;
  }

  /**
   * Update last accessed time
   */
  async touchIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: IDEState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.PORT_MAPPING);
  }

  /**
   * Unregister IDE
   */
  async unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId);
    const key = this.key(REDIS_KEYS.INFRA.IDE, portKey);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(REDIS_KEYS.INFRA.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`[IDE] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active IDEs
   */
  async listIDEs(): Promise<IDEState[]> {
    const portKeys = await this.redis.smembers(this.key(REDIS_KEYS.INFRA.IDE_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(REDIS_KEYS.INFRA.IDE, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => {
        const state: IDEState = JSON.parse(r);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
      });
  }

  // ============================================
  // Distributed Locking
  // ============================================

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // ============================================
  // Pub/Sub
  // ============================================

  async publish(channel: string, message: unknown): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: unknown) => void): Promise<() => void> {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }

    this.subscriptions.get(channel)!.add(callback);

    // Return unsubscribe function
    return async () => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(channel);
          await this.subscriber.unsubscribe(channel);
        }
      }
    };
  }

  // ============================================
  // Chat Session Management
  // ============================================

  async getChatSession(sessionKey: string): Promise<ChatSessionData | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.CHAT.SESSION, sessionKey));
    
    if (!data) return null;
    
    try {
      return JSON.parse(data) as ChatSessionData;
    } catch (e) {
      logger.error(`Failed to parse chat session: ${sessionKey}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  async setChatSession(sessionKey: string, session: ChatSessionData): Promise<void> {
    await this.redis.setex(
      this.key(REDIS_KEYS.CHAT.SESSION, sessionKey),
      REDIS_TTL.CHAT.SESSION,
      JSON.stringify(session)
    );
    
    logger.debug(`Chat session stored: ${sessionKey} (${session.messages?.length || 0} messages)`, { component: 'RedisStateStore' });
  }

  async deleteChatSession(sessionKey: string): Promise<void> {
    await this.redis.del(this.key(REDIS_KEYS.CHAT.SESSION, sessionKey));
    // Also delete current message if exists
    await this.redis.del(this.key(REDIS_KEYS.CHAT.CURRENT_MESSAGE, sessionKey));
  }

  async getCurrentMessage(sessionKey: string): Promise<ChatMessageData | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.CHAT.CURRENT_MESSAGE, sessionKey));
    
    if (!data) return null;
    
    try {
      return JSON.parse(data) as ChatMessageData;
    } catch (e) {
      logger.error(`Failed to parse current message: ${sessionKey}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  async setCurrentMessage(sessionKey: string, message: ChatMessageData | null): Promise<void> {
    const key = this.key(REDIS_KEYS.CHAT.CURRENT_MESSAGE, sessionKey);
    
    if (message === null) {
      await this.redis.del(key);
      logger.debug(`Current message cleared: ${sessionKey}`, { component: 'RedisStateStore' });
    } else {
      await this.redis.setex(key, REDIS_TTL.CHAT.CURRENT_MESSAGE, JSON.stringify(message));
      logger.debug(`Current message stored: ${sessionKey} (${message.id})`, { component: 'RedisStateStore' });
    }
  }

  async hasActiveMessage(sessionKey: string): Promise<boolean> {
    const exists = await this.redis.exists(this.key(REDIS_KEYS.CHAT.CURRENT_MESSAGE, sessionKey));
    return exists === 1;
  }

  // ============================================
  // Pending Choice Management
  // ============================================

  async setPendingChoice(choiceKey: string, choice: PendingChoiceData): Promise<void> {
    // Use dynamic TTL based on expiresAt
    const ttlSeconds = Math.max(1, Math.ceil((choice.expiresAt - Date.now()) / 1000));
    
    await this.redis.setex(
      this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey),
      ttlSeconds,
      JSON.stringify(choice)
    );
    
    logger.debug(`Pending choice stored: ${choiceKey} (TTL: ${ttlSeconds}s)`, { component: 'RedisStateStore' });
  }

  async getPendingChoice(choiceKey: string): Promise<PendingChoiceData | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey));
    
    if (!data) return null;
    
    try {
      const choice = JSON.parse(data) as PendingChoiceData;
      
      // Double-check expiry (Redis TTL might be slightly off)
      if (Date.now() > choice.expiresAt) {
        await this.deletePendingChoice(choiceKey);
        return null;
      }
      
      return choice;
    } catch (e) {
      logger.error(`Failed to parse pending choice: ${choiceKey}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  async deletePendingChoice(choiceKey: string): Promise<void> {
    await this.redis.del(this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey));
    logger.debug(`Pending choice deleted: ${choiceKey}`, { component: 'RedisStateStore' });
  }

  // ============================================
  // Lifecycle
  // ============================================

  async close(): Promise<void> {
    logger.info('Closing Redis connections', { component: 'RedisStateStore' });
    
    await this.subscriber.quit();
    await this.redis.quit();
    
    this.subscriptions.clear();
  }

  async clear(): Promise<void> {
    // WARNING: This deletes all keys with the prefix
    const keys = await this.redis.keys(`${APP_PREFIX}:*`);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    logger.info('Cleared all state', { component: 'RedisStateStore' });
  }

  // ============================================
  // Health Check
  // ============================================

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // ============================================
  // Stats (for debugging/monitoring)
  // ============================================

  async getStats(): Promise<{
    jobs: number;
    previews: number;
    ides: number;
    subscriptions: number;
  }> {
    const [jobKeys, previewMembers, ideMembers] = await Promise.all([
      this.redis.keys(`${REDIS_KEYS.JOB.STATUS}*`),
      this.redis.scard(REDIS_KEYS.INFRA.PREVIEW_LIST),
      this.redis.scard(REDIS_KEYS.INFRA.IDE_LIST)
    ]);

    return {
      jobs: jobKeys.length,
      previews: previewMembers,
      ides: ideMembers,
      subscriptions: this.subscriptions.size
    };
  }
}
