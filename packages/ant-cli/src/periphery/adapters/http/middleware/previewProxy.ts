/**
 * PreviewProxyMiddleware
 * 
 * Express middleware to proxy preview requests on a dedicated host (ant-preview.example.com).
 * Dynamically routes /:urlKey/* to the appropriate dev server port.
 * 
 * All frameworks (Vite, Next.js, etc.) use native base path configuration,
 * so the proxy always keeps the URL key prefix and streams responses without
 * any HTML rewriting or script injection.
 * 
 * URL key format: "org--user--project--feature" (double-dash separated, URL-safe)
 * Internal key:   "org:user:project:feature" (colon separated, Redis)
 * 
 * Example:
 * /to.nexus--probe--todo-app--feature-login → localhost:30001/to.nexus--probe--todo-app--feature-login
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { Readable } from 'stream';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';
import { fromUrlKey, isUrlKey, parseUrlKey, toUrlKey, packageSlug } from '../services/PreviewService/utils/serverKeyUtils';

const FAVICON_PATHS = new Set(['/favicon.ico', '/favicon.svg', '/favicon.png']);

const DEFAULT_FAVICON_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<rect width="32" height="32" rx="6" fill="#1a1a2e"/>' +
  '<text x="16" y="23" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#e94560" text-anchor="middle">A</text>' +
  '</svg>'
);

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite _next/image url param to include basePath.
 * Next.js optimizer uses new URL(url, origin) — ignores basePath — causing 400.
 * Fix: prepend urlKey to url param so internal fetch resolves correctly.
 */
function rewriteNextImagePath(path: string, urlKey: string): string {
  if (!path.includes('/_next/image')) return path;
  try {
    const urlObj = new URL(`http://localhost${path}`);
    const imageUrl = urlObj.searchParams.get('url');
    if (!imageUrl || imageUrl.startsWith(`/${urlKey}`)) return path;
    urlObj.searchParams.set('url', `/${urlKey}${imageUrl}`);
    return urlObj.pathname + urlObj.search;
  } catch {
    return path;
  }
}

/** Known API/system paths that should NOT be treated as urlKey */
const RESERVED_PATHS = ['/projects/', '/admin/', '/health', '/deploy/'];

export interface PreviewProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '' (no prefix, dedicated host)
  /**
   * Optional resolver for backend port (fullstack).
   * If provided, /:urlKey/api/* can be routed to backend instead of the entry (frontend) port.
   */
  getBackendPort?: (args: {
    tenantId: string;
    userId: string;
    projectId: string;
    feature: string;
    serverKey: string;
  }) => number | undefined | null | Promise<number | undefined | null>;
}

// Headers that must NOT be forwarded to upstream (hop-by-hop, HTTP/2 forbidden)
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'if-none-match', 'if-modified-since'
]);

/**
 * Build clean headers from incoming request — strips hop-by-hop headers
 * and non-string values (arrays/undefined) that would break Node.js fetch.
 */
function buildCleanHeaders(req: Request, targetHost: string, targetPort: number): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && typeof value === 'string') {
      headers[key] = value;
    }
  }
  headers['host'] = `${targetHost}:${targetPort}`;
  headers['accept-encoding'] = 'identity';
  return headers;
}

/**
 * Extract URL key from Referer header.
 * Looks for the first path segment that matches urlKey format (contains double-dashes).
 */
function extractUrlKeyFromReferer(refererStr: string): string | null {
  try {
    const url = new URL(refererStr);
    const segments = url.pathname.split('/').filter(Boolean);
    for (const segment of segments) {
      if (isUrlKey(segment)) {
        return segment;
      }
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

/**
 * Create preview proxy middleware
 */
export function createPreviewProxyMiddleware(config: PreviewProxyConfig) {
  const { portRegistry, pathPrefix = '', getBackendPort } = config;
  
  return async (req: Request, res: ExpressResponse, next: NextFunction) => {
    // ✅ Skip reserved API/system routes — handled by Express route handlers
    if (RESERVED_PATHS.some(p => req.path.startsWith(p))) {
      return next();
    }
    
    // ✅ Extract first path segment to check if it's a urlKey
    const urlPath = req.url.split('?')[0];
    const pathAfterPrefix = pathPrefix ? urlPath.substring(pathPrefix.length) : urlPath;
    const segments = pathAfterPrefix.split('/').filter(Boolean);
    const firstSegment = segments[0] || '';
    const hasUrlKeyInPath = firstSegment && isUrlKey(firstSegment);
    
    // ── Fallback: handle requests without urlKey in path ──
    // On a dedicated preview host, ANY non-reserved request without a urlKey
    // likely belongs to a preview project (SSR assets, static files, CSS url() refs, etc.).
    // Determine the correct dev server from Referer header or preview cookie.
    if (!hasUrlKeyInPath) {
      const referer = req.headers.referer || req.headers.referrer;
      const refererStr = Array.isArray(referer) ? referer[0] : referer;
      
      // 1. Try extracting urlKey from Referer (most reliable, project-specific)
      let urlKey: string | null = null;
      if (refererStr) {
        urlKey = extractUrlKeyFromReferer(refererStr);
      }
      
      // 2. Fallback: check preview cookie (handles CSS sub-resource chain)
      // Cookie stores the internal key (colon-separated) — convert to urlKey for path prepend
      if (!urlKey) {
        const cookieMatch = (req.headers.cookie || '').match(/__ant_preview_sk=([^;]+)/);
        if (cookieMatch) {
          try {
            const cookieValue = decodeURIComponent(cookieMatch[1]);
            if (isUrlKey(cookieValue)) {
              // Already a urlKey (double-dash format)
              urlKey = cookieValue;
            } else {
              // Internal key (colon-separated) — convert to urlKey
              urlKey = toUrlKey(cookieValue);
            }
          } catch { /* invalid cookie value */ }
        }
      }
      
      if (urlKey) {
        const parsed = parseUrlKey(urlKey);
        if (parsed) {
          const { tenantId, userId, projectId, feature } = parsed;

          try {
            const mapping = await portRegistry.getPreview(tenantId, userId, projectId, feature);
            if (mapping) {
              const host = mapping.host || 'localhost';
              const cleanHeaders = buildCleanHeaders(req, host, mapping.port);

              // All frameworks use native base path — always prepend the urlKey
              const resolvedUrl = rewriteNextImagePath(`/${urlKey}${req.url}`, urlKey);

              const targetUrl = `http://${host}:${mapping.port}${resolvedUrl}`;
              logger.warn(`[Preview] Routing ${req.path} to ${host}:${mapping.port} (fallback)`, { component: 'PreviewProxy' });

              const response = await fetch(targetUrl, {
                method: req.method,
                headers: cleanHeaders,
              });

              // Favicon fallback in Referer/Cookie routing path
              if (response.status === 404 && FAVICON_PATHS.has(req.path)) {
                res.status(200)
                  .setHeader('Content-Type', 'image/svg+xml')
                  .setHeader('Cache-Control', 'public, max-age=3600')
                  .end(DEFAULT_FAVICON_SVG);
                return;
              }

              // Stream response
              res.status(response.status);
              response.headers.forEach((value: string, key: string) => {
                const lower = key.toLowerCase();
                if (['content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
                res.setHeader(key, value);
              });

              if (response.body) {
                const nodeStream = Readable.fromWeb(response.body as any);
                nodeStream.pipe(res);
              } else {
                res.end();
              }
              return;
            }
          } catch (error: any) {
            logger.warn(`[Preview] Failed to route ${req.path} via fallback: ${error.message}`, { component: 'PreviewProxy' });
          }
        }
      }
      // No urlKey found or routing failed — serve default favicon or fall through
      if (FAVICON_PATHS.has(req.path)) {
        res.status(200)
          .setHeader('Content-Type', 'image/svg+xml')
          .setHeader('Cache-Control', 'public, max-age=3600')
          .end(DEFAULT_FAVICON_SVG);
        return;
      }
      return next();
    }
    
    // ── Main proxy logic: /:urlKey/* ──
    
    const urlKey = firstSegment;
    logger.warn(`[Preview] PROXY: ${req.method} ${req.url}`, { component: 'PreviewProxy' });
    
    const parsed = parseUrlKey(urlKey);
    if (!parsed) {
      logger.warn(`Invalid urlKey format: ${urlKey}`, { component: 'PreviewProxy' });
      res.status(400).json({ error: 'Invalid server key format' });
      return;
    }
    
    const { tenantId, userId, projectId, feature, serviceName } = parsed;
    const internalKey = fromUrlKey(urlKey);
    
    logger.debug(`Parsed urlKey: tenant=${tenantId}, user=${userId}, project=${projectId}, feature=${feature}${serviceName ? ', service=' + serviceName : ''}`, { component: 'PreviewProxy' });
    
    // Lookup entry port + per-package metadata from registry.
    // `previewPackages` carries `slug` (URL-safe identifier) and `urlKey`
    // (per-package basePath segment) populated by PreviewService.
    let port: number;
    let previewHost: string;
    let hasFrontend = false;
    type ProxyPkg = { name: string; slug?: string; type: string; port: number; urlKey?: string };
    let previewPackages: ProxyPkg[] = [];
    try {
      const mapping = await portRegistry.getPreview(tenantId, userId, projectId, feature);
      
      if (!mapping) {
        logger.warn(`No preview found for ${internalKey}`, { component: 'PreviewProxy' });
        res.status(404).json({ error: 'Preview not found' });
        return;
      }
      port = mapping.port;
      previewHost = mapping.host || 'localhost';
      previewPackages = (mapping.packages as any) || [];
      hasFrontend = previewPackages.some((p) => p.type === 'frontend');
      logger.warn(`[Preview] Found: ${internalKey} -> ${previewHost}:${port}`, { component: 'PreviewProxy' });
      
      // Update last access time
      await portRegistry.touchPreview(tenantId, userId, projectId, feature);
      
    } catch (error) {
      logger.error('Port lookup error', { component: 'PreviewProxy' }, error);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
    
    // ── Routing precedence ──
    //
    //   1. `/{urlKey}/api/*` → backend port, prefix stripped.
    //      Wins over service routing because user-typed `serviceName` slugs
    //      cannot collide with the literal `api` segment (`/api/*` is the
    //      universal fullstack contract).
    //
    //   2. 5-part urlKey with `serviceName`:
    //        - matched frontend pkg → keep prefix, route to that pkg.port
    //          (frontend has its own basePath equal to the 5-part urlKey).
    //        - matched backend/other pkg → strip prefix, route to that pkg.port
    //          (no basePath; pkg expects bare paths).
    //        - no match → fall back to entry frontend with prefix kept.
    //
    //   3. 4-part urlKey: route to entry frontend, prefix kept.
    //
    //   4. Backend-only project (no frontend in packages): strip prefix,
    //      route everything to the single backend port.
    //
    // SSOT: matching uses `pkg.slug` (URL-safe). Stale records lacking `slug`
    // (written by older builds) fall through cleanly to the entry frontend.
    let targetPath = req.url;
    let targetPort = port;
    let serviceRouted = false;
    
    const stripPrefix = (p: string): string =>
      p.replace(new RegExp(`^/${escapeRegExp(urlKey)}`), '') || '/';
    
    // (1) /api/* always wins
    if (typeof getBackendPort === 'function') {
      try {
        const pathForApiCheck = stripPrefix(req.url);
        const isApiRequest = pathForApiCheck === '/api' || pathForApiCheck.startsWith('/api/');
        if (isApiRequest) {
          const backendPort = await getBackendPort({ tenantId, userId, projectId, feature, serverKey: internalKey });
          if (typeof backendPort === 'number' && backendPort > 0) {
            targetPort = backendPort;
            targetPath = pathForApiCheck;
            serviceRouted = true;
            logger.debug(`Routing API request to backend port: ${backendPort}`, { component: 'PreviewProxy' });
          }
        }
      } catch {
        // best-effort — fall through to other precedence rules
      }
    }
    
    // (2) 5-part urlKey: service-specific routing by slug
    if (!serviceRouted && serviceName && previewPackages.length) {
      // Defensive normalization: any caller that didn't pre-slugify
      // `serviceName` is rescued here so URL `apps/web` (impossible at this
      // point — `/` would have been a path delimiter) and historical raw
      // names match the SSOT slug.
      const wantedSlug = packageSlug(serviceName);
      const targetPkg = previewPackages.find((p) => p.slug === wantedSlug);
      if (targetPkg) {
        targetPort = targetPkg.port;
        if (targetPkg.type === 'frontend') {
          // Frontend has its own basePath equal to the 5-part urlKey — keep prefix.
          targetPath = req.url;
        } else {
          // Backend/other: strip prefix, dev server expects bare paths.
          targetPath = stripPrefix(req.url);
        }
        serviceRouted = true;
        logger.debug(`Routing to service '${wantedSlug}' (${targetPkg.type}) -> port ${targetPkg.port}`, { component: 'PreviewProxy' });
      } else {
        logger.warn(`Service '${serviceName}' not found in packages, falling back to entry`, { component: 'PreviewProxy' });
      }
    }
    
    // (4) Backend-only projects: strip urlKey prefix (no basePath configured)
    if (!serviceRouted && !hasFrontend) {
      targetPath = stripPrefix(req.url);
    }

    // Next.js _next/image needs absolute basePath in its `url=` param.
    // Rewrite when the resolved target is a frontend dev server (it owns the
    // `basePath` rewrite contract). Use the urlKey actually carried in the
    // request — equals the frontend's basePath whether 4-part or 5-part.
    const targetIsFrontend = previewPackages.some(p => p.port === targetPort && p.type === 'frontend')
      || (!serviceRouted && hasFrontend);
    if (targetIsFrontend) {
      targetPath = rewriteNextImagePath(targetPath, urlKey);
    }

    const effectiveTargetUrl = `http://${previewHost}:${targetPort}${targetPath}`;
    logger.warn(`[Preview] Target: ${effectiveTargetUrl}`, { component: 'PreviewProxy' });
    
    try {
      // ✅ Retry logic for preview server startup race condition
      let response: globalThis.Response | null = null;
      let lastError: Error | null = null;
      const maxRetries = 3;
      const retryDelay = 500; // ms
      const method = (req.method || 'GET').toUpperCase();
      const hasRequestBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      
      // Build clean headers — use actual previewHost (not localhost)
      const cleanHeaders = buildCleanHeaders(req, previewHost, targetPort);
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(effectiveTargetUrl, {
            method: req.method,
            headers: cleanHeaders,
            ...(hasRequestBody ? { body: req as any, duplex: 'half' as any } : {})
          });
          break; // Success!
        } catch (error: any) {
          lastError = error;
          if (attempt < maxRetries) {
            logger.debug(`Retry ${attempt}/${maxRetries} in ${retryDelay}ms`, { component: 'PreviewProxy' });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
      
      if (!response) {
        throw lastError || new Error('Failed to connect after retries');
      }
      
      const contentType = response.headers.get('content-type') || '';
      logger.debug(`Upstream response: ${response.status} (${contentType})`, { component: 'PreviewProxy' });

      // Favicon fallback: serve default Ant favicon when upstream returns 404
      const strippedPath = targetPath.replace(new RegExp(`^/${escapeRegExp(urlKey)}`), '') || '/';
      if (response.status === 404 && FAVICON_PATHS.has(strippedPath)) {
        const favicon = DEFAULT_FAVICON_SVG;
        res.status(200)
          .setHeader('Content-Type', 'image/svg+xml')
          .setHeader('Cache-Control', 'public, max-age=3600')
          .end(favicon);
        return;
      }

      // Copy status and headers (strip hop-by-hop and caching headers)
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        const lower = key.toLowerCase();
        if (['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) return;
        if (['content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
        res.setHeader(key, value);
      });
      
      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      
      // Set preview cookie so sub-resource requests can find the urlKey.
      // Cookie path is scoped to /{urlKey} to prevent cross-project pollution.
      if (contentType.includes('text/html')) {
        res.setHeader('Set-Cookie', `__ant_preview_sk=${encodeURIComponent(internalKey)}; Path=/${urlKey}; SameSite=Lax`);
      }
      
      // ✅ Stream response body directly — no buffering, no rewriting.
      // This preserves Streaming SSR (React 18 Suspense) and avoids
      // the overhead of reading the entire response into memory.
      if (response.body) {
        // Strip content-length since we might be in chunked mode
        res.removeHeader('content-length');
        const nodeStream = Readable.fromWeb(response.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error: any) {
      // Log detailed error including cause for debugging
      logger.error(`Fetch error: ${error.message}`, { component: 'PreviewProxy' });
      if (error.cause) {
        logger.error(`Fetch error cause: ${error.cause.message || error.cause}`, { component: 'PreviewProxy' });
      }
      res.status(502).json({ error: 'Bad Gateway' });
    }
  };
}
