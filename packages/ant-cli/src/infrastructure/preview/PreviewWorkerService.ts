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
import { InMemoryPortRegistry } from '../networking/InMemoryPortRegistry';
import { logger } from '../../utils/logger';

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
  private portRegistry: InMemoryPortRegistry;
  private server: any;
  private options: PreviewWorkerServiceOptions;

  constructor(options: PreviewWorkerServiceOptions = {}) {
    this.options = options;
    this.app = express();
    
    // Initialize port management
    this.portRegistry = new InMemoryPortRegistry();
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
