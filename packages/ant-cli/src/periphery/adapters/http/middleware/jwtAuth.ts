/**
 * JWT Cookie Authentication Middleware
 *
 * Shared middleware for all three publicly exposed servers:
 * - ant-api (ServerConfigurator)
 * - ant-realtime (RealtimeServer)
 * - ant-preview (PreviewServer)
 *
 * Verifies JWT from httpOnly cookie (ant_session) and sets req.user /
 * req.organization. Returns 401 for missing/invalid tokens on non-public
 * paths. Cloud mode is uniformly authenticated — "cloud mode running on
 * localhost" still requires OAuth completion before any protected request.
 *
 * @see docs/internals/02-infrastructure.md
 */

import { Request, Response, NextFunction } from 'express';
import { JwtService, JwtPayload } from '../../../../infrastructure/auth/JwtService';
import { logger } from '../../../../utils/logger';
import { deriveKindFromOrgId } from '@ant/shared';

/**
 * A public-path exemption. A bare string exempts the path for ANY method
 * (legacy). An object restricts the exemption to the listed methods — a
 * mismatched method (e.g. `POST /health`) is NOT exempt and must authenticate,
 * so it cannot slip past the JWT gate to the body parser behind it (M-010).
 */
export type PublicPathSpec = string | { path: string; methods: readonly string[] };

export interface JwtAuthMiddlewareOptions {
  jwtService: JwtService;
  /** Paths that skip authentication (e.g. /health, /api/auth/google/callback) */
  publicPaths?: PublicPathSpec[];
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

  // path → set of exempt methods, or null for "any method" (legacy string form).
  const publicPathMethods = new Map<string, Set<string> | null>();
  for (const spec of publicPaths) {
    if (typeof spec === 'string') {
      publicPathMethods.set(spec, null);
    } else {
      publicPathMethods.set(spec.path, new Set(spec.methods.map((m) => m.toUpperCase())));
    }
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip auth for public paths — method-aware: an entry restricted to GET does
    // not exempt a POST to the same path (which would otherwise reach the body
    // parser mounted behind this gate unauthenticated — M-010).
    if (publicPathMethods.has(req.path)) {
      const methods = publicPathMethods.get(req.path);
      if (!methods || methods.has(req.method.toUpperCase())) {
        return next();
      }
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
        kind: payload.kind ?? deriveKindFromOrgId(payload.org),
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
