/**
 * `_pending` JWT Guard
 *
 * Layers on top of `createJwtAuthMiddleware`. After JWT verification
 * succeeds, this middleware rejects requests carrying the pre-onboarding
 * sentinel (`org === '_pending'`) on every path EXCEPT the whitelist —
 * the onboarding endpoint itself, `/auth/me`, `/auth/signout`, and the
 * organization search endpoint (used by the onboarding screen's
 * autocomplete) must remain callable so the user can complete the flow.
 *
 * Local mode never sees this middleware (auth is bypassed in
 * `setupAuthentication` when `authService` is undefined). Cloud mode
 * with the legacy code path (no organizationRepository) also never
 * issues `_pending` JWTs, so this middleware is a no-op there.
 */

import { Request, Response, NextFunction } from 'express';

const PENDING_ORG_SENTINEL = '_pending';

export interface RequireOnboardedJwtOptions {
  /**
   * Exact paths that may be hit with a `_pending` JWT. Matched against
   * `req.path` AFTER the parent `app.use('/api', ...)` strips the
   * mount prefix — so callers pass `/auth/onboarding/organization`,
   * not `/api/auth/onboarding/organization`.
   */
  exemptPaths?: string[];
}

const DEFAULT_EXEMPT_PATHS = [
  '/auth/onboarding/organization',
  '/auth/me',
  '/auth/signout',
  '/auth/google',
  '/auth/google/callback',
  '/organizations',
];

export function createRequireOnboardedJwt(options: RequireOnboardedJwtOptions = {}) {
  const exemptPaths = new Set([...DEFAULT_EXEMPT_PATHS, ...(options.exemptPaths ?? [])]);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (exemptPaths.has(req.path)) {
      return next();
    }

    const orgId = (req as any).user?.organizationId ?? (req as any).organization?.id;
    if (orgId === PENDING_ORG_SENTINEL) {
      res.status(401).json({
        error: 'Onboarding required',
        code: 'ONBOARDING_REQUIRED',
        message: 'Complete organization onboarding before accessing this resource.',
      });
      return;
    }

    next();
  };
}
