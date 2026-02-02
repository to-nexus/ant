import { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import cors from 'cors';
import { createPreviewProxyMiddleware } from '../../middleware/previewProxy';
import { createIDEProxyMiddleware } from '../../middleware/ideProxy';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';

/**
 * ServerConfigurator
 * 
 * Configures Express app with middleware, body parsers, and authentication.
 * Handles CORS, proxy middleware, and Cloud/Local mode authentication.
 */
export class ServerConfigurator {
  constructor(
    private readonly config: ServerConfig,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Apply all middleware and configuration to Express app
   */
  configure(app: Express): void {
    this.setupCors(app);
    this.setupFaviconHandler(app);
    this.setupProxyMiddleware(app);
    this.setupBodyParsers(app);
    this.setupAuthentication(app);
  }

  /**
   * Configure CORS to support credentials
   */
  private setupCors(app: Express): void {
    app.use(cors({
      origin: true,
      credentials: true
    }));
    
    // ✅ Log IDE/Preview requests for debugging routing issues
    app.use((req, _res, next) => {
      if (req.path.startsWith('/api/ide/') || req.path.startsWith('/api/preview/')) {
        logger.warn(`[INCOMING] ${req.method} ${req.path}`, { component: 'ServerConfigurator' });
      }
      next();
    });
  }

  /**
   * Handle favicon.ico requests to avoid noisy 401s
   */
  private setupFaviconHandler(app: Express): void {
    app.get('/favicon.ico', (_req: Request, res: Response) => {
      res.status(204).end();
    });
  }

  /**
   * Setup proxy middleware for preview servers and IDE containers
   * IMPORTANT: Must be registered BEFORE body parsers
   * 
   * NOTE: Using /api/preview and /api/ide paths to leverage existing Ingress rules
   * that route /api/* to ant-api service. This avoids needing separate Ingress entries.
   */
  private setupProxyMiddleware(app: Express): void {
    // Preview Proxy (handles /api/preview/:serverKey requests)
    app.use(createPreviewProxyMiddleware({
      portRegistry: this.deps.portRegistry,
      pathPrefix: '/api/preview',
      getBackendPort: ({ tenantId, userId, projectId, feature }) => {
        try {
          return this.deps.previewService.getPreviewStatus(tenantId, userId, projectId, feature).backendPort;
        } catch {
          return undefined;
        }
      }
    }));

    // ✅ Log all /api/ide/* requests BEFORE proxy (for debugging routing issues)
    app.use('/api/ide', (req, res, next) => {
      logger.warn(`[IDE_ROUTE] Incoming request: ${req.method} ${req.originalUrl}`, { component: 'ServerConfigurator' });
      next();
    });
    
    // IDE Proxy (handles /api/ide/:serverKey requests)
    app.use(createIDEProxyMiddleware({
      portRegistry: this.deps.portRegistry,
      pathPrefix: '/api/ide'
    }));
  }

  /**
   * Setup body parsers (must come AFTER proxy middleware)
   */
  private setupBodyParsers(app: Express): void {
    app.use(express.json({ limit: '50mb' }));
  }

  /**
   * Setup authentication middleware for Cloud mode
   */
  private setupAuthentication(app: Express): void {
    if (this.config.mode !== 'cloud' || !this.deps.authService) {
      return;
    }

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      // Check if authentication should be skipped for localhost
      const skipAuthForLocalhost = process.env.SKIP_AUTH_FOR_LOCALHOST === 'true';
      
      if (skipAuthForLocalhost) {
        req.user = {
          id: 'dev',
          email: 'dev@localhost',
          organizationId: 'localhost'
        };
        req.organization = {
          id: 'localhost',
          name: 'localhost'
        };
        return next();
      }

      // Public paths that don't require authentication
      if (this.isPublicPath(req.path)) {
        return next();
      }

      // SSE endpoints (EventSource doesn't support headers)
      if (req.path.includes('/stream')) {
        return next();
      }

      // Preview and IDE proxy requests
      if (req.path.startsWith('/preview/') || req.path.startsWith('/ide/')) {
        return next();
      }

      try {
        // Check both header and query parameter for user email
        const emailFromHeader = req.headers['x-user-email'] as string;
        const emailFromQuery = req.query['user-email'] as string;
        const email = emailFromHeader || emailFromQuery;
        
        if (!email) {
          return res.status(401).json({ 
            error: 'Authentication required', 
            message: 'x-user-email header or user-email query parameter is required in cloud mode' 
          });
        }
        
        const authContext = await this.deps.authService.authenticate({ email });
        
        // Attach user context to request
        req.user = authContext.user;
        req.organization = authContext.organization;
        
        // Only log auth for non-polling endpoints
        if (!this.isPollingEndpoint(req.path)) {
          logger.debug(`[Auth] ${authContext.user.id}@${authContext.organization.id}`, { 
            component: 'Auth', 
            organizationId: authContext.organization.id, 
            userId: authContext.user.id 
          });
        }
        
        next();
      } catch (error: any) {
        logger.warn(`[Auth] Authentication failed: ${error.message}`, { component: 'Auth' }, error);
        return res.status(401).json({ 
          error: 'Authentication failed', 
          message: error.message 
        });
      }
    });
  }

  /**
   * Check if path is public (no authentication required)
   */
  private isPublicPath(path: string): boolean {
    const publicPaths = [
      '/api/health',
      '/api/system/config',
      '/api/agents',
      '/',
      '/local',
      '/api/auth/signup',
      '/api/auth/signin',
      '/api/auth/signout',
      '/api/auth/google',
      '/api/auth/google/callback',
      '/api/internal/task-queue',
      '/api/internal/file-tree-update',
      '/api/figma/oauth/authorize',
      '/api/figma/oauth/callback',
    ];
    
    const internalEndpoints = [
      '/api/jobs/queue/next',
      '/api/jobs/queue/complete',
      '/api/internal/task-queue',
      '/api/internal/file-tree-update',
    ];
    
    const isGraphMetadata = path.includes('/graph-metadata');
    
    return publicPaths.includes(path) || 
           internalEndpoints.some(p => path.startsWith(p)) ||
           isGraphMetadata;
  }

  /**
   * Check if path is a polling endpoint (reduce logging noise)
   */
  private isPollingEndpoint(path: string): boolean {
    return path.includes('/projects') || 
           path.includes('/session') || 
           path.includes('/stream');
  }
}
