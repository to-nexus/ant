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
  type PlatformCredentialFilter,
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

/**
 * Gate a deploy request BEFORE any side effect (M-NEW-023). Reads visibility
 * side-effect-free (never rehydrates); a private deploy requires the owner's
 * cookie. Returns true when the request may proceed to `ensureRunning` — a
 * public deploy always may (its lazy start is intended), a private one only for
 * its owner, so an unauthorized caller can never trigger a private deploy's
 * rehydration. Falls back to allow when no side-effect-free reader is wired: the
 * post-ensureRunning gate below is then still the authority (old order).
 */
async function mayAccessDeploy(
  req: Request,
  deps: DeployProxyDeps,
  coords: { tenantId: string; userId: string; projectId: string; feature: string },
  cookieName: string,
): Promise<boolean> {
  if (!deps.getVisibility) return true; // no side-effect-free read → defer to the post-hydrate gate
  let visibility: string | undefined;
  try {
    visibility = await deps.getVisibility(coords.tenantId, coords.userId, coords.projectId, coords.feature);
  } catch {
    visibility = 'private'; // fail closed on a read error
  }
  if (visibility !== 'private') return true;
  return isAuthorizedForPrivateDeploy(req, deps.jwtService, cookieName, coords.tenantId, coords.userId);
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
   * Side-effect-free visibility read: returns the deploy's visibility WITHOUT
   * rehydrating it (never spawns), so a private deploy's ownership can be
   * checked before `ensureRunning` is ever called (M-NEW-023). Provided by
   * DeployService.getStatus. Absent → the proxy falls back to reading
   * visibility off the (rehydrated) state, preserving the old order.
   */
  getVisibility?(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
  ): Promise<string | undefined>;

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
  /**
   * Custom-domain routing (deploy-only): resolve a user-owned Host to a
   * deploy's coordinates. Tried when the Host is NOT under the deploy base
   * domain (i.e. `extractLabelFromHost` yields no label). Provided by
   * DeployService. Absent → custom-domain routing unavailable; requests fall
   * through. Preview is intentionally NOT covered (deploy-only feature).
   */
  resolveCustomDomain?(host: string): Promise<{
    tenantId: string;
    userId: string;
    projectId: string;
    feature: string;
    serviceName?: string;
  } | null>;
}

/** Deploy coordinates a proxy request resolves to. */
interface DeployCoords {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
}

/**
 * Proxy a deploy request with self-heal, shared by the subdomain (root-served)
 * and path (`/deploy/<urlKey>`) branches so both recover identically.
 *
 * `proxyOnce(state)` performs the branch-specific target resolve + fetch +
 * stream and THROWS on a transport failure (dead/stale host:port). On failure
 * we flip the record to `hibernated` — which makes the next `ensureRunning`
 * re-spawn the deploy on THIS pod instead of returning the stale cross-pod
 * record — then retry once. Only after the retry fails is the deploy marked
 * unavailable and a 502 returned. A response already committed to the wire
 * (headers sent) cannot be retried, so we bail without a second attempt.
 */
async function serveDeployWithSelfHeal(
  deps: DeployProxyDeps,
  coords: DeployCoords,
  initialState: DeployState,
  res: Response,
  proxyOnce: (state: DeployState) => Promise<void>,
): Promise<void> {
  const { tenantId, userId, projectId, feature } = coords;
  try {
    await proxyOnce(initialState);
    deps.touchDeploy(tenantId, userId, projectId, feature).catch(() => { /* best-effort */ });
    return;
  } catch (error: any) {
    logger.warn(`[Deploy] Proxy error: ${error.message}`, { component: 'DeployProxy' });
    if (res.headersSent) {
      // Response already streaming — cannot recover or re-send status.
      res.end();
      return;
    }

    // Host/port stale (rolled/crashed pod). Mark hibernated so ensureRunning
    // re-spawns on this pod, then attempt a single rehydrate retry.
    try {
      await deps.updateDeploy(tenantId, userId, projectId, feature, { phase: 'hibernated' });
    } catch { /* ignore */ }

    try {
      const retry = await deps.ensureRunning(tenantId, userId, projectId, feature);
      if (retry) {
        try {
          await proxyOnce(retry);
          deps.touchDeploy(tenantId, userId, projectId, feature).catch(() => { /* best-effort */ });
          return;
        } catch (retryErr: any) {
          logger.warn(`[Deploy] Proxy retry failed: ${retryErr.message}`, { component: 'DeployProxy' });
        }
      }
    } catch { /* ignore */ }

    await deps
      .updateDeploy(tenantId, userId, projectId, feature, { phase: 'unavailable', error: error.message })
      .catch(() => { /* best-effort */ });
    await deps.broadcastStatus(tenantId, userId, projectId, feature, {
      phase: 'unavailable',
      error: error.message,
    });
    if (!res.headersSent) res.status(502).json({ error: 'Deploy server unreachable' });
  }
}

export function createDeployProxyMiddleware(deps: DeployProxyDeps) {
  const cookieName = deps.cookieName ?? 'ant_session';
  // The upstream serves the user's own built application — the caller's
  // platform session must not travel to it. App-owned cookies / bearer tokens
  // are preserved (see PlatformCredentialFilter).
  const platformCredentials: PlatformCredentialFilter = {
    cookieName,
    isPlatformToken: deps.jwtService
      ? (token: string) => { try { deps.jwtService!.verify(token); return true; } catch { return false; } }
      : undefined,
  };
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── Subdomain routing (Phase 2) ──
    // Deploy apps live at their own `{label}.<deployBaseDomain>` host root. The
    // Host label is resolved to a deploy via DeployService.resolveLabel; the app
    // is served at root (verbatim path, no `/deploy/{urlKey}` prefix, no image
    // rewrite). Hosts not under the deploy base domain fall through so the
    // preview proxy (also root-mounted in this mode) can handle them.
    if (isSubdomainRouting()) {
      // 1) Platform subdomain (`{label}.<deployBaseDomain>`, via ALB): resolve
      //    the DNS label to a deploy. Uses the externally-visible host
      //    (X-Forwarded-Host first, then Host) — mirrors previewProxy, where a
      //    peer-forwarded/ingress-rewritten Host no longer carries the label.
      const externalHost = extractForwardingContext(req).externalHost;
      const label = extractLabelFromHost(externalHost, getDeployBaseDomain());
      let coords = label && deps.resolveLabel ? await deps.resolveLabel(label) : null;
      // 2) Custom domain (user-owned host, via NLB+Caddy → X-Forwarded-Host):
      //    the host is NOT under the deploy base domain, so no label was found.
      //    Look it up in the custom-domain registry (active-only). Deploy-only.
      if (!coords && deps.resolveCustomDomain) {
        coords = await deps.resolveCustomDomain(externalHost || '');
      }
      if (!coords) return next();
      const { tenantId, userId, projectId, feature, serviceName } = coords;

      // Owner/visibility BEFORE ensureRunning: an unauthorized caller must not
      // rehydrate a private deploy (M-NEW-023). Public deploys still lazy-start.
      if (!(await mayAccessDeploy(req, deps, { tenantId, userId, projectId, feature }, cookieName))) {
        res.status(404).json({ error: 'Deploy unavailable' });
        return;
      }

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

      // Root-served: forward the path verbatim (no basePath). Self-heal on a
      // stale/dead target — identical recovery to the path branch below.
      await serveDeployWithSelfHeal(
        deps,
        { tenantId, userId, projectId, feature },
        deployState,
        res,
        async (state) => {
          const target = resolveDeployTarget(state, serviceName, '');
          if (!target) {
            if (!res.headersSent) res.status(404).json({ error: 'Deploy package not found' });
            return;
          }
          const { targetHost, targetPort } = target;
          const targetUrl = `http://${targetHost}:${targetPort}${req.url}`; // verbatim — root served
          const headers = buildCleanHeaders(req, targetHost, targetPort, extractForwardingContext(req), platformCredentials);
          const response = await fetchWithTransportRetry(targetUrl, {
            method: req.method,
            headers,
            ...forwardRequestBody(req),
            ...forwardRequestAbort(req),
          } as RequestInit);
          await streamUpstreamResponse(response, res, { upstreamHost: `${targetHost}:${targetPort}` });
        },
      );
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

    // Owner/visibility BEFORE ensureRunning: an unauthorized caller with a known
    // private-deploy urlKey must not force its rehydration (M-NEW-023). Public
    // deploys keep their lazy start.
    if (!(await mayAccessDeploy(req, deps, { tenantId, userId, projectId, feature }, cookieName))) {
      res.status(404).json({ error: 'Deploy unavailable' });
      return;
    }

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

    // Path-served: re-prepend the `/deploy/<urlKey>` basePath. Self-heal on a
    // stale/dead target — identical recovery to the subdomain branch above.
    await serveDeployWithSelfHeal(
      deps,
      { tenantId, userId, projectId, feature },
      deployState,
      res,
      async (state) => {
        const target = resolveDeployTarget(state, serviceName, urlKey);
        if (!target) {
          if (!res.headersSent) res.status(404).json({ error: 'Deploy package not found' });
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

        const headers = buildCleanHeaders(req, targetHost, targetPort, extractForwardingContext(req), platformCredentials);
        // Transient transport errors (spawn race, brief socket reset) are
        // absorbed by fetchWithTransportRetry. A persistently dead target throws
        // out to serveDeployWithSelfHeal's rehydrate path.
        const response = await fetchWithTransportRetry(targetUrl, {
          method: req.method,
          headers,
          ...forwardRequestBody(req),
          ...forwardRequestAbort(req),
        } as RequestInit);

        await streamUpstreamResponse(response, res, { basePath, upstreamHost });
      },
    );
  };
}
