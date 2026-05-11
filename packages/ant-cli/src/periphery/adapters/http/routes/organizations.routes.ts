/**
 * Organizations API
 *
 * `GET /api/organizations?q=<query>&limit=<n>` — substring + case-
 * insensitive search across organization id + display name. Powers the
 * onboarding screen's autocomplete so users can join an existing org
 * by name. Returns `{ id, name }` projections only — `owner_id` /
 * `createdAt` / member counts are intentionally NOT exposed to avoid
 * leaking org metadata to non-members.
 *
 * Whitelisted in `requireOnboardedJwt` because the onboarding screen
 * (which holds a `_pending` JWT) needs to call it.
 */

import { Router, Request, Response } from 'express';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import { organizationsRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../../../../utils/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_QUERY_LENGTH = 1;

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
