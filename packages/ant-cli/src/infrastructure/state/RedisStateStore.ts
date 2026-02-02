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
  WorkflowRealtimeState
} from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
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
  WORKFLOW_STATE: 'ant:workflow:state:'
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
  WORKFLOW_STATE: 24 * 60 * 60   // 24 hours
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
  // Port Registry - Preview
  // ============================================

  private createPortKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  async registerPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host: string = 'localhost'
  ): Promise<void> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.PREVIEW, portKey);
    
    const mapping: PortMapping = {
      tenantId,
      userId,
      projectId,
      feature,
      port,
      host,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(mapping), 'EX', TTL.PORT_MAPPING);
    pipeline.sadd(this.key(KEYS.PREVIEW_LIST), portKey);
    await pipeline.exec();

    logger.info(`Preview registered: ${portKey} → ${host}:${port}`, { component: 'RedisStateStore' });
  }

  async getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.PREVIEW, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const mapping: PortMapping = JSON.parse(data);
    
    // Update last accessed
    mapping.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(mapping), 'EX', TTL.PORT_MAPPING);

    return mapping;
  }

  // PortRegistryPort implementation
  async getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const mapping = await this.getPreview(tenantId, userId, projectId, feature);
    return mapping?.port ?? null;
  }

  async unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.PREVIEW, portKey);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(KEYS.PREVIEW_LIST), portKey);
    await pipeline.exec();

    logger.info(`Preview unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  async listPreviews(): Promise<PortMapping[]> {
    const portKeys = await this.redis.smembers(this.key(KEYS.PREVIEW_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(KEYS.PREVIEW, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => JSON.parse(r));
  }

  // ============================================
  // Port Registry - IDE
  // ============================================

  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host: string = 'localhost'
  ): Promise<void> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.IDE, portKey);
    
    logger.debug(`registerIDE() called: key=${key}, host=${host}, port=${port}`, { component: 'RedisStateStore' });
    
    const mapping: PortMapping = {
      tenantId,
      userId,
      projectId,
      feature,
      port,
      host,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(mapping), 'EX', TTL.PORT_MAPPING);
    pipeline.sadd(this.key(KEYS.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`IDE registered: ${portKey} → ${host}:${port}`, { component: 'RedisStateStore' });
  }

  async getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.IDE, portKey);
    
    logger.debug(`getIDE() called: key=${key}`, { component: 'RedisStateStore' });
    
    const data = await this.redis.get(key);

    if (!data) {
      logger.debug(`getIDE() not found: key=${key}`, { component: 'RedisStateStore' });
      return null;
    }

    const mapping: PortMapping = JSON.parse(data);
    logger.debug(`getIDE() found: key=${key}, host=${mapping.host}, port=${mapping.port}`, { component: 'RedisStateStore' });
    
    // Update last accessed
    mapping.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(mapping), 'EX', TTL.PORT_MAPPING);

    return mapping;
  }

  // PortRegistryPort implementation
  async getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const mapping = await this.getIDE(tenantId, userId, projectId, feature);
    return mapping?.port ?? null;
  }

  async unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const key = this.key(KEYS.IDE, portKey);

    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(this.key(KEYS.IDE_LIST), portKey);
    await pipeline.exec();

    logger.info(`IDE unregistered: ${portKey}`, { component: 'RedisStateStore' });
  }

  async listIDEs(): Promise<PortMapping[]> {
    const portKeys = await this.redis.smembers(this.key(KEYS.IDE_LIST));
    
    if (portKeys.length === 0) {
      return [];
    }

    const keys = portKeys.map((pk: string) => this.key(KEYS.IDE, pk));
    const results = await this.redis.mget(...keys);

    return results
      .filter((r: string | null): r is string => r !== null)
      .map((r: string) => JSON.parse(r));
  }

  async updateLastAccess(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    type: 'preview' | 'ide'
  ): Promise<void> {
    const portKey = this.createPortKey(tenantId, userId, projectId, feature);
    const keyPrefix = type === 'preview' ? KEYS.PREVIEW : KEYS.IDE;
    const key = this.key(keyPrefix, portKey);

    const data = await this.redis.get(key);
    if (data) {
      const mapping: PortMapping = JSON.parse(data);
      mapping.lastAccessedAt = new Date();
      await this.redis.set(key, JSON.stringify(mapping), 'EX', TTL.PORT_MAPPING);
    }
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
