/**
 * Preview routing SSOT.
 *
 * Resolves a 5-part preview urlKey (`org--user--project--feature--serviceSlug`)
 * to the upstream dev server (host:port) for the package the URL targets, by
 * matching `packages[].slug`. Used by BOTH the HTTP middleware (previewProxy.ts)
 * and the WebSocket upgrade handler (PreviewServer.ts) so the per-package
 * decision can never drift between the two paths.
 *
 * Parallel to `deployRouting.ts#resolveDeployTarget`. Preview differs from
 * deploy in two ways, so this helper is deliberately narrower:
 *   - `PreviewPackage.slug` is OPTIONAL (stale records from older builds lack
 *     it), so an unmatched slug is expected and returns null (entry fallback).
 *   - The caller owns the entry-frontend / backend-only / `/api/*` fallbacks
 *     (the HTTP middleware has a richer precedence chain than deploy). This
 *     helper resolves ONLY the slug-matched case and returns null otherwise.
 */

import { logger } from '../../../../utils/logger';
import { packageSlug } from '../services/PreviewService/utils/serverKeyUtils';

export interface PreviewTarget {
  targetHost: string;
  targetPort: number;
  /** Whether the matched package is a frontend (caller keeps the urlKey prefix). */
  isFrontend: boolean;
}

/**
 * Minimal structural view of a preview registry record — the only fields this
 * router reads. `PreviewState` (WS handler) and the HTTP middleware's hoisted
 * locals both satisfy it, so neither caller has to materialize a full record.
 */
export interface PreviewRoutingPool {
  host?: string;
  packages?: ReadonlyArray<{ slug?: string; type: string; port: number }>;
}

/**
 * Match a 5-part preview urlKey's service segment to a package port.
 *
 * Returns a target ONLY when `serviceName` is present AND a package with the
 * corresponding slug exists. For a 4-part urlKey (no `serviceName`), an
 * unmatched slug, or a stale record lacking `slug`, returns null so the caller
 * falls back to the entry frontend (`mapping.port`).
 *
 * `urlKey` is accepted purely for logging context.
 */
export function resolvePreviewTarget(
  mapping: PreviewRoutingPool,
  serviceName: string | undefined,
  urlKey: string,
): PreviewTarget | null {
  if (!serviceName) return null;

  const wantedSlug = packageSlug(serviceName);
  const pkg = (mapping.packages || []).find((p) => p.slug === wantedSlug);
  if (!pkg) {
    logger.warn(
      `[Preview] Service '${serviceName}' not found in packages for '${urlKey}', falling back to entry`,
      { component: 'PreviewRouting' },
    );
    return null;
  }

  return {
    targetHost: mapping.host || 'localhost',
    targetPort: pkg.port,
    isFrontend: pkg.type === 'frontend',
  };
}
