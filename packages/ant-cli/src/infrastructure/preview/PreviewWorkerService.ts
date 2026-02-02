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
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { PortManager } from '../networking/PortManager';
import { PortRegistryPort, PortMapping } from '../../core/ports/portRegistry';
import { logger } from '../../utils/logger';

/**
 * Simple in-memory port registry for preview worker.
 * Each worker manages its own local preview processes.
 * This is NOT shared state - it's worker-local only.
 */
class WorkerLocalPortRegistry implements PortRegistryPort {
  private previews = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();

  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * IDE uses project-level key (no feature) - IDE is shared across features
   */
  private createIDEKey(tenantId: string, userId: string, projectId: string): string {
    return `${tenantId}:${userId}:${projectId}`;
  }

  async registerPreview(tenantId: string, userId: string, projectId: string, feature: string, port: number, host: string = 'localhost'): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    this.previews.set(key, { tenantId, userId, projectId, feature, port, host, registeredAt: new Date(), lastAccessedAt: new Date() });
  }

  async registerIDE(tenantId: string, userId: string, projectId: string, port: number): Promise<void> {
    // IDE uses project-level key (no feature)
    const key = this.createIDEKey(tenantId, userId, projectId);
    this.ides.set(key, { tenantId, userId, projectId, feature: 'main', port, registeredAt: new Date(), lastAccessedAt: new Date() });
  }

  async getPreviewPort(tenantId: string, userId: string, projectId: string, feature: string): Promise<number | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    return this.previews.get(key)?.port ?? null;
  }

  async getPreview(tenantId: string, userId: string, projectId: string, feature: string): Promise<PortMapping | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    return this.previews.get(key) ?? null;
  }

  async getIDEPort(tenantId: string, userId: string, projectId: string): Promise<number | null> {
    // IDE uses project-level key (no feature)
    const key = this.createIDEKey(tenantId, userId, projectId);
    return this.ides.get(key)?.port ?? null;
  }

  async unregisterPreview(tenantId: string, userId: string, projectId: string, feature: string): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    this.previews.delete(key);
  }

  async unregisterIDE(tenantId: string, userId: string, projectId: string): Promise<void> {
    // IDE uses project-level key (no feature)
    const key = this.createIDEKey(tenantId, userId, projectId);
    this.ides.delete(key);
  }

  async listPreviews(): Promise<PortMapping[]> {
    return Array.from(this.previews.values());
  }

  async listIDEs(): Promise<PortMapping[]> {
    return Array.from(this.ides.values());
  }

  async updateLastAccess(tenantId: string, userId: string, projectId: string, feature: string, type: 'preview' | 'ide'): Promise<void> {
    // IDE uses project-level key (no feature), Preview uses feature
    const key = type === 'ide' 
      ? this.createIDEKey(tenantId, userId, projectId)
      : this.createKey(tenantId, userId, projectId, feature);
    const map = type === 'preview' ? this.previews : this.ides;
    const mapping = map.get(key);
    if (mapping) mapping.lastAccessedAt = new Date();
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
