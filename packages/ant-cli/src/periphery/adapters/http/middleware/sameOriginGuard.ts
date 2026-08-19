/**
 * Same-origin guard for cookie-authenticated state changes.
 *
 * The session lives in an httpOnly cookie, which the browser attaches to every
 * request to the host — including requests started by a page the platform did not
 * serve. Script running on a *different* origin cannot read the cookie, but it can
 * still make the browser spend it: a plain `POST`/form submission is dispatched
 * with credentials and the server acts on it, whether or not CORS lets the caller
 * read the reply.
 *
 * That matters here because this process also serves user content. A public
 * deploy's built output and a user's own dev server are attacker-authorable
 * documents; separating them onto their own listener (see `PreviewServer`) makes
 * them a different origin, and this guard is what makes "different origin"
 * *mean* something for state-changing calls (H-NEW-001).
 *
 * The verdict uses Fetch Metadata (`Sec-Fetch-Site`), which the browser sets and
 * page script cannot forge, with `Origin` as the fallback for clients that predate
 * it. Requests authenticated by `Authorization: Bearer` (Ant Desktop) are exempt:
 * a bearer token is not ambient, so there is nothing for another origin to spend.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { logger } from '../../../../utils/logger';
import { isAllowedFrontendOrigin } from './corsConfig';

/** Methods that can change state. `GET`/`HEAD`/`OPTIONS` are not gated. */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `Sec-Fetch-Site` values that are always safe:
 *   - `same-origin` — the page and the API share scheme+host+port.
 *   - `none`        — user-initiated (address bar, bookmark), no initiator page.
 *
 * `same-site` is deliberately NOT safe: the content listener and the control
 * plane are the same site (same registrable domain) but different origins, which
 * is exactly the case being closed.
 */
const SAFE_FETCH_SITE = new Set(['same-origin', 'none']);

export interface SameOriginGuardOptions {
  /** Paths exempt from the check (health probes, internal endpoints). */
  publicPaths?: string[];
}

export function createSameOriginGuard(options: SameOriginGuardOptions = {}): RequestHandler {
  const publicPaths = new Set(options.publicPaths ?? ['/health']);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (publicPaths.has(req.path)) return next();

    // Bearer-authenticated callers carry no ambient credential.
    const bearer = req.headers.authorization?.startsWith('Bearer ');
    const hasSessionCookie = Boolean((req as any).cookies?.[JwtService.cookieName]);
    if (bearer || !hasSessionCookie) return next();

    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string') {
      if (SAFE_FETCH_SITE.has(fetchSite)) return next();
      // A cross-origin caller is still legitimate when it is the registered
      // frontend (split-host deployments call the API from the FE origin).
      if (isAllowedFrontendOrigin(req.header('Origin'))) return next();
      return refuse(req, res, `Sec-Fetch-Site: ${fetchSite}`);
    }

    // No Fetch Metadata (older client, non-browser). Fall back to Origin: absent
    // means a non-browser client, which cannot be driven by a hostile page.
    const origin = req.header('Origin');
    if (!origin) return next();
    if (isAllowedFrontendOrigin(origin)) return next();
    if (isSameOrigin(req, origin)) return next();
    return refuse(req, res, `Origin: ${origin}`);
  };
}

/** Exact origin comparison — scheme, host AND port. */
function isSameOrigin(req: Request, origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const host = req.header('X-Forwarded-Host') ?? req.headers.host;
    if (!host) return false;
    const proto = (req.header('X-Forwarded-Proto') ?? req.protocol ?? 'http').split(',')[0].trim();
    return parsed.host === host && parsed.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

function refuse(req: Request, res: Response, reason: string): void {
  logger.warn(
    `[sameOriginGuard] refused ${req.method} ${req.path} (${reason})`,
    { component: 'sameOriginGuard' },
  );
  res.status(403).json({
    error: 'Cross-origin request refused',
    message: 'This endpoint only accepts same-origin requests from the application.',
  });
}

export const __testing = { SAFE_FETCH_SITE, STATE_CHANGING, isSameOrigin };
