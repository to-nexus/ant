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
import { parseIDEKey } from '../../../../infrastructure/state/redisKeyUtils';

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
    // Use centralized parsing function for IDE instance key
    const parsed = parseIDEKey(serverKey);
    if (!parsed) {
      return null;
    }

    return {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      projectId: parsed.projectId,
      // IDE is project-level, no feature
      serverKey
    };
  }

  protected async getPort(parts: ServerKeyParts): Promise<number | null> {
    // IDE is project-level, no feature
    return this.portRegistry.getIDEPort(
      parts.tenantId,
      parts.userId,
      parts.projectId
    );
  }

  /**
   * Get host for IDE (localhost for Docker, Pod IP for K8s)
   */
  protected async getHost(parts: ServerKeyParts): Promise<string> {
    try {
      // Use StateStorePort to get full PortMapping with host
      // IDE is project-level, no feature
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const stateStore = getInfrastructureFactory().getStateStore();
      const mapping = await stateStore.getIDE(
        parts.tenantId,
        parts.userId,
        parts.projectId
      );
      
      if (mapping?.host) {
        logger.debug(`Host from StateStore: ${mapping.host}`, { component: 'IDEProxy' });
        return mapping.host;
      }
    } catch (err) {
      logger.warn(`Failed to get IDE host from StateStore: ${err}`, { component: 'IDEProxy' });
    }
    
    logger.debug(`Falling back to localhost`, { component: 'IDEProxy' });
    return 'localhost';
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

    // Use centralized parsing function for IDE instance key
    const parsed = parseIDEKey(serverKey);
    if (!parsed) {
      logger.warn(`Invalid IDE serverKey format for WS: ${serverKey}`, { component: 'IDEProxy' });
      socket.destroy();
      return;
    }

    const { tenantId, userId, projectId } = parsed;

    // Lookup port and host (IDE is project-level, no feature)
    const port = await portRegistry.getIDEPort(tenantId, userId, projectId);
    if (!port) {
      logger.warn(`No IDE port for WS: ${serverKey}`, { component: 'IDEProxy' });
      socket.destroy();
      return;
    }

    // Get host (localhost for Docker, Pod IP for K8s)
    let host = 'localhost';
    try {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const stateStore = getInfrastructureFactory().getStateStore();
      const mapping = await stateStore.getIDE(tenantId, userId, projectId);
      if (mapping?.host) {
        host = mapping.host;
        logger.debug(`WS Host from StateStore: ${host}`, { component: 'IDEProxy' });
      }
    } catch (err) {
      logger.warn(`WS Failed to get IDE host: ${err}`, { component: 'IDEProxy' });
    }

    // Update last access (IDE is project-level, feature ignored)
    await portRegistry.updateLastAccess(tenantId, userId, projectId, '', 'ide');

    // Rewrite the URL to strip the prefix and serverKey
    const targetPath = url.slice(`${pathPrefix}/${serverKey}`.length) || '/';
    req.url = targetPath;
    
    logger.debug(`WS proxy to ${host}:${port}${targetPath}`, { component: 'IDEProxy' });

    // Proxy the WebSocket connection
    proxy.ws(req, socket, head, {
      target: `ws://${host}:${port}`
    });
  };
}
