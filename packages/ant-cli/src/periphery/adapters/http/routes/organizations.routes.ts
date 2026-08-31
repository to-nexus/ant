/**
 * Organizations API — join discovery
 *
 * `GET /api/organizations?q=<query>&limit=<n>` — substring + case-
 * insensitive search across organization id + display name. Backs the
 * "Join a team" modal: it is how a signed-in account finds a team it can
 * send a join request to. Returns `{ id, name }` projections only —
 * `ownerId` / `createdAt` / member counts are intentionally NOT exposed to
 * avoid leaking org metadata to non-members.
 *
 * Enumeration is opt-in on the org's side: the repository returns only orgs
 * whose `discoverable` flag is set (and never the shared `individual` org or
 * a soft-deleted one). Finding an org grants nothing — membership still
 * requires an admin to approve the request.
 */

import { Router, Request, Response } from 'express';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import { organizationsRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../../../../utils/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 25;
/**
 * Two characters, not one: a single letter is closer to "list the orgs
 * starting with a" than to a search, and the response is a display-only
 * list, so the floor is the cheapest bound on enumeration.
 */
const MIN_QUERY_LENGTH = 2;

export interface OrganizationsRoutesDeps {
  organizationRepository: OrganizationRepositoryPort;
}

export function createOrganizationsRoutes(deps: OrganizationsRoutesDeps): Router {
  const router = Router();
  const { organizationRepository } = deps;

  router.get('/organizations', organizationsRateLimiter, async (req: Request, res: Response) => {
    res.set('Cache-Control', 'private, no-store');

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < MIN_QUERY_LENGTH) {
      return res.json({ organizations: [] });
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    try {
      const organizations = await organizationRepository.searchOrganizations(q, limit);
      res.json({ organizations });
    } catch (error: any) {
      logger.error('[Organizations] search failed', { component: 'Organizations' }, error);
      res.status(500).json({ error: 'Failed to search organizations' });
    }
  });

  return router;
}
