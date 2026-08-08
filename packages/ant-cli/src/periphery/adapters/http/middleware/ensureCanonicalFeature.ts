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
 * - Feature directory does not exist (`ensureCanonicalStructure` itself bails)
 * - User context cannot be resolved (e.g. unauthenticated cloud request —
 *   the downstream handler will reject with 401/403)
 *
 * Failures are logged and swallowed: backfill is best-effort and must never
 * block a legitimate request.
 */

import type { Request, Response, NextFunction } from 'express';
import { featureSlugToName } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { ensureCanonicalStructure } from '../../../../core/utils/sessionPaths';
import { resolveUniversalContainerPath } from '../../../../core/customAgents/universalContainer';
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

    // Decode once — express route params are already decoded, but req.path is
    // raw. The feature segment on the wire is a `/`-free slug; recover the raw
    // feature name so getFeaturePath (which re-slugifies) sees a name.
    let decodedProjectId: string;
    let decodedFeatureName: string;
    try {
      decodedProjectId = decodeURIComponent(projectId);
      decodedFeatureName = featureSlugToName(decodeURIComponent(featureName));
    } catch {
      return next();
    }

    try {
      const userContext = extractUserContext(req);
      // Universal pseudo-feature: the container has its own layout — never
      // scaffold the canonical feature skeleton onto it.
      const projectPath = workspaceResolver.getProjectPath(userContext, decodedProjectId);
      if (resolveUniversalContainerPath(projectPath, decodedFeatureName)) {
        return next();
      }
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
