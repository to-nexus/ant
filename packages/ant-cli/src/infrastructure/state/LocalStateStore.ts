/**
 * LocalStateStore
 * 
 * Local (in-memory) implementation of StateStorePort.
 * Suitable for local/single-server deployments.
 * 
 * Limitations:
 * - Data lost on server restart
 * - Cannot be shared across multiple server instances
 * - No persistence
 * 
 * Advantages:
 * - Simple and fast
 * - No external dependencies
 * - Easy to debug
 * 
 * @see 10-cloud-scalability-design.md Section 4.1
 */

import {
  StateStorePort,
  JobStatusData,
  LogEntry,
  TaskQueueSnapshot,
  JobProjectMapping,
  PortMapping
} from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { logger } from '../../utils/logger';

export class LocalStateStore implements StateStorePort, PortRegistryPort {
  // Job State
  private jobs = new Map<string, JobStatusData>();
  private jobLogs = new Map<string, LogEntry[]>();
  private taskQueues = new Map<string, TaskQueueSnapshot>();
  private jobMappings = new Map<string, JobProjectMapping>();
  private userStoppedJobs = new Set<string>();
  
  // Port Registry
  private previews = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();
  
  // Pub/Sub
  private subscribers = new Map<string, Set<(message: any) => void>>();
  
  // Job Index (for listJobsByFeature)
  private jobsByFeature = new Map<string, Set<string>>();

  // ============================================
  // Helper Methods
  // ============================================

  private createPortKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  private createFeatureKey(projectId: string, featureName: string): string {
    return `${projectId}:${featureName}`;
  }

  // ============================================
  // Job Status Management
  // ============================================

  async setJobStatus(jobId: string, status: JobStatusData): Promise<void> {
    this.jobs.set(jobId, status);
    
    // Update feature index
    const featureKey = this.createFeatureKey(status.projectId, status.featureName);
    if (!this.jobsByFeature.has(featureKey)) {
      this.jobsByFeature.set(featureKey, new Set());
    }
    this.jobsByFeature.get(featureKey)!.add(jobId);
    
    // Initialize logs if not exists
    if (!this.jobLogs.has(jobId)) {
      this.jobLogs.set(jobId, []);
    }
    
    logger.debug(`Job status set: ${status.status}`, { 
      component: 'LocalStateStore',
      jobId
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatusData | null> {
    return this.jobs.get(jobId) || null;
  }

  async updateJobStatus(jobId: string, updates: Partial<JobStatusData>): Promise<void> {
    const current = this.jobs.get(jobId);
    if (current) {
      this.jobs.set(jobId, { ...current, ...updates });
      logger.debug(`Job status updated: ${Object.keys(updates).join(', ')}`, {
        component: 'LocalStateStore',
        jobId
      });
    }
  }

  async deleteJobStatus(jobId: string): Promise<void> {
    const status = this.jobs.get(jobId);
    if (status) {
      // Remove from feature index
      const featureKey = this.createFeatureKey(status.projectId, status.featureName);
      this.jobsByFeature.get(featureKey)?.delete(jobId);
    }
    
    this.jobs.delete(jobId);
    logger.debug(`Job status deleted`, { component: 'LocalStateStore', jobId });
  }

  async listJobsByFeature(projectId: string, featureName: string): Promise<JobStatusData[]> {
    const featureKey = this.createFeatureKey(projectId, featureName);
    const jobIds = this.jobsByFeature.get(featureKey) || new Set();
    
    const result: JobStatusData[] = [];
    for (const jobId of jobIds) {
      const status = this.jobs.get(jobId);
      if (status) {
        result.push(status);
      }
    }
    
    return result;
  }

  // ============================================
  // Job Logs Management
  // ============================================

  async appendJobLog(jobId: string, log: LogEntry): Promise<void> {
    if (!this.jobLogs.has(jobId)) {
      this.jobLogs.set(jobId, []);
    }
    
    const logWithTimestamp = {
      ...log,
      timestamp: log.timestamp || new Date().toISOString()
    };
    
    this.jobLogs.get(jobId)!.push(logWithTimestamp);
    
    // Publish to subscribers (for real-time log streaming)
    await this.publish(`job:${jobId}:logs`, logWithTimestamp);
  }

  async getJobLogs(jobId: string): Promise<LogEntry[]> {
    return this.jobLogs.get(jobId) || [];
  }

  async clearJobLogs(jobId: string): Promise<void> {
    this.jobLogs.delete(jobId);
  }

  // ============================================
  // Task Queue Snapshot Management
  // ============================================

  async updateTaskQueue(jobId: string, snapshot: TaskQueueSnapshot): Promise<void> {
    this.taskQueues.set(jobId, snapshot);
    
    // Publish to subscribers
    await this.publish(`job:${jobId}:taskQueue`, snapshot);
    
    logger.debug(`Task queue updated: queue=${snapshot.queue.length}, completed=${snapshot.completedTasks.length}`, {
      component: 'LocalStateStore',
      jobId
    });
  }

  async getTaskQueue(jobId: string): Promise<TaskQueueSnapshot | null> {
    return this.taskQueues.get(jobId) || null;
  }

  async deleteTaskQueue(jobId: string): Promise<void> {
    this.taskQueues.delete(jobId);
  }

  // ============================================
  // Job-Project Mapping
  // ============================================

  async setJobMapping(jobId: string, mapping: JobProjectMapping): Promise<void> {
    this.jobMappings.set(jobId, mapping);
  }

  async getJobMapping(jobId: string): Promise<JobProjectMapping | null> {
    return this.jobMappings.get(jobId) || null;
  }

  async deleteJobMapping(jobId: string): Promise<void> {
    this.jobMappings.delete(jobId);
  }

  // ============================================
  // User-Stopped Jobs Tracking
  // ============================================

  async markUserStopped(jobId: string): Promise<void> {
    this.userStoppedJobs.add(jobId);
  }

  async isUserStopped(jobId: string): Promise<boolean> {
    return this.userStoppedJobs.has(jobId);
  }

  async clearUserStopped(jobId: string): Promise<void> {
    this.userStoppedJobs.delete(jobId);
  }

  // ============================================
  // Port Registry - Preview
  // ============================================

  async registerPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host: string = 'localhost'
  ): Promise<void> {
    const key = this.createPortKey(tenantId, userId, projectId, feature);
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

    this.previews.set(key, mapping);
    logger.info(`Preview registered: ${key} → ${host}:${port}`, { component: 'LocalStateStore' });
  }

  async getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null> {
    const key = this.createPortKey(tenantId, userId, projectId, feature);
    const mapping = this.previews.get(key);
    
    if (mapping) {
      mapping.lastAccessedAt = new Date();
    }
    
    return mapping || null;
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
    const key = this.createPortKey(tenantId, userId, projectId, feature);
    const deleted = this.previews.delete(key);
    
    if (deleted) {
      logger.info(`Preview unregistered: ${key}`, { component: 'LocalStateStore' });
    }
  }

  async listPreviews(): Promise<PortMapping[]> {
    return Array.from(this.previews.values());
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
    const key = this.createPortKey(tenantId, userId, projectId, feature);
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

    this.ides.set(key, mapping);
    logger.info(`IDE registered: ${key} → ${host}:${port}`, { component: 'LocalStateStore' });
  }

  async getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null> {
    const key = this.createPortKey(tenantId, userId, projectId, feature);
    const mapping = this.ides.get(key);
    
    if (mapping) {
      mapping.lastAccessedAt = new Date();
    }
    
    return mapping || null;
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
    const key = this.createPortKey(tenantId, userId, projectId, feature);
    const deleted = this.ides.delete(key);
    
    if (deleted) {
      logger.info(`IDE unregistered: ${key}`, { component: 'LocalStateStore' });
    }
  }

  async listIDEs(): Promise<PortMapping[]> {
    return Array.from(this.ides.values());
  }

  async updateLastAccess(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    type: 'preview' | 'ide'
  ): Promise<void> {
    const key = this.createPortKey(tenantId, userId, projectId, feature);
    const map = type === 'preview' ? this.previews : this.ides;
    const mapping = map.get(key);

    if (mapping) {
      mapping.lastAccessedAt = new Date();
    }
  }

  // ============================================
  // Pub/Sub
  // ============================================

  async publish(channel: string, message: any): Promise<void> {
    const subs = this.subscribers.get(channel);
    if (subs) {
      for (const callback of subs) {
        try {
          callback(message);
        } catch (error) {
          logger.error(`Pub/Sub callback error for channel ${channel}`, { component: 'LocalStateStore' }, error);
        }
      }
    }
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<() => void> {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    
    this.subscribers.get(channel)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers.get(channel)?.delete(callback);
      if (this.subscribers.get(channel)?.size === 0) {
        this.subscribers.delete(channel);
      }
    };
  }

  // ============================================
  // Lifecycle
  // ============================================

  async close(): Promise<void> {
    logger.info('Closing LocalStateStore (no-op for in-memory)', { component: 'LocalStateStore' });
  }

  async clear(): Promise<void> {
    this.jobs.clear();
    this.jobLogs.clear();
    this.taskQueues.clear();
    this.jobMappings.clear();
    this.userStoppedJobs.clear();
    this.previews.clear();
    this.ides.clear();
    this.subscribers.clear();
    this.jobsByFeature.clear();
    
    logger.info('Cleared all state', { component: 'LocalStateStore' });
  }

  // ============================================
  // Stats (for debugging)
  // ============================================

  getStats(): {
    jobs: number;
    previews: number;
    ides: number;
    subscribers: number;
  } {
    return {
      jobs: this.jobs.size,
      previews: this.previews.size,
      ides: this.ides.size,
      subscribers: this.subscribers.size
    };
  }
}

/**
 * @deprecated Use LocalStateStore instead
 */
export const InMemoryStateStore = LocalStateStore;
