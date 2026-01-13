/**
 * DevServerProxyMiddleware
 * 
 * Express middleware to proxy dev server requests.
 * Dynamically routes /dev/:serverKey/* to the appropriate port.
 * 
 * Example:
 * /dev/alice:todo-app:feature-login → localhost:30001
 * /dev/alice:todo-app:feature-login/src/main.tsx → localhost:30001/src/main.tsx
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface DevServerProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '/dev'
  /**
   * Optional resolver for backend port (fullstack).
   * If provided, /dev/:serverKey/api/* can be routed to backend instead of the entry (frontend) port.
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
 * Create dev server proxy middleware
 */
export function createDevServerProxyMiddleware(config: DevServerProxyConfig) {
  const { portRegistry, pathPrefix = '/dev', getBackendPort } = config;
  
  return async (req: Request, res: ExpressResponse, next: NextFunction) => {
    // ✅ Handle requests without /dev/:serverKey prefix that should go to dev server
    // These come from client-side JS (hydration) - use Referer header to route.
    // Patterns: /_next/*, /logos/*, /icons/*, /backgrounds/*, /public/*, static assets
    // IMPORTANT: Skip if already has /dev/ prefix (handled by main logic below)
    const hasDevPrefix = req.path.startsWith(`${pathPrefix}/`);
    const isNextInternal = req.path.startsWith('/_next/');
    const isStaticAsset = /^\/(logos|icons|backgrounds|images|assets|public|fonts|static)\//.test(req.path);
    const hasStaticExt = /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|eot|css|js)(\?.*)?$/.test(req.path);
    
    if (!hasDevPrefix && (isNextInternal || isStaticAsset || hasStaticExt)) {
      const referer = req.headers.referer || req.headers.referrer;
      // Ensure referer is a string (can be string[] in Express types)
      const refererStr = Array.isArray(referer) ? referer[0] : referer;
      if (refererStr) {
        // Extract serverKey from referer: .../dev/tenantId:userId:projectId:feature/...
        const refererMatch = refererStr.match(/\/dev\/([^/]+)/);
        if (refererMatch) {
          const serverKey = refererMatch[1];
          const parts = serverKey.split(':');
          if (parts.length >= 4) {
            const [tenantId, userId, projectId, ...featureParts] = parts;
            const feature = featureParts.join(':');
            
            try {
              const port = await portRegistry.getDevServerPort(tenantId, userId, projectId, feature);
              if (port) {
                // Proxy request to the correct dev server
                const targetUrl = `http://localhost:${port}${req.url}`;
                logger.debug(`Routing ${req.path} to port ${port} (from referer)`, { component: 'DevProxy' });
                
                const response = await fetch(targetUrl, {
                  method: req.method,
                  headers: {
                    ...req.headers,
                    host: `localhost:${port}`,
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
              logger.debug(`Failed to route ${req.path} request`, { component: 'DevProxy' });
            }
          }
        }
      }
      // If we can't determine the server, let it fall through
      return next();
    }
    
    // Only handle paths starting with /dev/
    if (!req.path.startsWith(`${pathPrefix}/`)) {
      return next();
    }
    
    logger.debug(`${req.method} ${req.url}`, { component: 'DevProxy' });
    
    // ✅ Use req.url instead of req.path to preserve query params
    // Extract serverKey from path: /dev/tenantId:userId:projectId:feature/...
    const url = req.url.split('?')[0]; // Remove query params
    const pathWithoutPrefix = url.substring(pathPrefix.length + 1); // Remove '/dev/'
    const firstSlashIndex = pathWithoutPrefix.indexOf('/');
    const serverKey = firstSlashIndex === -1 
      ? pathWithoutPrefix  // No slash, entire string is serverKey
      : pathWithoutPrefix.substring(0, firstSlashIndex);  // Everything before first slash
    
    if (!serverKey) {
      logger.warn('No serverKey', { component: 'DevProxy' });
      res.status(404).json({
        error: 'Server key not provided',
        message: `Usage: ${pathPrefix}/:serverKey`
      });
      return;  // ✅ Don't return the result, just return
    }
    
    logger.debug(`serverKey=${serverKey}`, { component: 'DevProxy' });
    
    // Parse serverKey: tenantId:userId:projectId:feature
    const parts = serverKey.split(':');
    if (parts.length < 4) {
      logger.warn(`Invalid serverKey format: ${serverKey}`, { component: 'DevProxy' });
      res.status(400).json({
        error: 'Invalid server key format',
        message: 'Expected format: tenantId:userId:projectId:feature',
        received: serverKey
      });
      return;  // ✅ Don't return the result
    }
    
    const [tenantId, userId, projectId, ...featureParts] = parts;
    const feature = featureParts.join(':');
    
    logger.debug(`Parsed ${tenantId}/${userId}/${projectId}/${feature}`, {
      component: 'DevProxy',
      organizationId: tenantId,
      userId,
      projectId,
      featureName: feature
    });
    
    // Lookup entry (frontend) port from registry
    let port: number | null;
    try {
      port = await portRegistry.getDevServerPort(tenantId, userId, projectId, feature);
      
      if (!port) {
        logger.info(`No port found for ${serverKey}`, {
          component: 'DevProxy',
          organizationId: tenantId,
          userId,
          projectId,
          featureName: feature
        });
        res.status(404).json({
          error: 'Dev server not found',
          message: `No dev server running for ${serverKey}`,
          serverKey
        });
        return;  // ✅ Don't return the result
      }
      logger.debug(`Port found: ${port}`, {
        component: 'DevProxy',
        organizationId: tenantId,
        userId,
        projectId,
        featureName: feature
      });
      
      // Update last access time
      await portRegistry.updateLastAccess(tenantId, userId, projectId, feature, 'dev-server');
      
    } catch (error) {
      logger.error('Port lookup error', { component: 'DevProxy' }, error);
      res.status(500).json({
        error: 'Failed to lookup dev server port',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      return;  // ✅ Don't return the result
    }
    
    logger.debug(`Proxy to localhost:${port}`, { component: 'DevProxy' });
    
    // ✅ Strip /dev/:serverKey from path for Vite (handle accidental double-prefix)
    const prefix = `${pathPrefix}/${serverKey}`;
    let targetPath = req.url;
    while (targetPath.startsWith(prefix)) {
      targetPath = targetPath.slice(prefix.length) || '/';
    }

    // ✅ Fullstack support: check if project has a backend
    let targetPort = port;
    let isFullstack = false;  // ✅ Track if project has backend (affects /api/ rewrite)
    
    if (typeof getBackendPort === 'function') {
      try {
        const backendPort = await getBackendPort({ tenantId, userId, projectId, feature, serverKey });
        if (typeof backendPort === 'number' && backendPort > 0) {
          isFullstack = true;  // ✅ Project has backend
          
          // Route /api/* requests to backend port
          const isApiRequest = targetPath === '/api' || targetPath.startsWith('/api/');
          if (isApiRequest) {
            targetPort = backendPort;
            logger.debug(`Routing API request to backend port: ${backendPort}`, { component: 'DevProxy' });
          }
        }
      } catch {
        // best-effort
      }
    }

    const targetUrl = `http://localhost:${port}${targetPath}`;
    const effectiveTargetUrl = `http://localhost:${targetPort}${targetPath}`;
    logger.debug(`Target URL: ${effectiveTargetUrl}`, { component: 'DevProxy' });
    
    try {
      // ✅ Retry logic for dev server startup race condition
      let response: globalThis.Response | null = null;  // ✅ Use globalThis.Response (fetch API)
      let lastError: Error | null = null;
      const maxRetries = 3;
      const retryDelay = 500; // ms
      const method = (req.method || 'GET').toUpperCase();
      const hasRequestBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(effectiveTargetUrl, {
            method: req.method,
            headers: {
              ...req.headers,
              host: `localhost:${targetPort}`,
              // ✅ Avoid upstream compression. We may rewrite/rehydrate bodies and must not forward
              // compressed responses with stale Content-Encoding headers to the browser.
              'accept-encoding': 'identity',
              // ✅ Force full response (no 304)
              'if-none-match': undefined,
              'if-modified-since': undefined
            } as any,
            // ✅ Stream original request body through to upstream (fullstack API calls).
            // NOTE: Requires this middleware to be registered before express.json/body parsers.
            ...(hasRequestBody ? { body: req as any, duplex: 'half' as any } : {})
          });
          break; // Success!
        } catch (error: any) {
          lastError = error;
          if (attempt < maxRetries) {
            logger.debug(`Retry ${attempt}/${maxRetries} in ${retryDelay}ms`, { component: 'DevProxy' });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
      
      if (!response) {
        throw lastError || new Error('Failed to connect after retries');
      }
      
      const contentType = response.headers.get('content-type') || '';
      logger.debug(`Upstream response: ${response.status} (${contentType})`, { component: 'DevProxy' });
      
      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        const lower = key.toLowerCase();
        // ✅ Don't copy cache headers to prevent browser caching unrewritten content
        if (['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) return;

        // ✅ We buffer and sometimes rewrite response bodies. Never forward hop-by-hop or encoding/length
        // headers from upstream; they can become incorrect and cause ERR_CONTENT_DECODING_FAILED.
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;

        res.setHeader(key, value);
      });
      
      // ✅ Set cache control to prevent caching
      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      
      // Check if content needs rewriting (HTML, JS, CSS)
      const needsRewrite = contentType.includes('text/html') || 
                           contentType.includes('javascript') || 
                           contentType.includes('text/javascript') ||
                           contentType.includes('application/javascript') ||
                           contentType.includes('text/css');
      
      if (needsRewrite) {
        const text = await response.text();
        logger.debug(`Rewriting ${text.length} bytes`, { component: 'DevProxy' });
        
        let rewritten = text;
        
        // ✅ Inject window.__BASENAME__ for React Router (HTML only)
        if (contentType.includes('text/html')) {
          const basenameScript = `<script>window.__BASENAME__ = "${pathPrefix}/${serverKey}";</script>`;
          const headEndIndex = text.indexOf('</head>');
          if (headEndIndex !== -1) {
            rewritten = text.substring(0, headEndIndex) + basenameScript + text.substring(headEndIndex);
            logger.debug(`Injected window.__BASENAME__`, { component: 'DevProxy' });
          }
        }
        
        // Rewrite absolute paths to include /dev/:serverKey/ prefix (idempotent)
        // ✅ IMPORTANT: Do not rewrite if it is already prefixed with /dev/:serverKey/
        const prefixNoLeadingSlash = `${pathPrefix.replace(/^\//, '')}/${serverKey}/`; // e.g. "dev/<serverKey>/"
        const escapedAlready = escapeRegExp(prefixNoLeadingSlash);
        const replacement = `${pathPrefix}/${serverKey}/`;
        
        const htmlAttrRe = new RegExp(`((?:src|href|action)=["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const fromRe = new RegExp(`((?:import\\s+[^"']+\\s+)?from\\s+["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const importLineRe = new RegExp(`((?:^|\\n|;)\\s*import\\s+["'])\\/(?!\\/|${escapedAlready})`, 'gm');
        const importFnRe = new RegExp(`(import\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const exportFromRe = new RegExp(`(export\\s+\\*\\s+from\\s+["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const globRe = new RegExp(`(import\\.meta\\.glob\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        const newUrlRe = new RegExp(`(new\\s+URL\\s*\\(\\s*["'])\\/(?!\\/|${escapedAlready})`, 'g');
        
        rewritten = rewritten
          .replace(htmlAttrRe, `$1${replacement}`)
          .replace(fromRe, `$1${replacement}`)
          .replace(importLineRe, `$1${replacement}`)
          .replace(importFnRe, `$1${replacement}`)
          .replace(exportFromRe, `$1${replacement}`)
          .replace(globRe, `$1${replacement}`)
          .replace(newUrlRe, `$1${replacement}`);

        // ✅ Also rewrite runtime absolute asset references inside code (JS/CSS).
        // Reason: when the app is served under /dev/:serverKey/, an absolute '/ogf/..' will otherwise
        // leak to the platform origin and may hit auth (401) in cloud mode.
        //
        // 1) Common case: '/assets/...'
        const assetLiteralRe = new RegExp(`(["'])\\/(?!\\/|${escapedAlready})(assets\\/[^"']*)\\1`, 'g');
        rewritten = rewritten.replace(assetLiteralRe, `$1${replacement}$2$1`);

        // 2) Generic static resources (quoted absolute paths ending with a known static extension)
        // Avoid rewriting routes like '/about' by requiring a file extension.
        const staticExt = '(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|eot)';
        const staticLiteralRe = new RegExp(`(["'\`])\\/(?!\\/|${escapedAlready})([^"'\`]+\\.${staticExt})\\1`, 'g');
        rewritten = rewritten.replace(staticLiteralRe, `$1${replacement}$2$1`);

        // 2b) Next.js internal paths (/_next/) - required for Image optimization, HMR, etc.
        const nextInternalRe = new RegExp(`(["'\`])\\/(?!\\/|${escapedAlready})(_next\\/[^"'\`]*)\\1`, 'g');
        rewritten = rewritten.replace(nextInternalRe, `$1${replacement}$2$1`);

        // 3) CSS url(/...) (with or without quotes)
        const cssUrlRe = new RegExp(`url\\(\\s*(["']?)\\/(?!\\/|${escapedAlready})([^"')]+\\.${staticExt})\\1\\s*\\)`, 'g');
        rewritten = rewritten.replace(cssUrlRe, `url($1${replacement}$2$1)`);

        // ✅ Frontend-only convenience: rewrite relative API calls '/api/...'
        // so they go through the dev proxy namespace: '/dev/:serverKey/api/...'
        // SKIP for fullstack projects (they use VITE_API_BASE_URL to call backend directly)
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
        // ✅ Ensure correct length for buffered responses
        res.setHeader('content-length', buffer.length);
        res.send(buffer);
      }
    } catch (error: any) {
      logger.error(`Fetch error: ${error.message}`, { component: 'DevProxy' });
      res.status(502).json({
        error: 'Bad Gateway',
        message: `Failed to connect to dev server on port ${port}`,
        details: error.message
      });
    }
  };
}

/**
 * Legacy: Batch proxy creation (not recommended for dynamic routing)
 * 
 * This approach creates proxies upfront for all registered dev servers.
 * Use createDevServerProxyMiddleware for dynamic routing instead.
 */
export async function createBatchDevServerProxies(
  portRegistry: PortRegistryPort,
  pathPrefix: string = '/dev'
): Promise<Array<{ path: string; proxy: any }>> {
  const devServers = await portRegistry.listDevServers();
  const proxies: Array<{ path: string; proxy: any }> = [];
  
  for (const mapping of devServers) {
    const serverKey = `${mapping.tenantId}:${mapping.userId}:${mapping.projectId}:${mapping.feature}`;
    const path = `${pathPrefix}/${serverKey}`;
    
    const proxy = createProxyMiddleware({
      target: `http://localhost:${mapping.port}`,
      changeOrigin: true,
      ws: true,
      pathRewrite: {
        [`^${path}`]: ''
      }
    } as Options);
    
    proxies.push({ path, proxy });
  }
  
  return proxies;
}
