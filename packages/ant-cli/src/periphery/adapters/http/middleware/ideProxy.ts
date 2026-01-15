/**
 * IDEProxyMiddleware
 * 
 * Express middleware to proxy IDE requests.
 * Dynamically routes /ide/:serverKey/* to the appropriate port.
 * 
 * Unlike DevServerProxy, IDE uses project-level serverKey (no feature):
 * /ide/tenantId:userId:projectId → localhost:32500+
 * 
 * Example:
 * /ide/alice:org:todo-app → localhost:32500
 * /ide/alice:org:todo-app/?folder=/todo-app → localhost:32500/?folder=/todo-app
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import httpProxy from 'http-proxy';
import { 
  BaseProxyMiddleware, 
  BaseProxyConfig, 
  ServerKeyParts 
} from './baseProxy';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';

export interface IDEProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix?: string;  // Default: '/ide'
}

/**
 * IDE Proxy implementation
 */
class IDEProxyMiddlewareImpl extends BaseProxyMiddleware {
  constructor(config: IDEProxyConfig) {
    super({
      portRegistry: config.portRegistry,
      pathPrefix: config.pathPrefix || '/ide',
      componentName: 'IDEProxy'
    });
  }

  /**
   * Parse serverKey: tenantId:userId:projectId (3 parts)
   * Format: org:user:project
   * Example: to.nexus:probe:ant-ogf
   * 
   * Note: IDE is project-level (not feature-level like dev server)
   */
  protected parseServerKey(serverKey: string): ServerKeyParts | null {
    const parts = serverKey.split(':');
    // IDE serverKey: tenantId:userId:projectId (exactly 3 parts)
    if (parts.length !== 3) {
      return null;
    }

    const [tenantId, userId, projectId] = parts;
    return {
      tenantId,
      userId,
      projectId,
      feature: 'main',  // IDE always uses 'main' (project-level)
      serverKey
    };
  }

  protected async getPort(parts: ServerKeyParts): Promise<number | null> {
    return this.portRegistry.getIDEPort(
      parts.tenantId,
      parts.userId,
      parts.projectId,
      parts.feature || 'main'
    );
  }

  protected async updateLastAccess(parts: ServerKeyParts): Promise<void> {
    await this.portRegistry.updateLastAccess(
      parts.tenantId,
      parts.userId,
      parts.projectId,
      parts.feature || 'main',
      'ide'
    );
  }

  protected getRegistryType(): 'dev-server' | 'ide' {
    return 'ide';
  }

  /**
   * IDE doesn't need content rewriting - it's a self-contained app
   */
  protected shouldRewriteContent(): boolean {
    return false;
  }
}

/**
 * Create IDE proxy middleware
 */
export function createIDEProxyMiddleware(config: IDEProxyConfig) {
  const proxy = new IDEProxyMiddlewareImpl(config);
  return proxy.createMiddleware();
}

/**
 * Create IDE WebSocket proxy (for live reload, terminal, etc.)
 * IDE (code-server/openvscode) uses WebSocket for terminal and live features
 */
export function createIDEWebSocketHandler(portRegistry: PortRegistryPort, pathPrefix: string = '/ide') {
  // Create a proxy server for WebSocket
  const proxy = httpProxy.createProxyServer({
    ws: true,
    changeOrigin: true
  });
  
  proxy.on('error', (err: Error, _req: any, socket: any) => {
    logger.warn(`WS proxy error: ${err.message}`, { component: 'IDEProxy' });
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  });

  return async (req: Request, socket: any, head: Buffer) => {
    const url = req.url || '';
    
    // Only handle paths starting with our prefix
    if (!url.startsWith(`${pathPrefix}/`)) {
      socket.destroy();
      return;
    }

    logger.debug(`WS upgrade: ${url}`, { component: 'IDEProxy' });

    // Extract serverKey
    const pathWithoutPrefix = url.substring(pathPrefix.length + 1);
    const firstSlashIndex = pathWithoutPrefix.indexOf('/');
    const serverKey = firstSlashIndex === -1 
      ? pathWithoutPrefix.split('?')[0]
      : pathWithoutPrefix.substring(0, firstSlashIndex);

    if (!serverKey) {
      socket.destroy();
      return;
    }

    // Parse serverKey: org:user:project (3 parts) - IDE is project-level
    const parts = serverKey.split(':');
    if (parts.length !== 3) {
      socket.destroy();
      return;
    }

    const [tenantId, userId, projectId] = parts;
    const feature = 'main';  // IDE always uses 'main' (project-level)

    // Lookup port
    const port = await portRegistry.getIDEPort(tenantId, userId, projectId, feature);
    if (!port) {
      logger.warn(`No IDE port for WS: ${serverKey}`, { component: 'IDEProxy' });
      socket.destroy();
      return;
    }

    // Update last access
    await portRegistry.updateLastAccess(tenantId, userId, projectId, feature, 'ide');

    // Rewrite the URL to strip the prefix and serverKey
    const targetPath = url.slice(`${pathPrefix}/${serverKey}`.length) || '/';
    req.url = targetPath;
    
    logger.debug(`WS proxy to localhost:${port}${targetPath}`, { component: 'IDEProxy' });

    // Proxy the WebSocket connection
    proxy.ws(req, socket, head, {
      target: `ws://localhost:${port}`
    });
  };
}
