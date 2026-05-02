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
  TurnBufferData,
  PendingCardSnapshot,
  TurnBufferSnapshot,
  WorkflowRealtimeState,
  PendingChoiceData
} from '../../core/ports/stateStore';
import type { TaskQueueSnapshot, JobProjectMapping } from '../../core/types/task';
import type { TransferRequest } from '../../core/types/transfer';
import { 
  PortRegistryPort, 
  PreviewState, 
  ServiceConnection,
  IDEState,
  DeployState,
  PreviewPackage,
  PreviewRuntimeIssue
} from '../../core/ports/portRegistry';
import type { PreviewStructureType } from '../../core/ports/preview';
import { createIDEKey, createPreviewKey, createDeployKey } from './redisKeyUtils';
import { RESERVED_FEATURE_NAME } from '../../core/utils/branchUtils';
import {
  APP_PREFIX,
  REDIS_KEYS,
  REDIS_TTL,
  getRealtimeWorkflowChannel,
  getTurnBufferKey,
  getTurnBufferIndexKey,
  getTurnBufferIndexMember,
  parseTurnBufferIndexMember,
  getCancelledPauseSeqKey,
  getWorkerCycleSeqKey,
} from './redisConstants';
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
    this.subscriber.on('ready', () => {
      logger.info(`Redis subscriber ready (${this.subscriptions.size} channels)`, { component: 'RedisStateStore' });
    });
    this.subscriber.on('reconnecting', () => {
      logger.warn('Redis subscriber reconnecting', { component: 'RedisStateStore' });
    });
    this.subscriber.on('error', (err: Error) => {
      logger.error('Redis subscriber error', { component: 'RedisStateStore' }, err);
    });
    this.subscriber.on('close', () => {
      logger.warn('Redis subscriber closed', { component: 'RedisStateStore' });
    });

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

  async findJobsByStatus(status: string): Promise<JobStatusData[]> {
    const pattern = `${REDIS_KEYS.JOB.STATUS}*`;
    const results: JobStatusData[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        const values = await this.redis.mget(...keys);
        for (const val of values) {
          if (!val) continue;
          try {
            const data: JobStatusData = JSON.parse(val);
            if (data.status === status) {
              results.push(data);
            }
          } catch { /* skip malformed entries */ }
        }
      }
    } while (cursor !== '0');

    return results;
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

  /**
   * Get checkpoint snapshot (disaster recovery fallback).
   * Stored separately from live snapshot to avoid polluting Kanban state on refresh.
   * Falls back to live snapshot if checkpoint doesn't exist.
   */
  async getTaskQueueCheckpoint(jobId: string): Promise<TaskQueueSnapshot | null> {
    const checkpointKey = this.key(REDIS_KEYS.JOB.TASK_QUEUE_CHECKPOINT, jobId);
    const checkpointData = await this.redis.get(checkpointKey);
    if (checkpointData) return JSON.parse(checkpointData);
    
    // Fallback to live snapshot (backward compatibility)
    return this.getTaskQueue(jobId);
  }

  async deleteTaskQueue(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.TASK_QUEUE, jobId);
    const checkpointKey = this.key(REDIS_KEYS.JOB.TASK_QUEUE_CHECKPOINT, jobId);
    await Promise.all([this.redis.del(key), this.redis.del(checkpointKey)]);
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

  async setWorkflowStateSilent(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.WORKFLOW, jobId);
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.JOB.WORKFLOW);
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
  // Kill Reason Tracking (SIGTERM diagnostics)
  // ============================================

  async setKillReason(jobId: string, reason: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.KILL_REASON, jobId);
    await this.redis.set(key, JSON.stringify({ reason, ts: Date.now() }), 'EX', REDIS_TTL.JOB.KILL_REASON);
  }

  async getKillReason(jobId: string): Promise<string | null> {
    const key = this.key(REDIS_KEYS.JOB.KILL_REASON, jobId);
    return this.redis.get(key);
  }

  async deleteKillReason(jobId: string): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.KILL_REASON, jobId);
    await this.redis.del(key);
  }

  // ============================================
  // Jobs-By-Feature Index (seal sweep)
  // ============================================

  async scanJobsByFeatureIndex(): Promise<Array<{
    projectId: string;
    featureName: string;
    jobIds: string[];
  }>> {
    const prefix = REDIS_KEYS.INDEX.JOBS_BY_FEATURE;
    const pattern = `${prefix}*`;
    const results: Array<{ projectId: string; featureName: string; jobIds: string[] }> = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        const tail = key.substring(prefix.length);
        const sep = tail.indexOf(':');
        if (sep <= 0) continue;
        const projectId = tail.substring(0, sep);
        const featureName = tail.substring(sep + 1);
        const jobIds = await this.redis.smembers(key);
        if (jobIds.length === 0) continue;
        results.push({ projectId, featureName, jobIds });
      }
    } while (cursor !== '0');

    return results;
  }

  async removeJobFromFeatureIndex(
    projectId: string,
    featureName: string,
    jobId: string,
  ): Promise<void> {
    const featureKey = this.key(REDIS_KEYS.INDEX.JOBS_BY_FEATURE, `${projectId}:${featureName}`);
    await this.redis.srem(featureKey, jobId);
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
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath' | 'structureType' | 'setupReasoning' | 'setupReason' | 'suggestedFix' | 'connections'>>
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

  // ============================================
  // Preview Config (User Settings, separate from runtime state)
  // ============================================

  /**
   * Save preview config (user-configured settings: connections, structureType, projectProfile).
   * Stored in a separate Redis key from runtime state so it persists
   * across preview start/stop cycles.
   */
  async savePreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    config: { connections?: ServiceConnection[] | null; structureType?: PreviewStructureType | null; projectProfile?: { language: string; framework?: string } | null }
  ): Promise<void> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW_CONFIG, portKey);
    
    // Merge with existing config to avoid overwriting other fields
    const existing = await this.redis.get(key);
    const merged = existing ? { ...JSON.parse(existing), ...config } : config;
    
    await this.redis.set(key, JSON.stringify(merged), 'EX', REDIS_TTL.INFRA.PREVIEW_CONFIG);
    logger.info(`[Preview] Config saved: ${portKey}`, { component: 'RedisStateStore' });
  }

  /**
   * Get preview config (user-configured settings).
   * Returns null if no config has been saved.
   */
  async getPreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ connections?: ServiceConnection[] | null; structureType?: PreviewStructureType | null; projectProfile?: { language: string; framework?: string } | null } | null> {
    const portKey = createPreviewKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.PREVIEW_CONFIG, portKey);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
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
  // Port Registry - Deploy (Static Build Serving)
  // ============================================

  async registerDeploy(state: Omit<DeployState, 'lastAccessedAt'>): Promise<void> {
    const { tenantId, userId, projectId, feature } = state;
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);

    const fullState: DeployState = { ...state, lastAccessedAt: new Date() };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(fullState), 'EX', REDIS_TTL.INFRA.DEPLOY);
    pipeline.sadd(REDIS_KEYS.INFRA.DEPLOY_LIST, deployKey);
    await pipeline.exec();
    logger.info(`[Deploy] Registered: ${deployKey} -> ${state.host}:${state.port}`, { component: 'RedisStateStore' });
  }

  async getDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<DeployState | null> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return null;
    const state: DeployState = JSON.parse(data);
    state.startedAt = new Date(state.startedAt);
    state.lastAccessedAt = new Date(state.lastAccessedAt);
    return state;
  }

  async updateDeploy(
    tenantId: string, userId: string, projectId: string, feature: string,
    update: Partial<Pick<DeployState, 'phase' | 'port' | 'host' | 'podId' | 'error' | 'buildLog' | 'url' | 'urlKey' | 'workspacePath' | 'lastAccessedAt'>>
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return;
    const state: DeployState = JSON.parse(data);
    Object.assign(state, update);
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.DEPLOY);
  }

  async touchDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const data = await this.redis.get(key);
    if (!data) return;
    const state: DeployState = JSON.parse(data);
    state.lastAccessedAt = new Date();
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.INFRA.DEPLOY);
  }

  async unregisterDeploy(
    tenantId: string, userId: string, projectId: string, feature: string
  ): Promise<void> {
    const deployKey = createDeployKey(tenantId, userId, projectId, feature);
    const key = this.key(REDIS_KEYS.INFRA.DEPLOY, deployKey);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.srem(REDIS_KEYS.INFRA.DEPLOY_LIST, deployKey);
    await pipeline.exec();
    logger.info(`[Deploy] Unregistered: ${deployKey}`, { component: 'RedisStateStore' });
  }

  async listDeploys(): Promise<DeployState[]> {
    const deployKeys = await this.redis.smembers(REDIS_KEYS.INFRA.DEPLOY_LIST);
    if (deployKeys.length === 0) return [];
    const keys = deployKeys.map(dk => this.key(REDIS_KEYS.INFRA.DEPLOY, dk));
    const values = await this.redis.mget(...keys);

    // Clean up stale SET members whose Redis keys have expired (TTL)
    const staleMembers = deployKeys.filter((_, i) => values[i] === null);
    if (staleMembers.length > 0) {
      this.redis.srem(REDIS_KEYS.INFRA.DEPLOY_LIST, ...staleMembers).catch(() => {});
    }

    return values
      .filter((v): v is string => v !== null)
      .map(v => {
        const state: DeployState = JSON.parse(v);
        state.startedAt = new Date(state.startedAt);
        state.lastAccessedAt = new Date(state.lastAccessedAt);
        return state;
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
    podId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
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
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<IDEState | null> {
    // Validate all key components are present
    if (!tenantId || !userId || !projectId) {
      logger.warn(`[IDE] getIDE() INVALID ARGS: tenantId=${tenantId}, userId=${userId}, projectId=${projectId}`, { component: 'RedisStateStore' });
      return null;
    }
    
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
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
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<number | null> {
    const state = await this.getIDE(tenantId, userId, projectId, feature);
    return state?.port ?? null;
  }

  /**
   * Update last accessed time
   */
  async touchIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
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
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<void> {
    const portKey = createIDEKey(tenantId, userId, projectId, feature);
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
  // Generic Key-Value Operations
  // ============================================

  async setKeyWithTTL(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.setex(key, ttlSeconds, value);
  }

  async getKey(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async deleteKey(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incrementKey(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async decrementKey(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  async expireKey(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async countKeysByPrefix(prefix: string): Promise<number> {
    let count = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
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
  // Chat Turn Buffer (in-flight streaming)
  // ============================================

  async getTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<TurnBufferData | null> {
    const key = getTurnBufferKey(sessionKey, turnId, workerScope);
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as TurnBufferData;
    } catch (e) {
      logger.error(`Failed to parse turn buffer: ${key}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  private async writeTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    buffer: TurnBufferData,
  ): Promise<void> {
    const key = getTurnBufferKey(sessionKey, turnId, workerScope);
    await this.redis.setex(key, REDIS_TTL.CHAT.TURN_BUFFER, JSON.stringify(buffer));
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const member = getTurnBufferIndexMember(turnId, workerScope);
    await this.redis.sadd(indexKey, member);
    await this.redis.expire(indexKey, REDIS_TTL.CHAT.TURN_BUFFER);
  }

  async appendToTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    kind: 'text' | 'thinking' | 'card_output',
    chunk: string,
    cardId?: string,
  ): Promise<void> {
    if (!chunk) return;
    if (kind === 'card_output' && !cardId) {
      throw new Error('appendToTurnBuffer: cardId required when kind=card_output');
    }
    const current = (await this.getTurnBuffer(sessionKey, turnId, workerScope)) ?? {};
    if (kind === 'text') {
      current.text = (current.text ?? '') + chunk;
    } else if (kind === 'thinking') {
      current.thinking = (current.thinking ?? '') + chunk;
    } else {
      const pendingCards = current.pendingCards ?? {};
      const card = pendingCards[cardId!];
      if (!card) {
        // Caller should have invoked setTurnBufferPendingCard first; still
        // accept the chunk to avoid lost output if the worker missed it.
        pendingCards[cardId!] = {
          cardId: cardId!,
          statusType: 'tool_action',
          metadata: {},
          streamedOutput: chunk,
        };
      } else {
        card.streamedOutput = (card.streamedOutput ?? '') + chunk;
      }
      current.pendingCards = pendingCards;
    }
    await this.writeTurnBuffer(sessionKey, turnId, workerScope, current);
  }

  async setTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    card: PendingCardSnapshot,
  ): Promise<void> {
    const current = (await this.getTurnBuffer(sessionKey, turnId, workerScope)) ?? {};
    const pendingCards = current.pendingCards ?? {};
    const existing = pendingCards[card.cardId];
    pendingCards[card.cardId] = existing
      ? { ...existing, ...card, streamedOutput: existing.streamedOutput }
      : card;
    current.pendingCards = pendingCards;
    await this.writeTurnBuffer(sessionKey, turnId, workerScope, current);
  }

  async clearTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    cardId: string,
  ): Promise<void> {
    const current = await this.getTurnBuffer(sessionKey, turnId, workerScope);
    if (!current?.pendingCards) return;
    if (!(cardId in current.pendingCards)) return;
    delete current.pendingCards[cardId];
    if (Object.keys(current.pendingCards).length === 0) {
      delete current.pendingCards;
    }
    // If nothing meaningful remains, remove the key entirely.
    if (!current.text && !current.thinking && !current.pendingCards) {
      await this.clearTurnBuffer(sessionKey, turnId, workerScope);
      return;
    }
    await this.writeTurnBuffer(sessionKey, turnId, workerScope, current);
  }

  async clearTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<void> {
    const key = getTurnBufferKey(sessionKey, turnId, workerScope);
    await this.redis.del(key);
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const member = getTurnBufferIndexMember(turnId, workerScope);
    await this.redis.srem(indexKey, member);
  }

  async clearAllTurnBuffersForFeature(sessionKey: string): Promise<void> {
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const members = await this.redis.smembers(indexKey);
    if (members.length === 0) {
      await this.redis.del(indexKey);
      return;
    }
    const pipeline = this.redis.pipeline();
    for (const member of members) {
      const { turnId, workerScope } = parseTurnBufferIndexMember(member);
      pipeline.del(getTurnBufferKey(sessionKey, turnId, workerScope));
    }
    pipeline.del(indexKey);
    await pipeline.exec();
  }

  async listActiveTurnBuffers(sessionKey: string): Promise<TurnBufferSnapshot[]> {
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const members = await this.redis.smembers(indexKey);
    if (members.length === 0) return [];
    const snapshots: TurnBufferSnapshot[] = [];
    for (const member of members) {
      const { turnId, workerScope } = parseTurnBufferIndexMember(member);
      const buf = await this.getTurnBuffer(sessionKey, turnId, workerScope);
      if (!buf) {
        // Index stale — drop it.
        await this.redis.srem(indexKey, member);
        continue;
      }
      snapshots.push({
        turnId,
        workerScope,
        text: buf.text,
        thinking: buf.thinking,
        pendingCards: buf.pendingCards,
      });
    }
    return snapshots;
  }

  async nextPauseSeq(turnId: string): Promise<number> {
    const key = getCancelledPauseSeqKey(turnId);
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, REDIS_TTL.CHAT.CANCELLED_PAUSE_SEQ);
    return seq;
  }

  async getCurrentPauseSeq(turnId: string): Promise<number> {
    const key = getCancelledPauseSeqKey(turnId);
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async nextWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    const key = getWorkerCycleSeqKey(turnId, taskKey);
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, REDIS_TTL.CHAT.WORKER_CYCLE_SEQ);
    return seq;
  }

  async getCurrentWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    const key = getWorkerCycleSeqKey(turnId, taskKey);
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
  // Transfer Request Management
  // ============================================

  /**
   * Create a transfer request in Redis
   */
  async createTransferRequest(request: TransferRequest): Promise<void> {
    const key = this.key(REDIS_KEYS.TRANSFER.REQUEST, request.id);
    
    await this.redis.setex(
      key,
      REDIS_TTL.TRANSFER.REQUEST,
      JSON.stringify(request)
    );
    
    // Add to recipient index
    const recipientKey = this.key(
      REDIS_KEYS.TRANSFER.BY_RECIPIENT, 
      request.recipient.orgId, 
      request.recipient.userId
    );
    await this.redis.sadd(recipientKey, request.id);
    await this.redis.expire(recipientKey, REDIS_TTL.TRANSFER.REQUEST);
    
    // Add to sender index
    const senderKey = this.key(
      REDIS_KEYS.TRANSFER.BY_SENDER, 
      request.sender.orgId, 
      request.sender.userId
    );
    await this.redis.sadd(senderKey, request.id);
    await this.redis.expire(senderKey, REDIS_TTL.TRANSFER.REQUEST);
    
    logger.debug(`📦 [Transfer] Request created: ${request.id}`, { component: 'RedisStateStore' });
  }

  /**
   * Get a transfer request by ID
   */
  async getTransferRequest(requestId: string): Promise<TransferRequest | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId));
    if (!data) return null;
    
    try {
      return JSON.parse(data) as TransferRequest;
    } catch (e) {
      logger.error(`Failed to parse transfer request: ${requestId}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  /**
   * Update transfer request status
   */
  async updateTransferRequestStatus(
    requestId: string, 
    status: TransferRequest['status']
  ): Promise<TransferRequest | null> {
    const request = await this.getTransferRequest(requestId);
    if (!request) return null;
    
    request.status = status;
    
    await this.redis.setex(
      this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId),
      REDIS_TTL.TRANSFER.REQUEST,
      JSON.stringify(request)
    );
    
    logger.debug(`📦 [Transfer] Request ${requestId} status → ${status}`, { component: 'RedisStateStore' });
    return request;
  }

  /**
   * Get all transfer requests for a recipient (pending or all)
   */
  async getTransferRequestsByRecipient(
    orgId: string, 
    userId: string, 
    statusFilter?: TransferRequest['status']
  ): Promise<TransferRequest[]> {
    const recipientKey = this.key(REDIS_KEYS.TRANSFER.BY_RECIPIENT, orgId, userId);
    const requestIds = await this.redis.smembers(recipientKey);
    
    if (requestIds.length === 0) return [];
    
    const pipeline = this.redis.pipeline();
    for (const id of requestIds) {
      pipeline.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, id));
    }
    const results = await pipeline.exec();
    
    const requests: TransferRequest[] = [];
    const expiredIds: string[] = [];
    
    for (let i = 0; i < requestIds.length; i++) {
      const [err, data] = results![i];
      if (err || !data) {
        // Request expired from Redis, clean up index
        expiredIds.push(requestIds[i]);
        continue;
      }
      try {
        const request = JSON.parse(data as string) as TransferRequest;
        if (!statusFilter || request.status === statusFilter) {
          requests.push(request);
        }
      } catch {
        expiredIds.push(requestIds[i]);
      }
    }
    
    // Cleanup stale index entries
    if (expiredIds.length > 0) {
      await this.redis.srem(recipientKey, ...expiredIds);
    }
    
    return requests;
  }

  /**
   * Get all transfer requests sent by a user
   */
  async getTransferRequestsBySender(
    orgId: string, 
    userId: string, 
    statusFilter?: TransferRequest['status']
  ): Promise<TransferRequest[]> {
    const senderKey = this.key(REDIS_KEYS.TRANSFER.BY_SENDER, orgId, userId);
    const requestIds = await this.redis.smembers(senderKey);
    
    if (requestIds.length === 0) return [];
    
    const pipeline = this.redis.pipeline();
    for (const id of requestIds) {
      pipeline.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, id));
    }
    const results = await pipeline.exec();
    
    const requests: TransferRequest[] = [];
    const expiredIds: string[] = [];
    
    for (let i = 0; i < requestIds.length; i++) {
      const [err, data] = results![i];
      if (err || !data) {
        expiredIds.push(requestIds[i]);
        continue;
      }
      try {
        const request = JSON.parse(data as string) as TransferRequest;
        if (!statusFilter || request.status === statusFilter) {
          requests.push(request);
        }
      } catch {
        expiredIds.push(requestIds[i]);
      }
    }
    
    if (expiredIds.length > 0) {
      await this.redis.srem(senderKey, ...expiredIds);
    }
    
    return requests;
  }

  /**
   * Delete a transfer request and remove from indexes
   */
  async deleteTransferRequest(requestId: string): Promise<void> {
    const request = await this.getTransferRequest(requestId);
    if (!request) return;
    
    // Remove from indexes
    const recipientKey = this.key(
      REDIS_KEYS.TRANSFER.BY_RECIPIENT, 
      request.recipient.orgId, 
      request.recipient.userId
    );
    const senderKey = this.key(
      REDIS_KEYS.TRANSFER.BY_SENDER, 
      request.sender.orgId, 
      request.sender.userId
    );
    
    await Promise.all([
      this.redis.del(this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId)),
      this.redis.srem(recipientKey, requestId),
      this.redis.srem(senderKey, requestId),
    ]);
    
    logger.debug(`📦 [Transfer] Request deleted: ${requestId}`, { component: 'RedisStateStore' });
  }

  /**
   * Count pending transfer requests for a recipient (for badge)
   */
  async countPendingTransferRequests(orgId: string, userId: string): Promise<number> {
    const requests = await this.getTransferRequestsByRecipient(orgId, userId, 'pending');
    return requests.length;
  }

  // ============================================
  // Unseen Artifacts Management
  // ============================================

  async addUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    const pipeline = this.redis.pipeline();
    pipeline.sadd(key, ...paths);
    pipeline.expire(key, REDIS_TTL.ARTIFACTS.UNSEEN);
    await pipeline.exec();
    logger.debug(`Unseen artifacts added: ${paths.length} paths for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async removeUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    await this.redis.srem(key, ...paths);
    logger.debug(`Unseen artifacts removed: ${paths.length} paths for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async getUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<string[]> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    return this.redis.smembers(key);
  }

  async clearUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<void> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    await this.redis.del(key);
    logger.debug(`Unseen artifacts cleared for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  // ============================================
  // FileTree Cache
  // ============================================

  async setFileTreeCache(userId: string, projectId: string, feature: string, tree: any[]): Promise<void> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.FILETREE, `${userId}:${projectId}:${feature}`);
    await this.redis.set(key, JSON.stringify(tree), 'EX', REDIS_TTL.ARTIFACTS.FILETREE);
    logger.debug(`FileTree cache set for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async getFileTreeCache(userId: string, projectId: string, feature: string): Promise<any[] | null> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.FILETREE, `${userId}:${projectId}:${feature}`);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
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
