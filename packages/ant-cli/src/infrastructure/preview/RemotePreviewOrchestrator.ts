/**
 * RemotePreviewOrchestrator
 * 
 * Cloud implementation of PreviewOrchestratorPort.
 * Distributes preview servers across remote worker nodes.
 * 
 * Features:
 * - Load balancing across multiple preview workers
 * - Health checks and automatic failover
 * - Centralized state via Redis
 * - Proxy-based log streaming
 * 
 * Worker nodes run a Preview Worker service that:
 * - Receives preview start/stop commands via HTTP
 * - Spawns local dev server processes
 * - Streams logs back to the API server
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.3
 */

import {
  PreviewOrchestratorPort,
  PreviewParams,
  PreviewStartResult,
  PreviewInstance,
  PreviewLogEntry,
  PreviewIssue,
  PreviewStatus
} from '../../core/ports/previewOrchestrator';
import { StateStorePort } from '../../core/ports/stateStore';
import { logger } from '../../utils/logger';

// ============================================
// Worker Types
// ============================================

interface PreviewWorker {
  id: string;
  host: string;
  port: number;
  healthy: boolean;
  lastHealthCheck: Date;
  activeInstances: number;
}

interface WorkerPreviewResponse {
  success: boolean;
  instanceId?: string;
  port?: number;
  error?: string;
}

// ============================================
// Redis Keys for State
// ============================================

const KEYS = {
  PREVIEW_INSTANCE: 'ant:preview:instance:',
  PREVIEW_LOGS: 'ant:preview:logs:',
  WORKER_ASSIGNMENT: 'ant:preview:worker:'
} as const;

// ============================================
// Configuration
// ============================================

export interface RemotePreviewOrchestratorOptions {
  workers: string[];  // List of worker URLs (e.g., ['http://worker1:8080', 'http://worker2:8080'])
  healthCheckInterval?: number;  // ms, default 30000
  requestTimeout?: number;  // ms, default 30000
}

// ============================================
// RemotePreviewOrchestrator
// ============================================

export class RemotePreviewOrchestrator implements PreviewOrchestratorPort {
  private workers: PreviewWorker[] = [];
  private stateStore: StateStorePort;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private options: RemotePreviewOrchestratorOptions;

  constructor(options: RemotePreviewOrchestratorOptions, stateStore: StateStorePort) {
    this.options = options;
    this.stateStore = stateStore;
    
    // Initialize workers from URLs
    this.workers = options.workers.map((url, index) => {
      const parsed = new URL(url);
      return {
        id: `worker-${index}`,
        host: parsed.hostname,
        port: parseInt(parsed.port) || 8080,
        healthy: true,  // Assume healthy initially
        lastHealthCheck: new Date(),
        activeInstances: 0
      };
    });

    if (this.workers.length > 0) {
      this.startHealthChecks();
    }

    logger.info(`RemotePreviewOrchestrator initialized with ${this.workers.length} workers`, {
      component: 'RemotePreviewOrchestrator'
    });
  }

  /**
   * Create instance key for state storage
   */
  private createInstanceKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * Get worker URL
   */
  private getWorkerUrl(worker: PreviewWorker): string {
    return `http://${worker.host}:${worker.port}`;
  }

  /**
   * Select the best available worker (least loaded)
   */
  private selectWorker(): PreviewWorker | null {
    const healthyWorkers = this.workers.filter(w => w.healthy);
    
    if (healthyWorkers.length === 0) {
      return null;
    }

    // Select worker with fewest active instances
    return healthyWorkers.reduce((best, current) => 
      current.activeInstances < best.activeInstances ? current : best
    );
  }

  /**
   * Make HTTP request to worker
   */
  private async workerRequest<T>(
    worker: PreviewWorker,
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${this.getWorkerUrl(worker)}${path}`;
    const timeout = this.options.requestTimeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Worker request failed: ${response.status} - ${error}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start health check timer
   */
  private startHealthChecks(): void {
    const interval = this.options.healthCheckInterval || 30000;

    this.healthCheckTimer = setInterval(async () => {
      await this.checkWorkerHealth();
    }, interval);

    // Initial health check
    this.checkWorkerHealth();
  }

  /**
   * Check health of all workers
   */
  private async checkWorkerHealth(): Promise<void> {
    for (const worker of this.workers) {
      try {
        const response = await this.workerRequest<{ healthy: boolean; activeInstances: number }>(
          worker,
          '/health',
          'GET'
        );

        worker.healthy = response.healthy;
        worker.activeInstances = response.activeInstances || 0;
        worker.lastHealthCheck = new Date();
      } catch (error) {
        worker.healthy = false;
        logger.warn(`Worker ${worker.id} health check failed`, {
          component: 'RemotePreviewOrchestrator'
        });
      }
    }
  }

  // ============================================
  // PreviewOrchestratorPort Implementation
  // ============================================

  async start(params: PreviewParams): Promise<PreviewStartResult> {
    const { tenantId, userId, projectId, feature, workspacePath } = params;
    const instanceKey = this.createInstanceKey(tenantId, userId, projectId, feature);

    logger.info(`Starting remote preview: ${instanceKey}`, {
      component: 'RemotePreviewOrchestrator'
    });

    // Select a worker
    const worker = this.selectWorker();
    if (!worker) {
      return {
        success: false,
        error: 'No healthy preview workers available'
      };
    }

    try {
      // Send start request to worker
      const response = await this.workerRequest<WorkerPreviewResponse>(
        worker,
        '/preview/start',
        'POST',
        {
          tenantId,
          userId,
          projectId,
          feature,
          workspacePath
        }
      );

      if (!response.success) {
        return {
          success: false,
          error: response.error
        };
      }

      // Update worker instance count
      worker.activeInstances++;

      // Store instance info in state store
      const instance: PreviewInstance = {
        instanceId: instanceKey,
        host: worker.host,
        port: response.port || 0,
        status: 'starting',
        url: `/preview/${instanceKey}`,
        startedAt: new Date().toISOString()
      };

      // Store worker assignment
      await this.stateStore.publish(`preview:${instanceKey}:worker`, worker.id);

      // Register in preview registry
      await this.stateStore.registerPreview(
        tenantId,
        userId,
        projectId,
        feature,
        response.port || 0,
        worker.host
      );

      return {
        success: true,
        instance
      };
    } catch (error: any) {
      logger.error(`Failed to start remote preview: ${instanceKey}`, {
        component: 'RemotePreviewOrchestrator'
      }, error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  async stop(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string }> {
    const instanceKey = this.createInstanceKey(tenantId, userId, projectId, feature);

    logger.info(`Stopping remote preview: ${instanceKey}`, {
      component: 'RemotePreviewOrchestrator'
    });

    // Get worker assignment from port registry
    const portMapping = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
    if (!portMapping) {
      return { success: false, message: 'Preview instance not found' };
    }

    // Find the worker
    const worker = this.workers.find(w => w.host === portMapping.host);
    if (!worker) {
      // Worker might be gone, just clean up state
      await this.stateStore.unregisterPreview(tenantId, userId, projectId, feature);
      return { success: true, message: 'Worker not found, cleaned up state' };
    }

    try {
      await this.workerRequest(
        worker,
        '/preview/stop',
        'POST',
        { tenantId, userId, projectId, feature }
      );

      worker.activeInstances = Math.max(0, worker.activeInstances - 1);
      await this.stateStore.unregisterPreview(tenantId, userId, projectId, feature);

      return { success: true };
    } catch (error: any) {
      logger.error(`Failed to stop remote preview: ${instanceKey}`, {
        component: 'RemotePreviewOrchestrator'
      }, error);

      // Clean up state anyway
      await this.stateStore.unregisterPreview(tenantId, userId, projectId, feature);
      return { success: false, message: error.message };
    }
  }

  getStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewInstance | null {
    // For remote orchestrator, we need async access to state
    // This synchronous method returns cached data or null
    // Use getStatusAsync for accurate status
    return null;
  }

  /**
   * Get status asynchronously (preferred)
   */
  async getStatusAsync(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewInstance | null> {
    const portMapping = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
    if (!portMapping) {
      return null;
    }

    const host = portMapping.host || 'localhost';
    const worker = this.workers.find(w => w.host === host);
    if (!worker || !worker.healthy) {
      return {
        instanceId: this.createInstanceKey(tenantId, userId, projectId, feature),
        host,
        port: portMapping.port,
        status: 'error'
      };
    }

    try {
      const response = await this.workerRequest<{ status: PreviewStatus; packages?: any[] }>(
        worker,
        `/preview/status?tenantId=${tenantId}&userId=${userId}&projectId=${projectId}&feature=${feature}`,
        'GET'
      );

      return {
        instanceId: this.createInstanceKey(tenantId, userId, projectId, feature),
        host,
        port: portMapping.port,
        status: response.status,
        packages: response.packages,
        url: `/preview/${this.createInstanceKey(tenantId, userId, projectId, feature)}`
      };
    } catch {
      return {
        instanceId: this.createInstanceKey(tenantId, userId, projectId, feature),
        host,
        port: portMapping.port,
        status: 'error'
      };
    }
  }

  getLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewLogEntry[] {
    // Logs are stored in state store for distributed access
    // This returns an empty array; use getLogsAsync for actual logs
    return [];
  }

  /**
   * Get logs asynchronously
   */
  async getLogsAsync(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewLogEntry[]> {
    const portMapping = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
    if (!portMapping) {
      return [];
    }

    const worker = this.workers.find(w => w.host === portMapping.host);
    if (!worker) {
      return [];
    }

    try {
      const response = await this.workerRequest<{ logs: PreviewLogEntry[] }>(
        worker,
        `/preview/logs?tenantId=${tenantId}&userId=${userId}&projectId=${projectId}&feature=${feature}`,
        'GET'
      );

      return response.logs || [];
    } catch {
      return [];
    }
  }

  streamLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    callback: (log: PreviewLogEntry) => void
  ): () => void {
    const instanceKey = this.createInstanceKey(tenantId, userId, projectId, feature);
    
    // Subscribe to log channel in state store (Redis pub/sub)
    let unsubscribe: (() => void) | null = null;

    this.stateStore.subscribe(`preview:${instanceKey}:logs`, (message: unknown) => {
      callback(message as PreviewLogEntry);
    }).then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }

  async validateSetup(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string
  ): Promise<{
    isValid: boolean;
    issues?: PreviewIssue[];
  }> {
    // Select a worker to perform validation
    const worker = this.selectWorker();
    if (!worker) {
      return {
        isValid: false,
        issues: [{
          reasoning: 'no_workers',
          severity: 'fatal',
          reason: 'No healthy preview workers available'
        }]
      };
    }

    try {
      const response = await this.workerRequest<{ isValid: boolean; issues?: PreviewIssue[] }>(
        worker,
        '/preview/validate',
        'POST',
        { workspacePath }
      );

      return {
        isValid: response.isValid,
        issues: response.issues
      };
    } catch (error: any) {
      return {
        isValid: false,
        issues: [{
          reasoning: 'validation_error',
          severity: 'fatal',
          reason: error.message
        }]
      };
    }
  }

  async listInstances(): Promise<PreviewInstance[]> {
    const portMappings = await this.stateStore.listPreviews();
    
    return portMappings.map(mapping => ({
      instanceId: this.createInstanceKey(mapping.tenantId, mapping.userId, mapping.projectId, mapping.feature),
      host: mapping.host || 'localhost',
      port: mapping.port,
      status: 'running' as PreviewStatus,  // Assume running; getStatusAsync for accurate status
      url: `/preview/${this.createInstanceKey(mapping.tenantId, mapping.userId, mapping.projectId, mapping.feature)}`
    }));
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up all remote preview instances', {
      component: 'RemotePreviewOrchestrator'
    });

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Get all instances and stop them
    const instances = await this.listInstances();
    
    for (const instance of instances) {
      const parts = instance.instanceId.split(':');
      if (parts.length === 4) {
        await this.stop(parts[0], parts[1], parts[2], parts[3]);
      }
    }
  }

  // ============================================
  // Admin Methods
  // ============================================

  /**
   * Get worker status (for monitoring)
   */
  getWorkerStatus(): PreviewWorker[] {
    return this.workers.map(w => ({ ...w }));
  }

  /**
   * Force refresh worker health
   */
  async refreshWorkerHealth(): Promise<void> {
    await this.checkWorkerHealth();
  }
}
