/**
 * DeployProxyMiddleware
 *
 * Express middleware mounted at `/deploy/` that routes `/deploy/:urlKey/*`
 * to the per-package static server spawned by DeployService.
 *
 *   4-part urlKey  → single-package deploy. Routes to `state.packages[0]`.
 *                    Back-compat with deploys produced before multi-package
 *                    support — these always have exactly one package.
 *   5-part urlKey  → multi-package deploy. The 5th segment is the package
 *                    slug; routes to `state.packages.find(p => p.slug === slug)`.
 *
 * Header forwarding contract (see `proxyForwarding.ts`):
 *   - All non-hop-by-hop request headers reach the upstream (RSC,
 *     Next-Router-State-Tree, cookies — required for Next.js App Router
 *     soft navigation).
 *   - X-Forwarded-Host / Proto / For / Port are injected.
 *   - POST/PUT/PATCH/DELETE bodies stream upstream (`duplex: 'half'`).
 *   - Set-Cookie `Path` and `Location` headers are rewritten so external
 *     clients see `/deploy/<urlKey>/...` rather than bare `/...`.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../../../utils/logger';
import {
  isUrlKey,
  parseUrlKey,
  packageSlug,
} from '../services/PreviewService/utils/serverKeyUtils';
import type { DeployState } from '../../../../core/ports/portRegistry';
import {
  buildCleanHeaders,
  escapeRegExp,
  extractForwardingContext,
  forwardRequestBody,
  streamUpstreamResponse,
} from './proxyForwarding';

export interface DeployProxyDeps {
  /**
   * Rehydrate or look up the running state for a deploy. Returns null when
   * the deploy is truly unavailable (no meta, all artifacts missing, ports
   * exhausted).
   */
  ensureRunning(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): Promise<DeployState | null>;

  /**
   * Touch lastAccessedAt for idle-eviction bookkeeping. Best effort.
   */
  touchDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): Promise<void>;

  /**
   * Update phase / error on the deploy record. Best effort.
   */
  updateDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    patch: { phase?: string; error?: string },
  ): Promise<void>;

  /**
   * Notify subscribers (UI) that a deploy's phase changed. Best effort.
   */
  broadcastStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    status: { phase: string; error?: string },
  ): Promise<void>;
}

export function createDeployProxyMiddleware(deps: DeployProxyDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const pathAfterDeploy = req.path; // Already has /deploy/ stripped by app.use('/deploy/', ...)
    const segments = pathAfterDeploy.split('/').filter(Boolean);
    const urlKey = segments[0];

    if (!urlKey || !isUrlKey(urlKey)) {
      return next();
    }

    const parsed = parseUrlKey(urlKey);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid deploy key format' });
      return;
    }

    const { tenantId, userId, projectId, feature, serviceName } = parsed;

    // Lazy re-hydration: if the static servers are dead (pod restart, idle
    // eviction, crash), DeployService will re-spawn ALL of them from
    // meta.json. Returns null when the deploy is truly unavailable.
    const deployState = await deps.ensureRunning(tenantId, userId, projectId, feature);
    if (!deployState) {
      res.status(404).json({ error: 'Deploy unavailable' });
      return;
    }

    // Resolve which deploy package this URL belongs to.
    const resolvePackagePort = (state: NonNullable<typeof deployState>): number | null => {
      const pkgs = state.packages || [];
      if (pkgs.length === 0) return null;
      if (serviceName) {
        // 5-part urlKey: exact slug match (input normalized for BC).
        const wantedSlug = packageSlug(serviceName);
        const match = pkgs.find((p) => p.slug === wantedSlug);
        return match?.port ?? null;
      }
      // 4-part urlKey: only valid for single-package deploys. Multi-package
      // static servers each have a 5-part `basePath`, so a 4-part request
      // would silently 404 at the upstream — return null here instead so
      // the proxy renders a clear "not found" with a stable error shape.
      if (pkgs.length > 1) {
        logger.warn(
          `[Deploy] 4-part urlKey '${urlKey}' rejected for multi-package deploy — caller must use 5-part`,
          { component: 'DeployProxy' },
        );
        return null;
      }
      return pkgs[0]?.port ?? null;
    };

    const tryProxy = async (state: NonNullable<typeof deployState>): Promise<void> => {
      const targetPort = resolvePackagePort(state);
      if (!targetPort) {
        res.status(404).json({ error: 'Deploy package not found' });
        return;
      }
      const targetHost = state.host || 'localhost';
      // Static server's basePath = `/deploy/${urlKey}`, so we re-prepend
      // `/deploy/<urlKey>` to req.url (which had `/deploy/` stripped by the
      // Express mount).
      const basePath = `/deploy/${urlKey}`;
      const targetPath = `${basePath}${req.url.replace(new RegExp(`^/${escapeRegExp(urlKey)}`), '') || '/'}`;
      const targetUrl = `http://${targetHost}:${targetPort}${targetPath}`;
      const upstreamHost = `${targetHost}:${targetPort}`;

      const headers = buildCleanHeaders(req, targetHost, targetPort, extractForwardingContext(req));
      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        ...forwardRequestBody(req),
      } as RequestInit);

      await streamUpstreamResponse(response, res, { basePath, upstreamHost });

      deps.touchDeploy(tenantId, userId, projectId, feature).catch(() => {
        /* best-effort */
      });
    };

    try {
      await tryProxy(deployState);
    } catch (error: any) {
      logger.warn(`[Deploy] Proxy error: ${error.message}`, { component: 'DeployProxy' });

      // Host/port stale (e.g. another pod's entry) — mark hibernated and
      // attempt a single rehydrate retry on this pod.
      try {
        await deps.updateDeploy(tenantId, userId, projectId, feature, { phase: 'hibernated' });
      } catch {
        /* ignore */
      }

      try {
        const retry = await deps.ensureRunning(tenantId, userId, projectId, feature);
        if (retry) {
          try {
            await tryProxy(retry);
            return;
          } catch (retryErr: any) {
            logger.warn(`[Deploy] Proxy retry failed: ${retryErr.message}`, {
              component: 'DeployProxy',
            });
          }
        }
      } catch {
        /* ignore */
      }

      await deps
        .updateDeploy(tenantId, userId, projectId, feature, {
          phase: 'unavailable',
          error: error.message,
        })
        .catch(() => {
          /* best-effort */
        });
      await deps.broadcastStatus(tenantId, userId, projectId, feature, {
        phase: 'unavailable',
        error: error.message,
      });
      logger.warn(`[Deploy] Marked unavailable: ${urlKey}`, { component: 'DeployProxy' });

      res.status(502).json({ error: 'Deploy server unreachable' });
    }
  };
}
