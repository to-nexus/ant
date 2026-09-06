/**
 * Job status, task-queue snapshots, cross-pod workflow state, job↔project
 * mapping, user-stop / kill-reason signals and the jobs-by-feature index.
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type {
  JobStatusData,
  WorkflowRealtimeState,
} from '../../../core/ports/stateStore';
import type { TaskQueueSnapshot, JobProjectMapping } from '../../../core/types/task';
import type { UserContext } from '../../../core/types/user';
import { REDIS_KEYS, REDIS_TTL, getRealtimeWorkflowChannel } from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisCoreStore } from './RedisCoreStore';

export class RedisJobStore extends RedisCoreStore {
  // ============================================
  // Job Status Management
  // ============================================

  /**
   * Build the `jobsByFeature` index key.
   *
   * The index is tenant-scoped: `projectId` / `featureName` are user-chosen, so
   * two tenants routinely pick the same pair. A tenantless key made one
   * tenant's running job visible to the other's duplicate-check (leaking a job
   * id, and blocking the second tenant from starting their own job). The owner
   * is therefore part of the key. Jobs written without a userContext are local
   * mode, whose tenant IS `local:local`.
   */
  protected jobsByFeatureKey(
    userContext: UserContext | undefined,
    projectId: string,
    featureName: string,
  ): string {
    const organizationId = userContext?.organizationId ?? 'local';
    const userId = userContext?.userId ?? 'local';
    return this.key(
      REDIS_KEYS.INDEX.JOBS_BY_FEATURE,
      `${organizationId}:${userId}:${projectId}:${featureName}`,
    );
  }

  async setJobStatus(jobId: string, status: JobStatusData): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.STATUS, jobId);
    const featureKey = this.jobsByFeatureKey(status.userContext, status.projectId, status.featureName);

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
      const featureKey = this.jobsByFeatureKey(status.userContext, status.projectId, status.featureName);
      pipeline.srem(featureKey, jobId);
    }
    
    await pipeline.exec();
    
    logger.debug(`Job status deleted`, { component: 'RedisStateStore', jobId });
  }

  async listJobsByFeature(
    userContext: UserContext | undefined,
    projectId: string,
    featureName: string,
  ): Promise<JobStatusData[]> {
    const featureKey = this.jobsByFeatureKey(userContext, projectId, featureName);
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

  /**
   * Keep the job mapping alive as long as the workflow state it owns.
   *
   * The mapping carries the `(org, user)` binding that `assertJobAccess` reads
   * when the status record has already expired. Workflow-state TTL is refreshed
   * on every broadcast; without this the binding could expire first and leave a
   * readable state with no owner to compare against.
   */
  private async refreshJobMappingTtl(jobId: string): Promise<void> {
    try {
      await this.redis.expire(this.key(REDIS_KEYS.JOB.MAPPING, jobId), REDIS_TTL.JOB.STATUS);
    } catch (error: any) {
      logger.debug(`Failed to refresh job mapping TTL: ${error.message}`, {
        component: 'RedisStateStore',
        jobId,
      });
    }
  }

  async setWorkflowState(jobId: string, state: WorkflowRealtimeState): Promise<void> {
    const key = this.key(REDIS_KEYS.JOB.WORKFLOW, jobId);
    await this.redis.set(key, JSON.stringify(state), 'EX', REDIS_TTL.JOB.WORKFLOW);
    await this.refreshJobMappingTtl(jobId);

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
    await this.refreshJobMappingTtl(jobId);
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
    userContext: UserContext;
    projectId: string;
    featureName: string;
    jobIds: string[];
  }>> {
    const prefix = REDIS_KEYS.INDEX.JOBS_BY_FEATURE;
    const pattern = `${prefix}*`;
    const results: Array<{ userContext: UserContext; projectId: string; featureName: string; jobIds: string[] }> = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      for (const key of keys) {
        // `{organizationId}:{userId}:{projectId}:{featureName}` — split from the
        // left exactly three times; a feature name may itself contain `:`.
        const tail = key.substring(prefix.length);
        const parts = tail.split(':');
        if (parts.length < 4) continue; // pre-tenancy key shape — leave it to TTL
        const [organizationId, userId, projectId] = parts;
        const featureName = parts.slice(3).join(':');
        if (!organizationId || !userId || !projectId || !featureName) continue;
        const jobIds = await this.redis.smembers(key);
        if (jobIds.length === 0) continue;
        results.push({ userContext: { organizationId, userId }, projectId, featureName, jobIds });
      }
    } while (cursor !== '0');

    return results;
  }

  async removeJobFromFeatureIndex(
    userContext: UserContext | undefined,
    projectId: string,
    featureName: string,
    jobId: string,
  ): Promise<void> {
    const featureKey = this.jobsByFeatureKey(userContext, projectId, featureName);
    await this.redis.srem(featureKey, jobId);
  }

  /**
   * Bulk-delete every Redis key tied to (organizationId, userId, projectId).
   * See `StateStorePort.cleanupProject` for the scope contract. Errors are
   * logged + swallowed — caller's fs.rm verification loop is the final guard.
   */
}
