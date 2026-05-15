/**
 * Deploy routing SSOT.
 *
 * Resolves a deploy request to the upstream static server (host:port) for the
 * package the URL targets. Used by both the HTTP middleware (deployProxy.ts)
 * and the WebSocket upgrade handler (PreviewServer.ts) so that the two paths
 * share one routing decision.
 */

import { logger } from '../../../../utils/logger';
import { packageSlug } from '../services/PreviewService/utils/serverKeyUtils';
import type { DeployState } from '../../../../core/ports/portRegistry';

export interface DeployTarget {
  targetHost: string;
  targetPort: number;
}

/**
 * Pick the upstream static-server host:port for a parsed deploy URL.
 *
 *   5-part urlKey → match `packages[].slug` against `packageSlug(serviceName)`.
 *   4-part urlKey → only valid for single-package deploys. Multi-package deploys
 *                   serve each package on a 5-part basePath, so a 4-part request
 *                   would silently 404 at the upstream — return null instead.
 *
 * `urlKey` is accepted purely for logging context.
 */
export function resolveDeployTarget(
  state: DeployState,
  serviceName: string | undefined,
  urlKey: string,
): DeployTarget | null {
  const pkgs = state.packages || [];
  if (pkgs.length === 0) return null;

  let port: number | null = null;
  if (serviceName) {
    const wantedSlug = packageSlug(serviceName);
    port = pkgs.find((p) => p.slug === wantedSlug)?.port ?? null;
  } else if (pkgs.length === 1) {
    port = pkgs[0].port;
  } else {
    logger.warn(
      `[Deploy] 4-part urlKey '${urlKey}' rejected for multi-package deploy — caller must use 5-part`,
      { component: 'DeployRouting' },
    );
    return null;
  }

  if (port == null) return null;

  return {
    targetHost: state.host || 'localhost',
    targetPort: port,
  };
}
