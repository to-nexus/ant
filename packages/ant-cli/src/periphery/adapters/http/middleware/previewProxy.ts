/**
 * PreviewProxyMiddleware
 * 
 * Express middleware to proxy preview requests on a dedicated host (ant-preview.crosstoken.io).
 * Dynamically routes /:serverKey/* to the appropriate dev server port.
 * 
 * Example:
 * /acme:alice:todo-app:feature-login → localhost:30001
 * /acme:alice:todo-app:feature-login/src/main.tsx → localhost:30001/src/main.tsx
 * 
 * For SSR resources without serverKey (e.g., /_next/chunk.js),
 * uses Referer header to determine the correct dev server.
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';
import { parsePreviewKey } from '../../../../infrastructure/state/redisKeyUtils';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Known API/system paths that should NOT be treated as serverKey */
const RESERVED_PATHS = ['/projects/', '/admin/', '/health'];

export interface PreviewProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '' (no prefix, dedicated host)
  /**
   * Optional resolver for backend port (fullstack).
   * If provided, /:serverKey/api/* can be routed to backend instead of the entry (frontend) port.
   */
  getBackendPort?: (args: {
    tenantId: string;
    userId: string;
    projectId: string;
    feature: string;
    serverKey: string;
  }) => number | undefined | null | Promise<number | undefined | null>;
}

/**
 * Check if a path segment looks like a serverKey (contains colons)
 * ServerKey format: tenantId:userId:projectId:feature
 */
function isServerKey(segment: string): boolean {
  return segment.includes(':') && parsePreviewKey(segment) !== null;
}

/**
 * Extract serverKey from Referer header.
 * Looks for the first path segment that matches serverKey format (contains colons).
 */
function extractServerKeyFromReferer(refererStr: string): string | null {
  try {
    const url = new URL(refererStr);
    const segments = url.pathname.split('/').filter(Boolean);
    for (const segment of segments) {
      if (isServerKey(segment)) {
        return segment;
      }
    }
  } catch {
    // Not a valid URL, try regex fallback
    const match = refererStr.match(/\/([^/]*:[^/]*:[^/]*:[^/]*)/);
    if (match) return match[1];
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
    
    // ✅ Extract first path segment to check if it's a serverKey
    const urlPath = req.url.split('?')[0];
    const pathAfterPrefix = pathPrefix ? urlPath.substring(pathPrefix.length) : urlPath;
    const segments = pathAfterPrefix.split('/').filter(Boolean);
    const firstSegment = segments[0] || '';
    const hasServerKeyInPath = firstSegment && isServerKey(firstSegment);
    
    // ✅ Handle requests without serverKey in path (SSR resource leakage)
    // These come from SSR-rendered absolute paths (/_next/*, /logos/*, etc.)
    // Use Referer header to determine the correct dev server.
    if (!hasServerKeyInPath) {
      const isNextInternal = req.path.startsWith('/_next/');
      const isStaticAsset = /^\/(logos|icons|backgrounds|images|assets|public|fonts|static)\//.test(req.path);
      const hasStaticExt = /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|eot|css|js)(\?.*)?$/.test(req.path);
      
      if (isNextInternal || isStaticAsset || hasStaticExt) {
        const referer = req.headers.referer || req.headers.referrer;
        const refererStr = Array.isArray(referer) ? referer[0] : referer;
        
        if (refererStr) {
          const serverKey = extractServerKeyFromReferer(refererStr);
          if (serverKey) {
            const parsed = parsePreviewKey(serverKey);
            if (parsed) {
              const { tenantId, userId, projectId, feature } = parsed;
              
              try {
                const mapping = await portRegistry.getPreview(tenantId, userId, projectId, feature);
                if (mapping) {
                  const host = mapping.host || 'localhost';
                  const targetUrl = `http://${host}:${mapping.port}${req.url}`;
                  logger.warn(`[Preview] Routing ${req.path} to ${host}:${mapping.port} (from referer)`, { component: 'PreviewProxy' });
                  
                  const response = await fetch(targetUrl, {
                    method: req.method,
                    headers: {
                      ...req.headers,
                      host: `${host}:${mapping.port}`,
                      'accept-encoding': 'identity',
                    } as any,
                  });
                  
                  res.status(response.status);
                  response.headers.forEach((value: string, key: string) => {
                    const lower = key.toLowerCase();
                    if (['content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
                    res.setHeader(key, value);
                  });
                  
                  const buffer = Buffer.from(await response.arrayBuffer());
                  res.setHeader('content-length', buffer.length);
                  res.send(buffer);
                  return;
                }
              } catch (error) {
                logger.debug(`Failed to route ${req.path} request`, { component: 'PreviewProxy' });
              }
            }
          }
        }
      }
      // If we can't determine the server, let it fall through
      return next();
    }
    
    // ── Main proxy logic: /:serverKey/* ──
    
    const serverKey = firstSegment;
    logger.warn(`[Preview] PROXY: ${req.method} ${req.url}`, { component: 'PreviewProxy' });
    logger.debug(`serverKey=${serverKey}`, { component: 'PreviewProxy' });
    
    const parsed = parsePreviewKey(serverKey);
    if (!parsed) {
      logger.warn(`Invalid serverKey format: ${serverKey}`, { component: 'PreviewProxy' });
      res.status(400).json({
        error: 'Invalid server key format',
        message: 'Expected format: tenantId:userId:projectId:feature',
        received: serverKey
      });
      return;
    }
    
    const { tenantId, userId, projectId, feature } = parsed;
    
    logger.debug(`Parsed serverKey: tenant=${tenantId}, user=${userId}, project=${projectId}, feature=${feature}`, { component: 'PreviewProxy' });
    
    // Lookup entry (frontend) port and host from registry
    let port: number;
    let previewHost: string;
    try {
      const mapping = await portRegistry.getPreview(tenantId, userId, projectId, feature);
      
      if (!mapping) {
        logger.warn(`No preview found for ${serverKey}`, { component: 'PreviewProxy' });
        res.status(404).json({
          error: 'Preview not found',
          message: `No preview running for ${serverKey}`,
          serverKey
        });
        return;
      }
      port = mapping.port;
      previewHost = mapping.host || 'localhost';
      logger.warn(`[Preview] Found: ${serverKey} -> ${previewHost}:${port}`, { component: 'PreviewProxy' });
      
      // Update last access time
      await portRegistry.touchPreview(tenantId, userId, projectId, feature);
      
    } catch (error) {
      logger.error('Port lookup error', { component: 'PreviewProxy' }, error);
      res.status(500).json({
        error: 'Failed to lookup preview port',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return;
    }
    
    // ✅ Strip /:serverKey from path for dev server (handle accidental double-prefix)
    const prefix = `${pathPrefix}/${serverKey}`;
    let targetPath = req.url;
    while (targetPath.startsWith(prefix)) {
      targetPath = targetPath.slice(prefix.length) || '/';
    }

    // ✅ Fullstack support: check if project has a backend
    let targetPort = port;
    let isFullstack = false;
    
    if (typeof getBackendPort === 'function') {
      try {
        const backendPort = await getBackendPort({ tenantId, userId, projectId, feature, serverKey });
        if (typeof backendPort === 'number' && backendPort > 0) {
          isFullstack = true;
          
          // Route /api/* requests to backend port
          const isApiRequest = targetPath === '/api' || targetPath.startsWith('/api/');
          if (isApiRequest) {
            targetPort = backendPort;
            logger.debug(`Routing API request to backend port: ${backendPort}`, { component: 'PreviewProxy' });
          }
        }
      } catch {
        // best-effort
      }
    }

    const targetUrl = `http://${previewHost}:${port}${targetPath}`;
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
      
      // Build clean headers - exclude hop-by-hop headers (not allowed in HTTP/2)
      const hopByHopHeaders = new Set([
        'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate',
        'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
        'if-none-match', 'if-modified-since'
      ]);
      const cleanHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (!hopByHopHeaders.has(key.toLowerCase()) && typeof value === 'string') {
          cleanHeaders[key] = value;
        }
      }
      cleanHeaders['host'] = `localhost:${targetPort}`;
      cleanHeaders['accept-encoding'] = 'identity';
      
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
      
      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        const lower = key.toLowerCase();
        if (['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) return;
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
        res.setHeader(key, value);
      });
      
      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      
      // Check if content needs rewriting (HTML, JS, CSS)
      const needsRewrite = contentType.includes('text/html') || 
                           contentType.includes('javascript') || 
                           contentType.includes('text/javascript') ||
                           contentType.includes('application/javascript') ||
                           contentType.includes('text/css');
      
      if (needsRewrite) {
        const text = await response.text();
        logger.debug(`Rewriting ${text.length} bytes`, { component: 'PreviewProxy' });
        
        let rewritten = text;
        
        // ✅ Inject path rewrite script for client-side requests (HTML only)
        // This handles React hydration overwriting paths back to original values
        if (contentType.includes('text/html')) {
          const basePath = `/${serverKey}`;
          const clientScript = `<script>
(function() {
  var BASE = "${basePath}";
  
  // Rewrite path if needed
  function rewrite(path) {
    if (typeof path !== 'string') return path;
    if (path.startsWith('/') && !path.startsWith('//') && !path.startsWith(BASE)) {
      return BASE + path;
    }
    return path;
  }
  
  // Override fetch
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rewrite(input);
    else if (input && input.url) input = new Request(rewrite(input.url), input);
    return origFetch.call(this, input, init);
  };
  
  // Override XMLHttpRequest
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rewrite(url);
    return origOpen.apply(this, arguments);
  };
  
  // Rewrite element src/href
  function fixEl(el) {
    if (!el || el.nodeType !== 1) return;
    ['src', 'href'].forEach(function(attr) {
      var val = el.getAttribute(attr);
      if (val && val.startsWith('/') && !val.startsWith('//') && !val.startsWith(BASE)) {
        el.setAttribute(attr, BASE + val);
      }
    });
  }
  
  // Observe DOM changes (React hydration)
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(fixEl);
      if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'href')) {
        fixEl(m.target);
      }
    });
  });
  
  function startObserving() {
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href']
    });
    // Fix existing elements
    document.querySelectorAll('[src], [href]').forEach(fixEl);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }
  
  window.__BASENAME__ = BASE;
})();
</script>`;
          
          const headMatch = rewritten.match(/<head[^>]*>/i);
          if (headMatch) {
            const insertPos = headMatch.index! + headMatch[0].length;
            rewritten = rewritten.substring(0, insertPos) + clientScript + rewritten.substring(insertPos);
            logger.debug(`Injected client-side path rewrite script`, { component: 'PreviewProxy' });
          }
        }
        
        // ✅ Rewrite absolute paths to include /:serverKey/ prefix
        // This ensures all resources (images, CSS, JS) are routed correctly
        const replacement = `/${serverKey}/`;
        const escapedAlready = escapeRegExp(`${serverKey}/`);
        
        // HTML attributes: src, href, action
        const htmlAttrRe = new RegExp(`((?:src|href|action)=["'])\\/(?!\\/|${escapedAlready})`, 'g');
        rewritten = rewritten.replace(htmlAttrRe, `$1${replacement}`);
        
        // JS imports
        const fromRe = new RegExp(`((?:import\\s+[^"']+\\s+)?from\\s+["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const importLineRe = new RegExp(`((?:^|\\n|;)\\s*import\\s+["'])\\/(?!\\/|${escapedAlready})`, 'gm');
        const importFnRe = new RegExp(`(import\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const exportFromRe = new RegExp(`(export\\s+\\*\\s+from\\s+["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const globRe = new RegExp(`(import\\.meta\\.glob\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const newUrlRe = new RegExp(`(new\\s+URL\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        
        rewritten = rewritten
          .replace(fromRe, `$1${replacement}`)
          .replace(importLineRe, `$1${replacement}`)
          .replace(importFnRe, `$1${replacement}`)
          .replace(exportFromRe, `$1${replacement}`)
          .replace(globRe, `$1${replacement}`)
          .replace(newUrlRe, `$1${replacement}`);

        // Rewrite runtime absolute asset references
        const assetLiteralRe = new RegExp(`(["'])\\/(?!\\/|${escapedAlready})(assets\\/[^"']*)\\1`, 'g');
        rewritten = rewritten.replace(assetLiteralRe, `$1${replacement}$2$1`);

        const staticExt = '(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|eot)';
        const staticLiteralRe = new RegExp(`(["'\`])\\/(?!\\/|${escapedAlready})([^"'\`]+\\.${staticExt})\\1`, 'g');
        rewritten = rewritten.replace(staticLiteralRe, `$1${replacement}$2$1`);

        const nextInternalRe = new RegExp(`(["'\`])\\/(?!\\/|${escapedAlready})(_next\\/[^"'\`]*)\\1`, 'g');
        rewritten = rewritten.replace(nextInternalRe, `$1${replacement}$2$1`);

        // CSS url() rewrite
        const cssUrlRe = new RegExp(`url\\(\\s*(["']?)\\/(?!\\/|${escapedAlready})([^"')]+\\.${staticExt})\\1\\s*\\)`, 'g');
        rewritten = rewritten.replace(cssUrlRe, `url($1${replacement}$2$1)`);

        // Frontend-only convenience: rewrite relative API calls
        if (!isFullstack) {
          const apiSlashRe = new RegExp(`(["'])\\/(?!\\/|${escapedAlready})api\\/`, 'g');
          const apiExactRe = new RegExp(`(["'])\\/(?!\\/|${escapedAlready})api\\1`, 'g');
          rewritten = rewritten
            .replace(apiSlashRe, `$1${replacement}api/`)
            .replace(apiExactRe, `$1${replacement}api$1`);
        }
        
        res.setHeader('content-length', Buffer.byteLength(rewritten));
        res.send(rewritten);
      } else {
        // Pass through binary content
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('content-length', buffer.length);
        res.send(buffer);
      }
    } catch (error: any) {
      // Log detailed error including cause for debugging
      logger.error(`Fetch error: ${error.message}`, { component: 'PreviewProxy' });
      if (error.cause) {
        logger.error(`Fetch error cause: ${error.cause.message || error.cause}`, { component: 'PreviewProxy' });
      }
      res.status(502).json({
        error: 'Bad Gateway',
        message: `Failed to connect to preview server on port ${port}`,
        details: error.message
      });
    }
  };
}

