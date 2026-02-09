/**
 * PreviewServer
 * 
 * Complete Preview Service for ant-preview deployment.
 * Handles all /preview/* requests according to 10-cloud-architecture.md
 * 
 * Features:
 * - External API: /projects/:id/start, stop, status
 * - Preview Proxy: /:key/* → Dev Server
 * - Redis-based state management (shared across pods)
 * - Dev Server lifecycle management
 * 
 * 별도 호스트: ant-preview.crosstoken.io → ant-preview service
 * 
 * @see docs/architecture/10-cloud-architecture.md Section 3.2
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as path from 'path';
import * as os from 'os';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { createPreviewProxyMiddleware } from '../../periphery/adapters/http/middleware/previewProxy';
import { PortManager } from '../networking/PortManager';
import { RedisStateStore } from '../state/RedisStateStore';
import { StateStorePort } from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { logger } from '../../utils/logger';

// ============================================
// Configuration
// ============================================

export interface PreviewServerOptions {
  port?: number;
  redisUrl: string;  // Required for distributed state
  workspacesPath?: string;
  mode?: 'local' | 'cloud';
}

// ============================================
// PreviewServer
// ============================================

export class PreviewServer {
  private app: Express;
  private previewService!: PreviewService;
  private portManager!: PortManager;
  private stateStore!: StateStorePort & PortRegistryPort;
  private server: any;
  private options: PreviewServerOptions;

  constructor(options: PreviewServerOptions) {
    this.options = options;
    this.app = express();
  }

  /**
   * Initialize services
   */
  private async initialize(): Promise<void> {
    // Initialize Redis-based state store
    this.stateStore = new RedisStateStore({
      url: this.options.redisUrl
    });
    
    logger.warn('[PreviewServer] Using RedisStateStore for distributed state', {
      component: 'PreviewServer'
    });

    // Initialize port management
    this.portManager = new PortManager();
    
    // Initialize preview service with Redis
    this.previewService = new PreviewService(
      this.portManager,
      this.stateStore,  // Redis as PortRegistry
      {
        onStatusChange: (serverKey) => {
          logger.debug(`[PreviewServer] Status changed: ${serverKey}`, {
            component: 'PreviewServer'
          });
        }
      },
      this.stateStore  // Redis as StateStore for Pub/Sub
    );

    logger.info('[PreviewServer] Services initialized', {
      component: 'PreviewServer'
    });
  }

  /**
   * Get Pod IP for K8s multi-replica support
   */
  private getPodHost(): string {
    const podIp = process.env.POD_IP;
    if (podIp) {
      return podIp;
    }
    
    try {
      const interfaces = os.networkInterfaces();
      for (const [name, ifaces] of Object.entries(interfaces)) {
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue;
          if (name === 'eth0' || name.startsWith('en')) {
            return iface.address;
          }
        }
      }
      for (const ifaces of Object.values(interfaces)) {
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue;
          return iface.address;
        }
      }
    } catch {
      // Ignore
    }
    
    return 'localhost';
  }

  /**
   * Extract user context from request headers (Cloud mode)
   */
  private extractUserContext(req: Request): { organizationId: string; userId: string } {
    // Cloud mode: get from headers (set by API Gateway or auth proxy)
    const email = req.headers['x-user-email'] as string || req.query['user-email'] as string;
    
    if (email && email.includes('@')) {
      // Extract userId and organizationId from email (e.g., probe@to.nexus)
      const [userId, organizationId] = email.split('@');
      return { organizationId, userId };
    }
    
    // Explicit header override (if provided)
    const orgIdHeader = req.headers['x-organization-id'] as string;
    const userIdHeader = req.headers['x-user-id'] as string;
    if (orgIdHeader && userIdHeader) {
      return { organizationId: orgIdHeader, userId: userIdHeader };
    }
    
    // Local mode fallback
    return { organizationId: 'local', userId: 'local' };
  }

  /**
   * Resolve workspace path for a project
   */
  private resolveWorkspacePath(
    userContext: { organizationId: string; userId: string },
    projectId: string
  ): string {
    const basePath = this.options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
    return path.join(basePath, userContext.organizationId, userContext.userId, projectId, 'codebase');
  }

  /**
   * Setup Express middleware and routes
   */
  private setupRoutes(): void {
    // CORS - explicit allowed origins
    const allowedOrigins = [
      'https://ant.crosstoken.io',
      'https://ant-server.crosstoken.io',
      'https://ant-preview.crosstoken.io',
      'https://*.crosstoken.io',
    ];

    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, server-to-server, health checks, etc.)
        if (!origin) {
          return callback(null, true);
        }

        // Check if origin matches allowed list (supports wildcard patterns)
        if (allowedOrigins.some(allowed => {
          if (allowed.includes('*')) {
            const pattern = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
            return pattern.test(origin);
          }
          return allowed === origin;
        })) {
          return callback(null, true);
        }

        // Allow any localhost origin in development
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }

        callback(new Error(`CORS not allowed for origin: ${origin}`));
      },
      credentials: true
    }));

    // Health check (before other middleware)
    this.app.get('/health', async (_req: Request, res: Response) => {
      const previews = await this.stateStore.listPreviews();
      res.json({
        healthy: true,
        service: 'ant-preview',
        activeInstances: previews.length,
        timestamp: new Date().toISOString()
      });
    });

    // Preview Proxy - MUST be before body parsers
    // Routes: /:key/* where key = tenantId:userId:projectId:feature
    // 별도 호스트 (ant-preview.crosstoken.io) 이므로 pathPrefix 불필요
    this.app.use(createPreviewProxyMiddleware({
      portRegistry: this.stateStore,
      pathPrefix: '',
      getBackendPort: async ({ tenantId, userId, projectId, feature }) => {
        const state = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
        return state?.backendPort || null;
      }
    }));

    // Body parser for API routes
    this.app.use(express.json({ limit: '50mb' }));

    // ==========================================
    // Preview Management API
    // ==========================================

    /**
     * POST /preview/projects/:id/start
     * Start preview for a project
     */
    this.app.post('/projects/:id/start', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.body?.feature || 'main';
        const port = req.body?.port;
        const forceRestart = req.body?.forceRestart !== false;

        logger.warn(`[PreviewServer] POST /projects/${projectId}/start (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const workspacePath = this.resolveWorkspacePath(userContext, projectId);

        const result = await this.previewService.startPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          workspacePath,
          port,
          forceRestart
        );

        if (result.success) {
          res.json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error: any) {
        logger.error('[PreviewServer] Start error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /preview/projects/:id/stop
     * Stop preview for a project
     */
    this.app.post('/projects/:id/stop', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.body?.feature || 'main';

        logger.warn(`[PreviewServer] POST /projects/${projectId}/stop (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const result = await this.previewService.stopPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Stop error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /preview/projects/:id/status
     * Get preview status for a project
     */
    this.app.get('/projects/:id/status', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.query.feature as string || 'main';

        const status = this.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const logs = this.previewService.getPreviewLogs(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        if (!status) {
          res.json({
            running: false,
            ready: false,
            port: null,
            url: null,
            processCount: 0,
            packages: [],
            issues: [],
            logs: []
          });
          return;
        }

        res.json({
          running: status.running,
          ready: status.ready,
          port: status.port || null,
          url: status.port ? `/${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}` : null,
          processCount: status.processCount || 0,
          backendPort: status.backendPort || null,
          packages: status.packages || [],
          issues: status.issues || [],
          logs: logs.slice(-50)
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Status error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /preview/projects/:id/validate
     * Validate preview setup
     */
    this.app.get('/projects/:id/validate', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);

        const workspacePath = this.resolveWorkspacePath(userContext, projectId);
        const result = await this.previewService.validatePreviewSetup(workspacePath);

        res.json({
          valid: result.valid,
          reason: result.reason,
          suggestedFix: result.suggestedFix
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Validate error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    // ==========================================
    // Admin/Debug Endpoints
    // ==========================================

    /**
     * GET /preview/admin/instances
     * List all preview instances (admin only)
     */
    this.app.get('/admin/instances', async (_req: Request, res: Response) => {
      try {
        const previews = await this.stateStore.listPreviews();
        res.json({ instances: previews });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'Preview endpoint not found'
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.initialize();
    this.setupRoutes();

    const port = this.options.port || parseInt(process.env.PORT || '8080');

    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        logger.warn(`[PreviewServer] 🚀 Preview listening on port ${port}`, {
          component: 'PreviewServer'
        });
        logger.warn(`[PreviewServer] 📡 Ready for /preview/* requests`, {
          component: 'PreviewServer'
        });
        
        // Start idle check
        this.previewService.startIdleCheck();
        
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    logger.info('[PreviewServer] Stopping...', { component: 'PreviewServer' });

    // Cleanup preview service
    await this.previewService.cleanup();

    // Close Redis connection
    if (this.stateStore && typeof (this.stateStore as any).close === 'function') {
      await (this.stateStore as any).close();
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }

    logger.info('[PreviewServer] Stopped', { component: 'PreviewServer' });
  }
}

/**
 * Create and start PreviewServer
 */
export async function createPreviewServer(): Promise<PreviewServer> {
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    throw new Error('ANT_REDIS_URL is required for Preview Server');
  }

  const server = new PreviewServer({
    port: parseInt(process.env.PORT || '8080'),
    redisUrl,
    workspacesPath: process.env.ANT_WORKSPACE_BASE_PATH,
    mode: process.env.ANT_SERVER_MODE === 'cloud' ? 'cloud' : 'local'
  });

  // Handle shutdown signals
  const shutdown = async () => {
    logger.warn('[PreviewServer] SIGTERM received, shutting down...', {
      component: 'PreviewServer'
    });
    await server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.start();
  return server;
}
