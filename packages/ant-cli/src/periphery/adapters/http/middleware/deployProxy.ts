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
} from '../services/PreviewService/utils/serverKeyUtils';
import type { DeployState } from '../../../../core/ports/portRegistry';
import {
  buildCleanHeaders,
  escapeRegExp,
  extractForwardingContext,
  fetchWithTransportRetry,
  forwardRequestAbort,
  forwardRequestBody,
  parseCookieHeader,
  streamUpstreamResponse,
} from './proxyForwarding';
import { resolveDeployTarget } from './deployRouting';

/**
 * Minimal JWT-verify surface the gate needs. `undefined` in local mode
 * (single tenant) → private deploys are owner-accessible by definition.
 */
export interface DeployProxyJwtService {
  verify(token: string): { org: string; sub: string };
  cookieName?: string;
}

/**
 * Decide whether a request may access a private deploy. The owner is the
 * `(tenantId, userId)` baked into the urlKey; authorization requires a valid
 * session cookie whose `org`/`sub` match. Local mode (no jwtService) is
 * always authorized. Any failure returns `false` → caller emits a 404
 * identical to the genuine-not-found response (no existence leak).
 *
 * Team extension point: replace the `payload.sub === userId` check with a
 * team-membership lookup when team orgs ship.
 */
export function isAuthorizedForPrivateDeploy(
  req: Request,
  jwtService: DeployProxyJwtService | undefined,
  cookieName: string,
  tenantId: string,
  userId: string,
): boolean {
  if (!jwtService) return true; // local mode: single tenant, owner-accessible
  const token = parseCookieHeader(req.headers.cookie)[cookieName];
  if (!token) return false;
  try {
    const payload = jwtService.verify(token);
    return payload.org === tenantId && payload.sub === userId;
  } catch {
    return false;
  }
}

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

  /**
   * JWT verifier for the private-deploy access gate. `undefined` in local
   * mode → private deploys are always owner-accessible.
   */
  jwtService?: DeployProxyJwtService;
  /** Session cookie name (e.g. `JwtService.cookieName`). */
  cookieName?: string;
}

export function createDeployProxyMiddleware(deps: DeployProxyDeps) {
  const cookieName = deps.cookieName ?? 'ant_session';
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

    // Private-deploy access gate. On any failure return a 404 IDENTICAL to the
    // genuine-not-found response above — never 403 — so a private deploy's
    // existence is not leaked.
    if (
      deployState.visibility === 'private' &&
      !isAuthorizedForPrivateDeploy(req, deps.jwtService, cookieName, tenantId, userId)
    ) {
      res.status(404).json({ error: 'Deploy unavailable' });
      return;
    }

    const tryProxy = async (state: NonNullable<typeof deployState>): Promise<void> => {
      const target = resolveDeployTarget(state, serviceName, urlKey);
      if (!target) {
        res.status(404).json({ error: 'Deploy package not found' });
        return;
      }
      const { targetHost, targetPort } = target;
      // Static server's basePath = `/deploy/${urlKey}`, so we re-prepend
      // `/deploy/<urlKey>` to req.url (which had `/deploy/` stripped by the
      // Express mount).
      const basePath = `/deploy/${urlKey}`;
      const targetPath = `${basePath}${req.url.replace(new RegExp(`^/${escapeRegExp(urlKey)}`), '') || '/'}`;
      const targetUrl = `http://${targetHost}:${targetPort}${targetPath}`;
      const upstreamHost = `${targetHost}:${targetPort}`;

      const headers = buildCleanHeaders(req, targetHost, targetPort, extractForwardingContext(req));
      // Transient transport errors (spawn race, brief socket reset) are
      // absorbed here. Only after all retry attempts fail does control fall
      // through to the outer catch's rehydrate path.
      const response = await fetchWithTransportRetry(targetUrl, {
        method: req.method,
        headers,
        ...forwardRequestBody(req),
        ...forwardRequestAbort(req),
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
