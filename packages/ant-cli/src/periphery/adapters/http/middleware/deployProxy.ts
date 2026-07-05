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
import { extractLabelFromHost } from '../services/PreviewService/utils/previewLabel';
import { isSubdomainRouting, getDeployBaseDomain } from '../../../../core/config/previewRouting';
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
import { assertProxyOwnership } from './proxyOwnership';

/**
 * Rewrite the `/_next/image` optimizer `url` param to include the deploy
 * basePath — parity with the preview proxy's `rewriteNextImagePath`.
 *
 * A Next.js app built with basePath `/deploy/<urlKey>` emits optimizer URLs
 * as `/deploy/<urlKey>/_next/image?url=%2Fimages%2Fx` — the endpoint carries
 * the basePath but the `url` param stays the authored root-absolute `/images/x`
 * (next/image never prefixes the src). The optimizer resolves that param with
 * `new URL(url, origin)`, ignoring basePath, so it fetches `/images/x` while
 * `public/` is served at `/deploy/<urlKey>/images/x` → 404 → optimizer 400.
 * Prepending the basePath to the param makes the internal fetch resolve.
 * Idempotent: skips params already carrying the prefix.
 */
export function rewriteNextImagePath(path: string, basePathPrefix: string): string {
  if (!path.includes('/_next/image')) return path;
  try {
    const urlObj = new URL(`http://localhost${path}`);
    const imageUrl = urlObj.searchParams.get('url');
    if (!imageUrl || imageUrl.startsWith(basePathPrefix)) return path;
    urlObj.searchParams.set('url', `${basePathPrefix}${imageUrl}`);
    return urlObj.pathname + urlObj.search;
  } catch {
    return path;
  }
}

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
    return assertProxyOwnership(jwtService.verify(token), { tenantId, userId });
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
  /**
   * Subdomain routing only: resolve a Host DNS label to a deploy's coordinates
   * (+ optional serviceName for multi-package). Provided by DeployService.
   * Absent → subdomain deploy routing is unavailable and requests fall through.
   */
  resolveLabel?(label: string): Promise<{
    tenantId: string;
    userId: string;
    projectId: string;
    feature: string;
    serviceName?: string;
  } | null>;
}

export function createDeployProxyMiddleware(deps: DeployProxyDeps) {
  const cookieName = deps.cookieName ?? 'ant_session';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── Subdomain routing (Phase 2) ──
    // Deploy apps live at their own `{label}.<deployBaseDomain>` host root. The
    // Host label is resolved to a deploy via DeployService.resolveLabel; the app
    // is served at root (verbatim path, no `/deploy/{urlKey}` prefix, no image
    // rewrite). Hosts not under the deploy base domain fall through so the
    // preview proxy (also root-mounted in this mode) can handle them.
    if (isSubdomainRouting()) {
      const label = extractLabelFromHost(req.headers.host, getDeployBaseDomain());
      if (!label || !deps.resolveLabel) return next();
      const coords = await deps.resolveLabel(label);
      if (!coords) return next();
      const { tenantId, userId, projectId, feature, serviceName } = coords;

      const deployState = await deps.ensureRunning(tenantId, userId, projectId, feature);
      if (!deployState) {
        res.status(404).json({ error: 'Deploy unavailable' });
        return;
      }
      if (
        deployState.visibility === 'private' &&
        !isAuthorizedForPrivateDeploy(req, deps.jwtService, cookieName, tenantId, userId)
      ) {
        res.status(404).json({ error: 'Deploy unavailable' });
        return;
      }

      const target = resolveDeployTarget(deployState, serviceName, '');
      if (!target) {
        res.status(404).json({ error: 'Deploy package not found' });
        return;
      }
      const { targetHost, targetPort } = target;
      const targetUrl = `http://${targetHost}:${targetPort}${req.url}`; // verbatim — root served
      try {
        const headers = buildCleanHeaders(req, targetHost, targetPort, extractForwardingContext(req));
        const response = await fetchWithTransportRetry(targetUrl, {
          method: req.method,
          headers,
          ...forwardRequestBody(req),
          ...forwardRequestAbort(req),
        } as RequestInit);
        await streamUpstreamResponse(response, res, { upstreamHost: `${targetHost}:${targetPort}` });
        deps.touchDeploy(tenantId, userId, projectId, feature).catch(() => { /* best-effort */ });
      } catch (error: any) {
        logger.warn(`[Deploy] Subdomain proxy error: ${error.message}`, { component: 'DeployProxy' });
        res.status(502).json({ error: 'Deploy server unreachable' });
      }
      return;
    }

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
      const { targetHost, targetPort, isProcess } = target;
      // req.url had `/deploy/` stripped by the Express mount; strip the urlKey
      // segment too to get the bare app path.
      const barePath = req.url.replace(new RegExp(`^/${escapeRegExp(urlKey)}`), '') || '/';
      // Keep-vs-strip — identical rule to the preview proxy:
      //   static (frontend): bundle is built with base path `/deploy/{urlKey}`,
      //     so re-prepend it + rewrite Set-Cookie/Location against it.
      //   process (backend): routes live at root, no prefix baked in → forward
      //     the bare path with no basePath so headers pass through verbatim.
      const basePath = isProcess ? undefined : `/deploy/${urlKey}`;
      // Static (frontend): re-prepend the deploy basePath, then fix the
      // `/_next/image` optimizer `url` param so it resolves against public/
      // under the basePath (parity with the preview proxy). Process (backend):
      // routes live at root, no rewrite.
      const targetPath = isProcess
        ? barePath
        : rewriteNextImagePath(`/deploy/${urlKey}${barePath}`, `/deploy/${urlKey}`);
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
