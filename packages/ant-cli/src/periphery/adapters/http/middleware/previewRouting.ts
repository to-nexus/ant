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
import { packageSlug, toUrlKey, parseUrlKey } from '../services/PreviewService/utils/serverKeyUtils';
import { toDnsLabel } from '../services/PreviewService/utils/previewLabel';

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

/**
 * Minimal structural view of a preview registry record for label resolution —
 * `PreviewState` (from `listPreviews`) satisfies it.
 */
export interface PreviewLabelPool {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  host?: string;
  port: number; // entry port
  packages?: ReadonlyArray<{ type: string; port: number; slug?: string; urlKey?: string }>;
}

export interface PreviewLabelMatch {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  /** 5th urlKey segment of the matched frontend (multi-frontend); undefined for a 4-part / single-frontend / top-level label. */
  serviceName?: string;
  host: string;
  /** Entry (first frontend) port — the fallback when no per-package serviceName. */
  port: number;
  packages: ReadonlyArray<{ type: string; port: number; slug?: string; urlKey?: string }>;
}

/**
 * Subdomain routing: resolve a Host DNS label to a preview's coordinates by
 * RECOMPUTE-and-MATCH over the active preview set (deterministic label; small
 * set — no extra Redis index). Mirrors `DeployService.resolveDeployLabel`.
 *
 * Returns the matched frontend package's `serviceName` (5-part urlKey) so the
 * caller can route multi-frontend previews per-package via `resolvePreviewTarget`.
 * A 4-part serverKey match (single frontend / top-level label) yields no
 * `serviceName`, so the caller falls back to the entry `port`.
 *
 * SSOT: the single preview label resolver, shared by the HTTP proxy and the WS
 * upgrade handler — symmetric with the single `resolvePreviewTarget` port SSOT.
 */
export function resolvePreviewLabel(
  previews: ReadonlyArray<PreviewLabelPool>,
  label: string,
): PreviewLabelMatch | null {
  for (const st of previews) {
    const serverKey = `${st.tenantId}:${st.userId}:${st.projectId}:${st.feature}`;
    const frontends = (st.packages || []).filter((p) => p.type === 'frontend');
    const matched = frontends.find((p) => toDnsLabel(p.urlKey || toUrlKey(serverKey)) === label);
    const matchesEntry = toDnsLabel(toUrlKey(serverKey)) === label;
    if (matched || matchesEntry) {
      const serviceName = matched
        ? parseUrlKey(matched.urlKey || toUrlKey(serverKey))?.serviceName
        : undefined;
      return {
        tenantId: st.tenantId,
        userId: st.userId,
        projectId: st.projectId,
        feature: st.feature,
        serviceName,
        host: st.host || 'localhost',
        port: st.port,
        packages: st.packages || [],
      };
    }
  }
  return null;
}
