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
  TaskQueueSnapshot,
  JobProjectMapping,
  PortMapping,
  ChatSessionData,
  ChatMessageData,
  WorkflowRealtimeState,
  PendingChoiceData
} from '../../core/ports/stateStore';
import { 
  PortRegistryPort, 
  PreviewState, 
  IDEState,
  PreviewPackage,
  PreviewRuntimeIssue
} from '../../core/ports/portRegistry';
import { createIDEKey, createPreviewKey } from './redisKeyUtils';
import { logger } from '../../utils/logger';

// Redis key prefixes
const KEYS = {
  JOB_STATUS: 'ant:job:status:',
  JOB_LOGS: 'ant:job:logs:',
  TASK_QUEUE: 'ant:job:taskQueue:',
  JOB_MAPPING: 'ant:job:mapping:',
  USER_STOPPED: 'ant:job:userStopped:',
  JOBS_BY_FEATURE: 'ant:index:jobsByFeature:',
  PREVIEW: 'ant:preview:',
  IDE: 'ant:ide:',
  PREVIEW_LIST: 'ant:previews',
  IDE_LIST: 'ant:ides',
  // Chat session keys
  CHAT_SESSION: 'ant:chat:session:',
  CHAT_CURRENT_MESSAGE: 'ant:chat:currentMessage:',
  // Workflow state keys
  WORKFLOW_STATE: 'ant:workflow:state:',
  // Pending choice keys
  PENDING_CHOICE: 'ant:choice:pending:'
} as const;

// Default TTLs (in seconds)
const TTL = {
  JOB_STATUS: 24 * 60 * 60,      // 24 hours
  JOB_LOGS: 7 * 24 * 60 * 60,    // 7 days
  TASK_QUEUE: 24 * 60 * 60,      // 24 hours
  PORT_MAPPING: 24 * 60 * 60,    // 24 hours
  USER_STOPPED: 60 * 60,         // 1 hour
  CHAT_SESSION: 24 * 60 * 60,    // 24 hours
  CHAT_CURRENT_MESSAGE: 60 * 60, // 1 hour (streaming message)
  WORKFLOW_STATE: 24 * 60 * 60,  // 24 hours
  PENDING_CHOICE: 30 * 60        // 30 minutes (matches ChoiceService DEFAULT_EXPIRY_MS)
} as const;

export interface RedisStateStoreOptions {
  url: string;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
}

export class RedisStateStore implements StateStorePort, PortRegistryPort {
  private redis: Redis;
  private subscriber: Redis;
  private subscriptions = new Map<string, Set<(message: unknown) => void>>();
  private keyPrefix: string;

  constructor(options: RedisStateStoreOptions) {
    this.keyPrefix = options.keyPrefix || '';
    
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

  private key(prefix: string, ...parts: string[]): string {
    return `${this.keyPrefix}${prefix}${parts.join(':')}`;
  }

  // ============================================
  // Job Status Management
  // ============================================

  async setJobStatus(jobId: string, status: JobStatusData): Promise<void> {
    const key = this.key(KEYS.JOB_STATUS, jobId);
    const featureKey = this.key(KEYS.JOBS_BY_FEATURE, `${status.projectId}:${status.featureName}`);

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(status), 'EX', TTL.JOB_STATUS);
    pipeline.sadd(featureKey, jobId);
    pipeline.expire(featureKey, TTL.JOB_STATUS);
    
    await pipeline.exec();

    logger.debug(`Job status set: ${status.status}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatusData | null> {
    const key = this.key(KEYS.JOB_STATUS, jobId);
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
    pipeline.del(this.key(KEYS.JOB_STATUS, jobId));
    
    if (status) {
      const featureKey = this.key(KEYS.JOBS_BY_FEATURE, `${status.projectId}:${status.featureName}`);
      pipeline.srem(featureKey, jobId);
    }
    
    await pipeline.exec();
    
    logger.debug(`Job status deleted`, { component: 'RedisStateStore', jobId });
  }

  async listJobsByFeature(projectId: string, featureName: string): Promise<JobStatusData[]> {
    const featureKey = this.key(KEYS.JOBS_BY_FEATURE, `${projectId}:${featureName}`);
    const jobIds = await this.redis.smembers(featureKey);

    if (jobIds.length === 0) {
      return [];
    }

    const keys = jobIds.map((id: string) => this.key(KEYS.JOB_STATUS, id));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => JSON.parse(r));
  }

  // ============================================
  // Job Logs Management
  // ============================================

  async appendJobLog(jobId: string, log: LogEntry): Promise<void> {
    const key = this.key(KEYS.JOB_LOGS, jobId);
    const logWithTimestamp = {
      ...log,
      timestamp: log.timestamp || new Date().toISOString()
    };

    await this.redis.rpush(key, JSON.stringify(logWithTimestamp));
    await this.redis.expire(key, TTL.JOB_LOGS);

    // Publish for real-time streaming
    await this.publish(`job:${jobId}:logs`, logWithTimestamp);
  }

  async getJobLogs(jobId: string): Promise<LogEntry[]> {
    const key = this.key(KEYS.JOB_LOGS, jobId);
    const logs = await this.redis.lrange(key, 0, -1);
    return logs.map((l: string) => JSON.parse(l));
  }

  async clearJobLogs(jobId: string): Promise<void> {
    const key = this.key(KEYS.JOB_LOGS, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Task Queue Snapshot Management
  // ============================================

  async updateTaskQueue(jobId: string, snapshot: TaskQueueSnapshot): Promise<void> {
    const key = this.key(KEYS.TASK_QUEUE, jobId);
    await this.redis.set(key, JSON.stringify(snapshot), 'EX', TTL.TASK_QUEUE);

    // Publish for real-time updates
    await this.publish(`job:${jobId}:taskQueue`, snapshot);

    logger.debug(`Task queue updated: queue=${snapshot.queue.length}, completed=${snapshot.completedTasks.length}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getTaskQueue(jobId: string): Promise<TaskQueueSnapshot | null> {
    const key = this.key(KEYS.TASK_QUEUE, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteTaskQueue(jobId: string): Promise<void> {
    const key = this.key(KEYS.TASK_QUEUE, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Workflow State Management (Cross-Pod)
  // ============================================

  async setWorkflowState(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    const key = this.key(KEYS.WORKFLOW_STATE, jobId);
    await this.redis.set(key, JSON.stringify(state), 'EX', TTL.WORKFLOW_STATE);
    
    // Publish for real-time SSE updates via SSEService
    await this.publish('sse:workflow', { jobId, data: state, isEndEvent: false });
    
    logger.debug(`Workflow state set: node=${state.currentNode}`, {
      component: 'RedisStateStore',
      jobId
    });
  }

  async getWorkflowState(jobId: string): Promise<WorkflowRealtimeState | null> {
    const key = this.key(KEYS.WORKFLOW_STATE, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteWorkflowState(jobId: string): Promise<void> {
    const key = this.key(KEYS.WORKFLOW_STATE, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Job-Project Mapping
  // ============================================

  async setJobMapping(jobId: string, mapping: JobProjectMapping): Promise<void> {
    const key = this.key(KEYS.JOB_MAPPING, jobId);
    await this.redis.set(key, JSON.stringify(mapping), 'EX', TTL.JOB_STATUS);
  }

  async getJobMapping(jobId: string): Promise<JobProjectMapping | null> {
    const key = this.key(KEYS.JOB_MAPPING, jobId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteJobMapping(jobId: string): Promise<void> {
    const key = this.key(KEYS.JOB_MAPPING, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // User-Stopped Jobs Tracking
  // ============================================

  async markUserStopped(jobId: string): Promise<void> {
    const key = this.key(KEYS.USER_STOPPED, jobId);
    await this.redis.set(key, '1', 'EX', TTL.USER_STOPPED);
  }

  async isUserStopped(jobId: string): Promise<boolean> {
    const key = this.key(KEYS.USER_STOPPED, jobId);
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async clearUserStopped(jobId: string): Promise<void> {
    const key = this.key(KEYS.USER_STOPPED, jobId);
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
    const key = this.key(KEYS.PREVIEW, portKey);
    
    const fullState: PreviewState = {
      ...state,
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(fullState), 'EX', TTL.PORT_MAPPING);
    pipeline.sadd(this.key(KEYS.PREVIEW_LIST), portKey);
    // Index by podId for cleanup on pod restart
    pipeline.sadd(this.key('ant:preview:byPod:', podId), portKey);
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
    const key = this.key(KEYS.PREVIEW, portKey);
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
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'issues' | 'packages' | 'backendPort'>>
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.PREVIEW, portKey);
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

    await this.redis.set(key, JSON.stringify(updated), 'EX', TTL.PORT_MAPPING);
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
    const key = this.key(KEYS.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: PreviewState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', TTL.PORT_MAPPING);
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
    const key = this.key(KEYS.PREVIEW, portKey);
    
    // Get state to find podId for index cleanup
    const data = await this.redis.get(key);
    
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(KEYS.PREVIEW_LIST), portKey);
    
    // Cleanup pod index if state exists
    if (data) {
      const state: PreviewState = JSON.parse(data);
      pipeline.srem(this.key('ant:preview:byPod:', state.podId), portKey);
    }
    
    await pipeline.exec();
    logger.info(`[Preview] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active previews
   */
  async listPreviews(): Promise<PreviewState[]> {
    const portKeys = await this.redis.smembers(this.key(KEYS.PREVIEW_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(KEYS.PREVIEW, pk));
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
    const portKeys = await this.redis.smembers(this.key('ant:preview:byPod:', podId));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(KEYS.PREVIEW, pk));
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
    const key = this.key(KEYS.IDE, portKey);
    
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
    pipeline.set(key, JSON.stringify(state), 'EX', TTL.PORT_MAPPING);
    pipeline.sadd(this.key(KEYS.IDE_LIST), portKey);
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
    const key = this.key(KEYS.IDE, portKey);
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
    const key = this.key(KEYS.IDE, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return;
    }

    const state: IDEState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', TTL.PORT_MAPPING);
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
    const key = this.key(KEYS.IDE, portKey);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(KEYS.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`[IDE] Unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * List all active IDEs
   */
  async listIDEs(): Promise<IDEState[]> {
    const portKeys = await this.redis.smembers(this.key(KEYS.IDE_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(KEYS.IDE, pk));
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
  // Pub/Sub
  // ============================================

  async publish(channel: string, message: unknown): Promise<void> {
    const fullChannel = `${this.keyPrefix}${channel}`;
    await this.redis.publish(fullChannel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: unknown) => void): Promise<() => void> {
    const fullChannel = `${this.keyPrefix}${channel}`;

    if (!this.subscriptions.has(fullChannel)) {
      this.subscriptions.set(fullChannel, new Set());
      await this.subscriber.subscribe(fullChannel);
    }

    this.subscriptions.get(fullChannel)!.add(callback);

    // Return unsubscribe function
    return async () => {
      const callbacks = this.subscriptions.get(fullChannel);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(fullChannel);
          await this.subscriber.unsubscribe(fullChannel);
        }
      }
    };
  }

  // ============================================
  // Chat Session Management
  // ============================================

  async getChatSession(sessionKey: string): Promise<ChatSessionData | null> {
    const data = await this.redis.get(this.key(KEYS.CHAT_SESSION + sessionKey));
    
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
      this.key(KEYS.CHAT_SESSION + sessionKey),
      TTL.CHAT_SESSION,
      JSON.stringify(session)
    );
    
    logger.debug(`Chat session stored: ${sessionKey} (${session.messages?.length || 0} messages)`, { component: 'RedisStateStore' });
  }

  async deleteChatSession(sessionKey: string): Promise<void> {
    await this.redis.del(this.key(KEYS.CHAT_SESSION + sessionKey));
    // Also delete current message if exists
    await this.redis.del(this.key(KEYS.CHAT_CURRENT_MESSAGE + sessionKey));
  }

  async getCurrentMessage(sessionKey: string): Promise<ChatMessageData | null> {
    const data = await this.redis.get(this.key(KEYS.CHAT_CURRENT_MESSAGE + sessionKey));
    
    if (!data) return null;
    
    try {
      return JSON.parse(data) as ChatMessageData;
    } catch (e) {
      logger.error(`Failed to parse current message: ${sessionKey}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  async setCurrentMessage(sessionKey: string, message: ChatMessageData | null): Promise<void> {
    const key = this.key(KEYS.CHAT_CURRENT_MESSAGE + sessionKey);
    
    if (message === null) {
      await this.redis.del(key);
      logger.debug(`Current message cleared: ${sessionKey}`, { component: 'RedisStateStore' });
    } else {
      await this.redis.setex(key, TTL.CHAT_CURRENT_MESSAGE, JSON.stringify(message));
      logger.debug(`Current message stored: ${sessionKey} (${message.id})`, { component: 'RedisStateStore' });
    }
  }

  async hasActiveMessage(sessionKey: string): Promise<boolean> {
    const exists = await this.redis.exists(this.key(KEYS.CHAT_CURRENT_MESSAGE + sessionKey));
    return exists === 1;
  }

  // ============================================
  // Pending Choice Management
  // ============================================

  async setPendingChoice(choiceKey: string, choice: PendingChoiceData): Promise<void> {
    // Use dynamic TTL based on expiresAt
    const ttlSeconds = Math.max(1, Math.ceil((choice.expiresAt - Date.now()) / 1000));
    
    await this.redis.setex(
      this.key(KEYS.PENDING_CHOICE + choiceKey),
      ttlSeconds,
      JSON.stringify(choice)
    );
    
    logger.debug(`Pending choice stored: ${choiceKey} (TTL: ${ttlSeconds}s)`, { component: 'RedisStateStore' });
  }

  async getPendingChoice(choiceKey: string): Promise<PendingChoiceData | null> {
    const data = await this.redis.get(this.key(KEYS.PENDING_CHOICE + choiceKey));
    
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
    await this.redis.del(this.key(KEYS.PENDING_CHOICE + choiceKey));
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
    const keys = await this.redis.keys(`${this.keyPrefix}ant:*`);
    
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
      this.redis.keys(`${this.keyPrefix}${KEYS.JOB_STATUS}*`),
      this.redis.scard(this.key(KEYS.PREVIEW_LIST)),
      this.redis.scard(this.key(KEYS.IDE_LIST))
    ]);

    return {
      jobs: jobKeys.length,
      previews: previewMembers,
      ides: ideMembers,
      subscriptions: this.subscriptions.size
    };
  }
}
