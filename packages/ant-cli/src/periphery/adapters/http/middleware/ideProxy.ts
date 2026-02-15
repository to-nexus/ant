/**
 * IDEProxyMiddleware
 * 
 * Express middleware to proxy IDE requests.
 * Dynamically routes /ide/:serverKey/* to the appropriate port.
 * 
 * IDE uses feature-level serverKey (4-part):
 * /ide/tenantId:userId:projectId:feature → localhost:32500+
 * 
 * Example:
 * /ide/to.nexus:probe:sketch:skeleton → localhost:32500
 * /ide/to.nexus:probe:sketch:skeleton/?folder=/workspace → localhost:32500/?folder=/workspace
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
   * Parse serverKey: tenantId:userId:projectId:feature (4 parts)
   * Format: org:user:project:feature
   * Example: to.nexus:probe:sketch:skeleton
   */
  protected parseServerKey(serverKey: string): ServerKeyParts | null {
    // Use centralized parsing function for IDE instance key (4-part)
    const parsed = parseIDEKey(serverKey);
    if (!parsed) {
      return null;
    }

    return {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      projectId: parsed.projectId,
      feature: parsed.feature || 'main',
      serverKey
    };
  }

  protected async getPort(parts: ServerKeyParts): Promise<number | null> {
    return this.portRegistry.getIDEPort(
      parts.tenantId,
      parts.userId,
      parts.projectId,
      parts.feature
    );
  }

  /**
   * Get host for IDE (localhost for Docker, Pod IP for K8s)
   */
  protected async getHost(parts: ServerKeyParts): Promise<string> {
    try {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const stateStore = getInfrastructureFactory().getStateStore();
      const mapping = await stateStore.getIDE(
        parts.tenantId,
        parts.userId,
        parts.projectId,
        parts.feature
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
    await this.portRegistry.touchIDE(
      parts.tenantId,
      parts.userId,
      parts.projectId,
      parts.feature
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

    const { tenantId, userId, projectId, feature } = parsed;
    const featureName = feature || 'main';

    // Lookup port and host (IDE is feature-level)
    const port = await portRegistry.getIDEPort(tenantId, userId, projectId, featureName);
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
      const mapping = await stateStore.getIDE(tenantId, userId, projectId, featureName);
      if (mapping?.host) {
        host = mapping.host;
        logger.debug(`WS Host from StateStore: ${host}`, { component: 'IDEProxy' });
      }
    } catch (err) {
      logger.warn(`WS Failed to get IDE host: ${err}`, { component: 'IDEProxy' });
    }

    // Update last access (IDE is feature-level)
    await portRegistry.touchIDE(tenantId, userId, projectId, featureName);

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
