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

export interface DevServerProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '/dev'
}

/**
 * Create dev server proxy middleware
 */
export function createDevServerProxyMiddleware(config: DevServerProxyConfig) {
  const { portRegistry, pathPrefix = '/dev' } = config;
  
  return async (req: Request, res: ExpressResponse, next: NextFunction) => {
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
    
    // Lookup port from registry
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
    
    // ✅ Strip /dev/:serverKey from path for Vite
    const targetPath = req.url.replace(`${pathPrefix}/${serverKey}`, '') || '/';
    const targetUrl = `http://localhost:${port}${targetPath}`;
    logger.debug(`Target URL: ${targetUrl}`, { component: 'DevProxy' });
    
    try {
      // ✅ Retry logic for dev server startup race condition
      let response: globalThis.Response | null = null;  // ✅ Use globalThis.Response (fetch API)
      let lastError: Error | null = null;
      const maxRetries = 3;
      const retryDelay = 500; // ms
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(targetUrl, {
            method: req.method,
            headers: {
              ...req.headers,
              host: `localhost:${port}`,
              // ✅ Force full response (no 304)
              'if-none-match': undefined,
              'if-modified-since': undefined
            } as any
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
        // ✅ Don't copy cache headers to prevent browser caching unrewritten content
        if (!['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      
      // ✅ Set cache control to prevent caching
      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
      
      // Check if content needs rewriting (HTML, JS, CSS)
      const needsRewrite = contentType.includes('text/html') || 
                           contentType.includes('javascript') || 
                           contentType.includes('text/javascript') ||
                           contentType.includes('application/javascript');
      
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
        
        // Rewrite all absolute paths to include /dev/:serverKey/ prefix
        rewritten = rewritten
          // HTML: src="/...", href="/..."
          .replace(/((?:src|href|action)=["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
          // JS: from "/..."
          .replace(/((?:import\s+[^"']+\s+)?from\s+["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
          // JS: import "/..."
          .replace(/((?:^|\n|;)\s*import\s+["'])\/(?!\/)/gm, `$1${pathPrefix}/${serverKey}/`)
          // JS: import("/...")
          .replace(/(import\s*\(\s*["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
          // JS: export * from "/..."
          .replace(/(export\s+\*\s+from\s+["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
          // JS: import.meta.glob("/...")
          .replace(/(import\.meta\.glob\s*\(\s*["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
          // JS: new URL("/...")
          .replace(/(new\s+URL\s*\(\s*["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`);
        
        res.setHeader('content-length', Buffer.byteLength(rewritten));
        res.send(rewritten);
      } else {
        // Pass through binary content
        const buffer = Buffer.from(await response.arrayBuffer());
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
