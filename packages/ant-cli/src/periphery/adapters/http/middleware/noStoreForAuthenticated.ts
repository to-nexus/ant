/**
 * Cache-Control owner for authenticated responses.
 *
 * An authenticated response is per-identity by construction, so no shared cache
 * may hold it. That was true before this middleware existed too — it was just
 * spelled as three hand-placed `res.set('Cache-Control', 'private, no-store')`
 * calls (organization search and two auth reads). Every other authenticated
 * route answered with NO cache directive at all, and in a CDN-fronted
 * deployment the admin dashboard was the one that paid: an operator approved or
 * purged an account, the client refetched exactly as it should, and the edge
 * served the pre-mutation body back. The screen looked frozen while the write
 * had in fact landed.
 *
 * A per-route header list is the same shape as the route lists this codebase
 * has retired elsewhere: it grows by whatever the next author remembers, and
 * `/admin` is what the last author forgot. So this enumerates the SET —
 * "did this request carry an identity" — and the exemption for public paths is
 * DERIVED from `req.user`, which `createJwtAuthMiddleware` sets only on the
 * non-public branch. A second copy of `PUBLIC_PATHS` here would drift.
 *
 * Headers are written on the way IN, so a handler with a stronger opinion still
 * wins by writing its own (SSE's `no-cache`, the IDE stub's immutable assets).
 */

import { Request, Response, NextFunction } from 'express';

export function createNoStoreForAuthenticated() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.id) {
      res.set('Cache-Control', 'private, no-store');
      // Belt and braces for an intermediary that honours Vary but not no-store:
      // the credential is what makes two responses to one URL differ.
      res.vary('Cookie');
      res.vary('Authorization');
    }
    next();
  };
}
