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
   * Note: For IDE, we use a fixed feature 'main' internally
   */
  protected parseServerKey(serverKey: string): ServerKeyParts | null {
    const parts = serverKey.split(':');
    // IDE serverKey: tenantId:userId:projectId (3 parts minimum)
    if (parts.length < 3) {
      return null;
    }

    const [tenantId, userId, ...projectParts] = parts;
    // Handle projectId that might contain colons
    const projectId = projectParts.join(':');

    return {
      tenantId,
      userId,
      projectId,
      feature: 'main',  // IDE always uses 'main' feature internally
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

    // Parse serverKey
    const parts = serverKey.split(':');
    if (parts.length < 3) {
      socket.destroy();
      return;
    }

    const [tenantId, userId, ...projectParts] = parts;
    const projectId = projectParts.join(':');

    // Lookup port
    const port = await portRegistry.getIDEPort(tenantId, userId, projectId, 'main');
    if (!port) {
      logger.warn(`No IDE port for WS: ${serverKey}`, { component: 'IDEProxy' });
      socket.destroy();
      return;
    }

    // Update last access
    await portRegistry.updateLastAccess(tenantId, userId, projectId, 'main', 'ide');

    // Create upstream WebSocket connection
    const targetPath = url.slice(`${pathPrefix}/${serverKey}`.length) || '/';
    const targetUrl = `ws://localhost:${port}${targetPath}`;
    
    logger.debug(`WS proxy to ${targetUrl}`, { component: 'IDEProxy' });

    const WebSocket = require('ws');
    const upstream = new WebSocket(targetUrl, {
      headers: {
        ...req.headers,
        host: `localhost:${port}`
      }
    });

    upstream.on('open', () => {
      // Upgrade the client connection
      const clientWs = new WebSocket(null);
      clientWs.setSocket(socket, head, {
        maxPayload: 100 * 1024 * 1024 // 100MB
      });

      // Pipe data between client and upstream
      clientWs.on('message', (data: any) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data);
        }
      });

      upstream.on('message', (data: any) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      clientWs.on('close', () => upstream.close());
      upstream.on('close', () => clientWs.close());

      clientWs.on('error', () => upstream.close());
      upstream.on('error', () => clientWs.close());
    });

    upstream.on('error', (err: Error) => {
      logger.warn(`WS upstream error: ${err.message}`, { component: 'IDEProxy' });
      socket.destroy();
    });
  };
}
