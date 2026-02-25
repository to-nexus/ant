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
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { IncomingMessage } from 'http';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { createPreviewProxyMiddleware } from '../../periphery/adapters/http/middleware/previewProxy';
import { PortManager } from '../networking/PortManager';
import { RedisStateStore } from '../state/RedisStateStore';
import { StateStorePort } from '../../core/ports/stateStore';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { parsePreviewKey } from '../state/redisKeyUtils';
import { toUrlKey, toUrlKeyWithService, fromUrlKey, isUrlKey } from '../../periphery/adapters/http/services/PreviewService/utils/serverKeyUtils';
import { ProjectStructureDetector } from '../../periphery/adapters/http/services/PreviewService/detectors/ProjectStructureDetector';
import { ConnectionDetector } from '../../periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector';
import { InfrastructureManager } from '../../periphery/adapters/http/services/PreviewService/managers/InfrastructureManager';
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
   * Resolve workspace path for a project (feature-aware)
   */
  private resolveWorkspacePath(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature?: string
  ): string {
    const basePath = this.options.workspacesPath || process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces';
    
    if (feature && feature !== 'main') {
      // Feature worktree path: basePath/org/user/projectId/features/{feature}/codebase
      return path.join(basePath, userContext.organizationId, userContext.userId, projectId, 'features', feature, 'codebase');
    }
    
    // Main codebase path: basePath/org/user/projectId/codebase
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
    // Routes: /:urlKey/* where urlKey = tenantId--userId--projectId--feature
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

        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);

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
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;
        const urlKey = toUrlKey(serverKey);

        // getPreviewStatus reads from Redis (source of truth), with local memory fallback.
        // This guarantees consistent state across pods in multi-pod deployments.
        const status = await this.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Logs are only available on the owning pod (stored in local memory)
        const logs = this.previewService.getPreviewLogs(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Compute canStart + detect project profile: lightweight filesystem check when idle
        let canStart = false;
        let fsProjectProfile: { language: string; framework?: string } | undefined;
        let fsStructureType: string | undefined;
        if (!status.running && status.phase !== 'installing' && status.phase !== 'starting') {
          try {
            const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
            const detection = this.detectProjectQuick(workspacePath);
            canStart = detection.canStart;
            fsProjectProfile = detection.projectProfile;
            fsStructureType = detection.structureType;
          } catch {
            // Filesystem check failure → canStart remains false
          }
        }

        // Use Redis values (from decompose) first, filesystem detection as fallback
        res.json({
          running: status.running,
          ready: status.ready,
          port: status.port || null,
          url: status.port ? `/${urlKey}` : null,
          processCount: status.processCount || 0,
          backendPort: status.backendPort || null,
          packages: status.packages || [],
          issues: status.issues || [],
          phase: status.phase,
          error: status.error,
          setupReasoning: status.setupReasoning,
          setupReason: status.setupReason,
          suggestedFix: status.suggestedFix,
          structureType: status.structureType || fsStructureType || null,
          projectProfile: (status as any).projectProfile || fsProjectProfile || null,
          connections: status.connections || [],
          canStart,
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

        const feature = req.query.feature as string || 'main';
        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
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
    // Preview Config Endpoints
    // ==========================================

    /**
     * GET /preview/projects/:id/preview-config
     * Get preview configuration (connections, structureType, projectProfile).
     * If connections registry is empty and project files exist, runs ConnectionDetector
     * once and caches the result in Redis.
     */
    this.app.get('/projects/:id/preview-config', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.query.feature as string || 'main';
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;

        let config = await this.stateStore.getPreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const status = await this.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Auto-detect connections if registry is empty and project files exist
        let connections = config?.connections || [];
        if (connections.length === 0) {
          try {
            const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
            if (fs.existsSync(workspacePath)) {
              const detector = new ProjectStructureDetector();
              const structure = await detector.detect(workspacePath);
              if (structure) {
                const connectionDetector = new ConnectionDetector();
                connections = connectionDetector.detect(workspacePath, structure, serverKey);
                if (connections.length > 0) {
                  await this.stateStore.savePreviewConfig(
                    userContext.organizationId, userContext.userId, projectId, feature,
                    { connections }
                  );
                  logger.info(`[PreviewServer] Auto-detected ${connections.length} connections for ${projectId}/${feature}`, { component: 'PreviewServer' });
                }
              }
            }
          } catch (detectErr: any) {
            logger.warn(`[PreviewServer] Connection auto-detect failed: ${detectErr.message}`, { component: 'PreviewServer' });
          }
        }

        res.json({
          structureType: status.structureType || config?.structureType || null,
          projectProfile: config?.projectProfile || null,
          connections,
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config get error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * PUT /preview/projects/:id/preview-config
     * Save preview configuration (connections).
     * Validates resolution type constraints and auto-computes ant-project proxy paths.
     */
    this.app.put('/projects/:id/preview-config', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.body.feature || 'main';
        const { connections } = req.body;

        // Validate resolution type constraints
        const VALID_RESOLUTIONS: Record<string, string[]> = {
          infrastructure: ['url', 'docker'],
          business: ['url', 'ant-project'],
        };
        for (const conn of (connections || [])) {
          const allowed = VALID_RESOLUTIONS[conn.category];
          if (allowed && conn.resolution?.type && !allowed.includes(conn.resolution.type)) {
            res.status(400).json({
              error: `Invalid resolution type '${conn.resolution.type}' for category '${conn.category}'. Allowed: ${allowed.join(', ')}`,
              envVar: conn.envVar,
            });
            return;
          }
        }

        // Resolve ant-project connections: compute resolvedUrlKey and proxy path
        const resolvedConnections = (connections || []).map((conn: any) => {
          if (conn.resolution?.type === 'ant-project' && conn.resolution.projectId && conn.resolution.feature) {
            // Resolve 'self' placeholders to actual project/feature
            const resolvedProjectId = conn.resolution.projectId === 'self' ? projectId : conn.resolution.projectId;
            const resolvedFeature = conn.resolution.feature === 'self' ? feature : conn.resolution.feature;
            const backendServerKey = `${userContext.organizationId}:${userContext.userId}:${resolvedProjectId}:${resolvedFeature}`;
            const resolvedUrlKey = toUrlKeyWithService(backendServerKey, conn.resolution.serviceName);
            return {
              ...conn,
              resolution: {
                ...conn.resolution,
                resolvedUrlKey,
              },
              value: `/${resolvedUrlKey}`,
            };
          }
          return conn;
        });

        // Strip runtime status before persisting (status is transient, belongs in PREVIEW state only)
        const configConnections = resolvedConnections.map(({ status, ...rest }: any) => rest);
        await this.stateStore.savePreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          { connections: configConnections }
        );

        logger.info(`[PreviewServer] Preview config saved: ${projectId}/${feature} (${resolvedConnections.length} connections)`, { component: 'PreviewServer' });
        res.json({ success: true, connections: resolvedConnections });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config save error', { component: 'PreviewServer' }, error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /preview/projects/:id/detect-connections
     * Re-scan project files for connections and overwrite the registry.
     * Used by the "Auto Detect" button in Config UI.
     */
    this.app.post('/projects/:id/detect-connections', async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = this.extractUserContext(req);
        const feature = req.body.feature || req.query.feature as string || 'main';
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;

        const workspacePath = this.resolveWorkspacePath(userContext, projectId, feature);
        if (!fs.existsSync(workspacePath)) {
          res.status(404).json({ error: 'Project workspace not found', path: workspacePath });
          return;
        }

        let connections: import('../../core/ports/portRegistry').ServiceConnection[] = [];
        try {
          const structureDetector = new ProjectStructureDetector();
          const structure = await structureDetector.detect(workspacePath);
          if (structure) {
            const connectionDetector = new ConnectionDetector();
            connections = connectionDetector.detect(workspacePath, structure, serverKey);
          }
        } catch (detectErr: any) {
          logger.warn(`[PreviewServer] Structure detection failed, clearing connections: ${detectErr.message}`, { component: 'PreviewServer' });
        }

        // Enrich docker connections with live infrastructure status
        const infraManager = new InfrastructureManager();
        const infraProjectName = `ant-${projectId}-${feature}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const infraStatus = await infraManager.getInfraStatus(workspacePath, infraProjectName);
        if (infraStatus.length > 0) {
          for (const conn of connections) {
            const isDocker = typeof conn.resolution === 'object' && conn.resolution?.type === 'docker';
            if (isDocker) {
              const dockerService = (conn.resolution as { type: 'docker'; service: string }).service || conn.id;
              const svc = infraStatus.find(s =>
                s.name === dockerService || conn.id.includes(s.name) || s.name.includes(conn.id)
              );
              conn.status = svc?.status === 'running' ? 'active'
                          : svc?.status === 'stopped' ? 'not-started'
                          : svc ? 'unreachable' : conn.status;
            }
          }
        }

        // Save to preview-config (strip runtime status — it belongs in PREVIEW state only)
        const configConnections = connections.map(({ status, ...rest }: any) => rest);
        await this.stateStore.savePreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          { connections: configConnections }
        );

        // Also update PreviewState if preview is currently running
        try {
          const currentState = await this.previewService.getPreviewStatus(
            userContext.organizationId, userContext.userId, projectId, feature
          );
          if (currentState.running) {
            await this.stateStore.updatePreview(
              userContext.organizationId, userContext.userId, projectId, feature,
              { connections }
            );
          }
        } catch { /* best-effort */ }

        logger.info(`[PreviewServer] Detect-connections: found ${connections.length} for ${projectId}/${feature}`, { component: 'PreviewServer' });
        res.json({ success: true, connections });
      } catch (error: any) {
        logger.error('[PreviewServer] Detect connections error', { component: 'PreviewServer' }, error);
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

      // ✅ WebSocket Upgrade Proxy
      // Next.js dev server requires WebSocket for HMR (Hot Module Replacement).
      // Without this, the HotReload component fails and the page doesn't render properly.
      // We intercept HTTP Upgrade requests on the server, extract the serverKey from the URL,
      // look up the dev server port, then create a raw TCP tunnel to the dev server.
      this.server.on('upgrade', async (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
        try {
          const urlPath = req.url || '/';
          const segments = urlPath.split('/').filter(Boolean);
          const firstSegment = segments[0] || '';

          // Check if first segment is a URL-safe serverKey (contains double-dashes)
          if (!isUrlKey(firstSegment)) {
            socket.destroy();
            return;
          }

          const internalKey = fromUrlKey(firstSegment);
          const parsed = parsePreviewKey(internalKey);
          if (!parsed) {
            socket.destroy();
            return;
          }

          const { tenantId, userId, projectId, feature } = parsed;
          const mapping = await this.stateStore.getPreview(tenantId, userId, projectId, feature);
          if (!mapping) {
            socket.destroy();
            return;
          }

          const targetHost = mapping.host || 'localhost';
          const targetPort = mapping.port;

          // All frameworks use native base path — always keep the prefix
          const targetPath = urlPath;

          logger.debug(`[PreviewServer] WS upgrade: ${urlPath} → ${targetHost}:${targetPort}${targetPath}`, {
            component: 'PreviewServer'
          });

          // Open TCP connection to dev server
          const proxySocket = net.connect(targetPort, targetHost, () => {
            // Reconstruct the HTTP upgrade request with corrected Host and path
            const rawHeaders: string[] = [];
            const rawHeaderPairs = req.rawHeaders;
            for (let i = 0; i < rawHeaderPairs.length; i += 2) {
              const key = rawHeaderPairs[i];
              const value = rawHeaderPairs[i + 1];
              if (key.toLowerCase() === 'host') {
                rawHeaders.push(`Host: ${targetHost}:${targetPort}`);
              } else {
                rawHeaders.push(`${key}: ${value}`);
              }
            }

            const upgradeReq =
              `${req.method} ${targetPath} HTTP/${req.httpVersion}\r\n` +
              rawHeaders.join('\r\n') +
              '\r\n\r\n';

            proxySocket.write(upgradeReq);
            if (head.length > 0) {
              proxySocket.write(head);
            }

            // Bidirectional pipe: client ↔ dev server
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
          });

          proxySocket.on('error', (err) => {
            logger.debug(`[PreviewServer] WS proxy error: ${err.message}`, { component: 'PreviewServer' });
            socket.destroy();
          });
          socket.on('error', () => {
            proxySocket.destroy();
          });
          socket.on('close', () => {
            proxySocket.destroy();
          });
        } catch (error: any) {
          logger.warn(`[PreviewServer] WS upgrade failed: ${error.message}`, { component: 'PreviewServer' });
          socket.destroy();
        }
      });
    });
  }

  /**
   * Check if preview can be started (lightweight filesystem check).
   * Returns true if workspace has a package.json with dev/start scripts,
   * or a Makefile/go.mod indicating a runnable project.
   */
  /**
   * Lightweight filesystem check: can the project be started, and what is its profile?
   * Delegates to ProjectStructureDetector.quickDetect() for unified detection logic.
   */
  private detectProjectQuick(workspacePath: string): {
    canStart: boolean;
    projectProfile?: { language: string; framework?: string };
    structureType?: string;
  } {
    try {
      const result = ProjectStructureDetector.quickDetect(workspacePath);
      if (!result) {
        return { canStart: false };
      }
      return {
        canStart: result.canStart,
        projectProfile: { language: result.language },
        structureType: result.structureType,
      };
    } catch {
      return { canStart: false };
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    logger.info('[PreviewServer] Stopping...', { component: 'PreviewServer' });

    // Cleanup preview service
    try {
      await this.previewService.cleanup();
    } catch (err) {
      logger.warn('[PreviewServer] Error during preview cleanup', { component: 'PreviewServer' }, err);
    }

    // Close Redis connection (may already be closed if another service shut down first)
    try {
      if (this.stateStore && typeof (this.stateStore as any).close === 'function') {
        await (this.stateStore as any).close();
      }
    } catch (err) {
      logger.warn('[PreviewServer] Error closing Redis', { component: 'PreviewServer' }, err);
    }

    // Close HTTP server with timeout
    if (this.server) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn('[PreviewServer] Shutdown timed out, forcing', { component: 'PreviewServer' });
          resolve();
        }, 5000);

        this.server.close(() => {
          clearTimeout(timeout);
          resolve();
        });
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

  // Handle shutdown signals (once guard prevents re-entrant shutdown)
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.warn(`[PreviewServer] ${signal} received, shutting down...`, {
      component: 'PreviewServer'
    });
    await server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.start();
  return server;
}
