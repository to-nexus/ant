import { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createIDEProxyMiddleware } from '../../middleware/ideProxy';
import { createCorsMiddleware } from '../../middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../middleware/jwtAuth';

import { JwtService } from '../../../../../infrastructure/auth/JwtService';
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
   *
   * Middleware order matters:
   * 1. CORS + security headers
   * 2. Favicon (avoid noisy 401s)
   * 3. Cookie parser (needed by IDE proxy auth)
   * 4. IDE proxy auth (JWT check before proxy intercepts)
   * 5. Proxy middleware (intercepts /ide/ requests, no next())
   * 6. Body parsers (must come after proxy)
   * 7. General JWT auth (all other routes)
   */
  configure(app: Express): void {
    if (process.env.NODE_ENV === 'production') {
      app.set('trust proxy', 1);
    }
    this.setupCors(app);
    this.setupSecurityHeaders(app);
    this.setupFaviconHandler(app);
    this.setupCookieParser(app);
    this.setupIdeProxyAuth(app);
    this.setupProxyMiddleware(app);
    this.setupBodyParsers(app);
    this.setupAuthentication(app);
  }

  /**
   * Configure CORS with environment-aware origin checking
   */
  private setupCors(app: Express): void {
    app.use(createCorsMiddleware());
  }

  /**
   * Apply security headers via helmet
   */
  private setupSecurityHeaders(app: Express): void {
    app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
      frameguard: false,
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
   * IMPORTANT: Must be registered BEFORE body parsers (proxy streams raw bytes)
   * JWT auth is handled by setupIdeProxyAuth() which runs before this.
   * 
   * Note: Preview Proxy moved to ant-preview (see 10-cloud-architecture.md)
   */
  private setupProxyMiddleware(app: Express): void {
    app.use(createIDEProxyMiddleware({
      portRegistry: this.deps.portRegistry,
      pathPrefix: '/ide'
    }));
  }

  /**
   * Setup cookie parser (must come BEFORE proxy and auth middleware)
   */
  private setupCookieParser(app: Express): void {
    app.use(cookieParser());
  }

  /**
   * Authenticate /ide/ requests BEFORE the proxy middleware intercepts them.
   * In cloud mode, verifies JWT cookie and sets req.user.
   * In local mode, skips auth (authService is undefined).
   */
  private setupIdeProxyAuth(app: Express): void {
    if (!this.deps.authService) {
      // Local mode: no authentication
      return;
    }

    const jwtService = this.deps.jwtService;
    if (!jwtService) {
      return;
    }

    app.use('/ide/', (req: Request, res: Response, next: NextFunction) => {
      const token = req.cookies?.[JwtService.cookieName];
      if (!token) {
        res.status(401).json({ error: 'Authentication required for IDE access' });
        return;
      }
      try {
        const payload = jwtService.verify(token);
        req.user = {
          id: payload.sub,
          email: payload.email,
          organizationId: payload.org,
        };
        req.organization = {
          id: payload.org,
          name: payload.org,
        };
        next();
      } catch {
        res.status(401).json({ error: 'Invalid session for IDE access' });
      }
    });
  }

  /**
   * Setup body parsers (must come AFTER proxy middleware)
   */
  private setupBodyParsers(app: Express): void {
    app.use(express.json({ limit: '50mb' }));
  }

  /**
   * Setup authentication middleware
   * 
   * Cloud mode: JWT cookie-based authentication
   * Local mode: no auth (authService is undefined, early return)
   */
  private setupAuthentication(app: Express): void {
    if (!this.deps.authService) {
      // Local mode: no authentication
      return;
    }

    // Cloud mode: JWT cookie authentication
    const jwtService = this.deps.jwtService;
    if (!jwtService) {
      throw new Error('ANT_JWT_SECRET is required in cloud mode. Set the environment variable to enable authentication.');
    }

    app.use(createJwtAuthMiddleware({
      jwtService,
      publicPaths: [
        '/api/health',
        '/api/system/config',
        '/api/agents',
        '/',
        '/local',
        '/api/auth/google',
        '/api/auth/google/callback',
        '/api/auth/me',
        '/api/auth/signout',
        '/api/figma/oauth/callback',
      ],
      publicPrefixes: [],
    }));
  }

  /**
   * Check if path is a polling endpoint (reduce logging noise)
   */
  isPollingEndpoint(path: string): boolean {
    return path.includes('/projects') || 
           path.includes('/session') || 
           path.includes('/stream');
  }
}
