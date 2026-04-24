/**
 * Canonical feature structure access-time backfill middleware.
 *
 * SSOT access-boundary self-heal: any HTTP request whose URL references a
 * feature (either `/projects/:id/features/:feature/*` or
 * `/api/figma/config/:projectId/:featureName/*`) gets `ensureCanonicalStructure`
 * called on the resolved feature path BEFORE the route handler runs. If the
 * canonical structure is partially present, this idempotently recreates any
 * missing canonical directories/files.
 *
 * Skipped when:
 * - URL does not match a feature-scoped pattern
 * - `featureName` is the reserved `_base` (project-root pseudo-feature)
 * - Feature directory does not exist (`ensureCanonicalStructure` itself bails)
 * - User context cannot be resolved (e.g. unauthenticated cloud request —
 *   the downstream handler will reject with 401/403)
 *
 * Failures are logged and swallowed: backfill is best-effort and must never
 * block a legitimate request.
 */

import type { Request, Response, NextFunction } from 'express';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { ensureCanonicalStructure } from '../../../../core/utils/sessionPaths';
import { RESERVED_FEATURE_NAME } from '../../../../core/utils/branchUtils';
import { extractUserContext } from '../routes/helpers/userContext';
import { logger } from '../../../../utils/logger';

/**
 * URL pattern matchers for feature-scoped endpoints.
 *
 * Order matters: /api/figma/config/:projectId/:featureName must be checked
 * BEFORE the generic /projects/:id/features/:feature/* pattern (they don't
 * overlap, but keeping the explicit check first makes the intent clear).
 */
const FEATURE_URL_PATTERNS: ReadonlyArray<{ regex: RegExp; source: string }> = [
  { regex: /^\/(?:api\/)?figma\/config\/([^/?#]+)\/([^/?#]+)/, source: 'figma' },
  { regex: /^\/(?:api\/)?projects\/([^/?#]+)\/features\/([^/?#]+)/, source: 'project-feature' },
];

interface MatchedFeature {
  projectId: string;
  featureName: string;
  source: string;
}

function matchFeatureUrl(pathname: string): MatchedFeature | null {
  for (const { regex, source } of FEATURE_URL_PATTERNS) {
    const match = regex.exec(pathname);
    if (match) {
      const [, projectId, featureName] = match;
      return { projectId, featureName, source };
    }
  }
  return null;
}

export function ensureCanonicalFeatureMiddleware(workspaceResolver: WorkspaceResolver) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const matched = matchFeatureUrl(req.path);
    if (!matched) {
      return next();
    }
    const { projectId, featureName, source } = matched;

    // Reserved pseudo-feature — no canonical layout applies.
    if (featureName === RESERVED_FEATURE_NAME) {
      return next();
    }

    // Decode once — express route params are already decoded, but req.path is raw.
    let decodedProjectId: string;
    let decodedFeatureName: string;
    try {
      decodedProjectId = decodeURIComponent(projectId);
      decodedFeatureName = decodeURIComponent(featureName);
    } catch {
      return next();
    }

    try {
      const userContext = extractUserContext(req);
      const featurePath = workspaceResolver.getFeaturePath(
        userContext,
        decodedProjectId,
        decodedFeatureName,
      );
      await ensureCanonicalStructure(featurePath);
    } catch (err: any) {
      // Best-effort: never block the request. The downstream handler will
      // surface any auth/permission errors through its own response path.
      logger.warn('[ensureCanonicalFeatureMiddleware] skipped', {
        component: 'ensureCanonicalFeatureMiddleware',
        projectId: decodedProjectId,
        featureName: decodedFeatureName,
      }, { source, error: err?.message ?? String(err) });
    }

    next();
  };
}
