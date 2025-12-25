/**
 * DevServerProxyMiddleware
 * 
 * Express middleware to proxy dev server requests.
 * Dynamically routes /dev/:serverKey to the appropriate port.
 * 
 * Example:
 * /dev/alice:todo-app:feature-login → localhost:30001
 */

import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { PortRegistryPort } from '../../../core/ports/portRegistry';

export interface DevServerProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '/dev'
}

/**
 * Create dev server proxy middleware
 */
export function createDevServerProxyMiddleware(config: DevServerProxyConfig) {
  const { portRegistry, pathPrefix = '/dev' } = config;
  
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only handle paths starting with /dev/
    if (!req.path.startsWith(`${pathPrefix}/`)) {
      return next();
    }
    
    // Extract serverKey from path: /dev/tenantId:userId:projectId:feature
    const pathParts = req.path.substring(pathPrefix.length + 1).split('/');
    const serverKey = pathParts[0];
    
    if (!serverKey) {
      return res.status(404).json({
        error: 'Server key not provided',
        message: `Usage: ${pathPrefix}/:serverKey`
      });
    }
    
    // Parse serverKey: tenantId:userId:projectId:feature
    const parts = serverKey.split(':');
    if (parts.length < 4) {
      return res.status(400).json({
        error: 'Invalid server key format',
        message: 'Expected format: tenantId:userId:projectId:feature',
        received: serverKey
      });
    }
    
    const [tenantId, userId, projectId, ...featureParts] = parts;
    const feature = featureParts.join(':');
    
    // Lookup port from registry
    let port: number | null;
    try {
      port = await portRegistry.getDevServerPort(tenantId, userId, projectId, feature);
      
      if (!port) {
        return res.status(404).json({
          error: 'Dev server not found',
          message: `No dev server running for ${serverKey}`,
          serverKey
        });
      }
      
      // Update last access time
      await portRegistry.updateLastAccess(tenantId, userId, projectId, feature, 'dev-server');
      
    } catch (error) {
      console.error('[DevServerProxy] Failed to lookup port:', error);
      return res.status(500).json({
        error: 'Failed to lookup dev server port',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    console.log(`[DevServerProxy] ${serverKey} → localhost:${port}`);
    
    // Create proxy middleware dynamically
    const proxy = createProxyMiddleware({
      target: `http://localhost:${port}`,
      changeOrigin: true,
      ws: true,  // WebSocket support for HMR
      pathRewrite: {
        [`^${pathPrefix}/${serverKey}`]: ''  // Remove /dev/xxx prefix
      },
      onError: (err, req, res) => {
        console.error(`[DevServerProxy] Proxy error for ${serverKey}:`, err);
        if (res instanceof Response && !res.headersSent) {
          res.status(502).json({
            error: 'Bad Gateway',
            message: `Failed to connect to dev server on port ${port}`,
            details: err.message
          });
        }
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`[DevServerProxy] → ${req.method} ${req.path} → localhost:${port}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`[DevServerProxy] ← ${proxyRes.statusCode} ${req.path}`);
      }
    } as Options);
    
    // Execute proxy
    return proxy(req, res, next);
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

