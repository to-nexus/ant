/**
 * PreviewWorkerService
 * 
 * Service that runs on preview worker nodes.
 * Receives commands from RemotePreviewOrchestrator and manages local preview processes.
 * 
 * Features:
 * - HTTP API for preview management
 * - Local dev server process spawning
 * - Log streaming back to API server
 * - Health reporting
 * 
 * Usage:
 *   ANT_PREVIEW_WORKER_PORT=8080 npm run start:preview-worker
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.3
 */

import express, { Express, Request, Response } from 'express';
import * as os from 'os';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { PortManager } from '../networking/PortManager';
import { 
  PortRegistryPort, 
  PreviewState, 
  IDEState 
} from '../../core/ports/portRegistry';
import { logger } from '../../utils/logger';

/**
 * Simple in-memory port registry for preview worker.
 * Each worker manages its own local preview processes.
 * This is NOT shared state - it's worker-local only.
 * 
 * Note: This is a simplified implementation for worker-local state.
 * The main ant-preview server uses Redis-based state via RedisStateStore.
 */
class WorkerLocalPortRegistry implements PortRegistryPort {
  private previews = new Map<string, PreviewState>();
  private ides = new Map<string, IDEState>();
  private podId: string;

  constructor() {
    this.podId = os.hostname();
  }

  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  private createIDEKey(tenantId: string, userId: string, projectId: string): string {
    return `${tenantId}:${userId}:${projectId}`;
  }

  // ==========================================
  // Preview Management
  // ==========================================

  async registerPreview(state: Omit<PreviewState, 'lastAccessedAt'>): Promise<void> {
    const key = this.createKey(state.tenantId, state.userId, state.projectId, state.feature);
    this.previews.set(key, {
      ...state,
      lastAccessedAt: new Date()
    });
  }

  async getPreview(tenantId: string, userId: string, projectId: string, feature: string): Promise<PreviewState | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    return this.previews.get(key) ?? null;
  }

  async getPreviewPort(tenantId: string, userId: string, projectId: string, feature: string): Promise<number | null> {
    const state = await this.getPreview(tenantId, userId, projectId, feature);
    return state?.port ?? null;
  }

  async updatePreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'issues' | 'packages' | 'backendPort'>>
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const existing = this.previews.get(key);
    if (existing) {
      this.previews.set(key, {
        ...existing,
        ...update,
        lastAccessedAt: new Date()
      });
    }
  }

  async touchPreview(tenantId: string, userId: string, projectId: string, feature: string): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const existing = this.previews.get(key);
    if (existing) {
      existing.lastAccessedAt = new Date();
    }
  }

  async unregisterPreview(tenantId: string, userId: string, projectId: string, feature: string): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    this.previews.delete(key);
  }

  async listPreviews(): Promise<PreviewState[]> {
    return Array.from(this.previews.values());
  }

  async listPreviewsByPod(podId: string): Promise<PreviewState[]> {
    return Array.from(this.previews.values()).filter(p => p.podId === podId);
  }

  async getIdlePreviews(idleThresholdMs: number): Promise<PreviewState[]> {
    const now = Date.now();
    return Array.from(this.previews.values()).filter(p => {
      const lastAccess = new Date(p.lastAccessedAt).getTime();
      return (now - lastAccess) > idleThresholdMs;
    });
  }

  // ==========================================
  // IDE Management (minimal for worker)
  // ==========================================

  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number,
    host: string,
    podId: string
  ): Promise<void> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    this.ides.set(key, {
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
    });
  }

  async getIDE(tenantId: string, userId: string, projectId: string): Promise<IDEState | null> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    return this.ides.get(key) ?? null;
  }

  async getIDEPort(tenantId: string, userId: string, projectId: string): Promise<number | null> {
    const state = await this.getIDE(tenantId, userId, projectId);
    return state?.port ?? null;
  }

  async touchIDE(tenantId: string, userId: string, projectId: string): Promise<void> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    const existing = this.ides.get(key);
    if (existing) {
      existing.lastAccessedAt = new Date();
    }
  }

  async unregisterIDE(tenantId: string, userId: string, projectId: string): Promise<void> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    this.ides.delete(key);
  }

  async listIDEs(): Promise<IDEState[]> {
    return Array.from(this.ides.values());
  }

  async close(): Promise<void> {}
}

// ============================================
// Configuration
// ============================================

export interface PreviewWorkerServiceOptions {
  port?: number;
  redisUrl?: string;  // Optional: for log streaming via Redis pub/sub
}

// ============================================
// PreviewWorkerService
// ============================================

export class PreviewWorkerService {
  private app: Express;
  private previewService: PreviewService;
  private portManager: PortManager;
  private portRegistry: WorkerLocalPortRegistry;
  private server: any;
  private options: PreviewWorkerServiceOptions;

  constructor(options: PreviewWorkerServiceOptions = {}) {
    this.options = options;
    this.app = express();
    
    // Initialize port management (worker-local)
    this.portRegistry = new WorkerLocalPortRegistry();
    this.portManager = new PortManager();
    
    // Initialize preview service
    this.previewService = new PreviewService(this.portManager, this.portRegistry);

    this.setupRoutes();

    logger.info('PreviewWorkerService initialized', {
      component: 'PreviewWorkerService'
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    this.app.use(express.json());

    // Health check
    this.app.get('/health', async (req: Request, res: Response) => {
      const instances = await this.portRegistry.listPreviews();
      res.json({
        healthy: true,
        activeInstances: instances.length,
        timestamp: new Date().toISOString()
      });
    });

    // Start preview
    this.app.post('/preview/start', async (req: Request, res: Response) => {
      const { tenantId, userId, projectId, feature, workspacePath, port } = req.body;

      logger.info(`Start preview request: ${tenantId}:${userId}:${projectId}:${feature}`, {
        component: 'PreviewWorkerService'
      });

      try {
        const result = await this.previewService.startPreview(
          tenantId,
          userId,
          projectId,
          feature,
          workspacePath,
          port
        );

        res.json({
          success: result.success,
          instanceId: result.serverKey,
          port: result.port,
          error: result.error
        });
      } catch (error: any) {
        logger.error('Failed to start preview', { component: 'PreviewWorkerService' }, error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Stop preview
    this.app.post('/preview/stop', async (req: Request, res: Response) => {
      const { tenantId, userId, projectId, feature } = req.body;

      logger.info(`Stop preview request: ${tenantId}:${userId}:${projectId}:${feature}`, {
        component: 'PreviewWorkerService'
      });

      try {
        const result = await this.previewService.stopPreview(
          tenantId,
          userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('Failed to stop preview', { component: 'PreviewWorkerService' }, error);
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
    });

    // Get status
    this.app.get('/preview/status', (req: Request, res: Response) => {
      const { tenantId, userId, projectId, feature } = req.query as {
        tenantId: string;
        userId: string;
        projectId: string;
        feature: string;
      };

      const status = this.previewService.getPreviewStatus(
        tenantId,
        userId,
        projectId,
        feature
      );

      if (!status) {
        res.status(404).json({ error: 'Preview not found' });
        return;
      }

      res.json({
        status: status.running ? (status.ready ? 'running' : 'starting') : 'stopped',
        port: status.port,
        packages: status.packages,
        processCount: status.processCount
      });
    });

    // Get logs
    this.app.get('/preview/logs', (req: Request, res: Response) => {
      const { tenantId, userId, projectId, feature } = req.query as {
        tenantId: string;
        userId: string;
        projectId: string;
        feature: string;
      };

      const logs = this.previewService.getPreviewLogs(
        tenantId,
        userId,
        projectId,
        feature
      );

      res.json({ logs });
    });

    // Validate setup
    this.app.post('/preview/validate', async (req: Request, res: Response) => {
      const { workspacePath } = req.body;

      try {
        const result = await this.previewService.validatePreviewSetup(workspacePath);

        const issues = [];
        if (!result.valid && result.reason) {
          issues.push({
            reasoning: result.reasoning || 'validation_failed',
            severity: 'fatal',
            reason: result.reason,
            suggestedFix: result.suggestedFix
          });
        }

        res.json({
          isValid: result.valid,
          issues: issues.length > 0 ? issues : undefined
        });
      } catch (error: any) {
        res.status(500).json({
          isValid: false,
          issues: [{
            reasoning: 'validation_error',
            severity: 'fatal',
            reason: error.message
          }]
        });
      }
    });

    // List all instances
    this.app.get('/preview/list', async (req: Request, res: Response) => {
      const instances = await this.portRegistry.listPreviews();
      res.json({ instances });
    });
  }

  /**
   * Start the worker service
   */
  async start(): Promise<void> {
    const port = this.options.port || parseInt(process.env.ANT_PREVIEW_WORKER_PORT || '8080');

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.info(`PreviewWorkerService listening on port ${port}`, {
          component: 'PreviewWorkerService'
        });
        
        // Start idle check timer
        this.previewService.startIdleCheck();
        
        resolve();
      });
    });
  }

  /**
   * Stop the worker service
   */
  async stop(): Promise<void> {
    logger.info('Stopping PreviewWorkerService...', {
      component: 'PreviewWorkerService'
    });

    // Cleanup all preview instances
    await this.previewService.cleanup();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }

    logger.info('PreviewWorkerService stopped', {
      component: 'PreviewWorkerService'
    });
  }
}

/**
 * Create and start a PreviewWorkerService from environment variables
 */
export async function startPreviewWorker(): Promise<PreviewWorkerService> {
  const service = new PreviewWorkerService({
    port: parseInt(process.env.ANT_PREVIEW_WORKER_PORT || '8080'),
    redisUrl: process.env.ANT_REDIS_URL
  });

  await service.start();

  // Handle shutdown signals
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return service;
}
