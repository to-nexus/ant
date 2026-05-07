/**
 * JWT Cookie Authentication Middleware
 *
 * Shared middleware for all three publicly exposed servers:
 * - ant-api (ServerConfigurator)
 * - ant-realtime (RealtimeServer)
 * - ant-preview (PreviewServer)
 *
 * Verifies JWT from httpOnly cookie (ant_session) and sets req.user / req.organization.
 * Returns 401 for missing/invalid tokens on non-public paths.
 *
 * Cloud mode is uniformly authenticated — there is no localhost escape
 * hatch. "cloud mode running on localhost" is *not* the same as
 * `ANT_SERVER_MODE=local`; it is the production auth contract being
 * exercised on a developer's machine, so OAuth must complete before any
 * protected request is attempted. The legacy `SKIP_AUTH_FOR_LOCALHOST`
 * env (still found in older `.env` files) is intentionally unused.
 *
 * @see docs/architecture/10-cloud-architecture.md
 */

import { Request, Response, NextFunction } from 'express';
import { JwtService, JwtPayload } from '../../../../infrastructure/auth/JwtService';
import { logger } from '../../../../utils/logger';

export interface JwtAuthMiddlewareOptions {
  jwtService: JwtService;
  /** Paths that skip authentication (e.g. /health, /api/auth/google/callback) */
  publicPaths?: string[];
  /** Path prefixes that skip authentication (e.g. health check paths) */
  publicPrefixes?: string[];
}

/**
 * Create JWT cookie authentication middleware.
 *
 * Reads the `ant_session` cookie, verifies it, and populates req.user and req.organization.
 * Returns 401 for missing/invalid tokens on non-public paths.
 */
export function createJwtAuthMiddleware(options: JwtAuthMiddlewareOptions) {
  const { jwtService, publicPaths = [], publicPrefixes = [] } = options;

  const publicPathSet = new Set(publicPaths);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip auth for public paths
    if (publicPathSet.has(req.path)) {
      return next();
    }

    // Skip auth for public prefixes
    for (const prefix of publicPrefixes) {
      if (req.path.startsWith(prefix)) {
        return next();
      }
    }

    // Extract JWT from cookie or Authorization header (for Ant Desktop)
    const token = (req as any).cookies?.[JwtService.cookieName]
      || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No session cookie found. Please sign in.',
      });
      return;
    }

    try {
      const payload: JwtPayload = jwtService.verify(token);

      // Populate Express request with user context
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
    } catch (error: any) {
      logger.debug(`JWT verification failed: ${error.message}`, { component: 'JwtAuth' });
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired session. Please sign in again.',
      });
    }
  };
}
