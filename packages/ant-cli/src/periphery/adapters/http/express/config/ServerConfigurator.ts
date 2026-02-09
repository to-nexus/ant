import { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import cors from 'cors';
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
   * Configure CORS with explicit allowed origins
   */
  private setupCors(app: Express): void {
    const allowedOrigins = [
      'https://ant.crosstoken.io',
      'https://ant-server.crosstoken.io',
      'https://ant-preview.crosstoken.io',
      'https://*.crosstoken.io',
    ];

    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin, server-to-server, Postman, etc.)
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
   * Setup proxy middleware for IDE containers
   * IMPORTANT: Must be registered BEFORE body parsers
   * 
   * Note: Preview Proxy moved to ant-preview (see 10-cloud-architecture.md)
   */
  private setupProxyMiddleware(app: Express): void {
    // IDE Proxy (handles /ide/:serverKey requests)
    app.use(createIDEProxyMiddleware({
      portRegistry: this.deps.portRegistry,
      pathPrefix: '/ide'
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

      // IDE proxy requests (preview is on a separate host)
      if (req.path.startsWith('/ide/')) {
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
