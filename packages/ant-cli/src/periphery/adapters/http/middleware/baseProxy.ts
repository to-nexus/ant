/**
 * BaseProxyMiddleware
 * 
 * Abstract base class for proxy middlewares (dev server, IDE).
 * Provides common proxy logic: port lookup, fetch with retry, header handling.
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';

export interface BaseProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix: string;  // e.g., '/dev' or '/ide'
  componentName: string;  // For logging, e.g., 'DevProxy' or 'IDEProxy'
}

export interface ServerKeyParts {
  tenantId: string;
  userId: string;
  projectId: string;
  feature?: string;  // Optional for IDE (project-level only)
  serverKey: string;  // Full key for reference
}

export interface ProxyContext {
  req: Request;
  res: ExpressResponse;
  serverKeyParts: ServerKeyParts;
  targetPort: number;
  targetPath: string;
}

/**
 * Abstract base proxy middleware factory
 */
export abstract class BaseProxyMiddleware {
  protected readonly portRegistry: PortRegistryPort;
  protected readonly pathPrefix: string;
  protected readonly componentName: string;

  constructor(config: BaseProxyConfig) {
    this.portRegistry = config.portRegistry;
    this.pathPrefix = config.pathPrefix;
    this.componentName = config.componentName;
  }

  /**
   * Parse serverKey from path. Override for different formats.
   * @returns ServerKeyParts or null if invalid
   */
  protected abstract parseServerKey(serverKey: string): ServerKeyParts | null;

  /**
   * Get port for the given server key parts
   */
  protected abstract getPort(parts: ServerKeyParts): Promise<number | null>;

  /**
   * Update last access time for the service
   */
  protected abstract updateLastAccess(parts: ServerKeyParts): Promise<void>;

  /**
   * Get the registry type ('dev-server' or 'ide')
   */
  protected abstract getRegistryType(): 'dev-server' | 'ide';

  /**
   * Whether to rewrite content (HTML/JS/CSS path prefixing)
   * Dev server needs this, IDE doesn't
   */
  protected shouldRewriteContent(): boolean {
    return false;
  }

  /**
   * Optional: Rewrite response content. Override if needed.
   */
  protected rewriteContent(
    _text: string, 
    _contentType: string, 
    _context: ProxyContext
  ): string {
    return _text;  // No-op by default
  }

  /**
   * Create the middleware function
   */
  createMiddleware(): (req: Request, res: ExpressResponse, next: NextFunction) => Promise<void> {
    return async (req: Request, res: ExpressResponse, next: NextFunction) => {
      // Only handle paths starting with our prefix
      if (!req.path.startsWith(`${this.pathPrefix}/`)) {
        return next();
      }

      logger.debug(`${req.method} ${req.url}`, { component: this.componentName });

      // Extract serverKey from path
      const url = req.url.split('?')[0];
      const pathWithoutPrefix = url.substring(this.pathPrefix.length + 1);
      const firstSlashIndex = pathWithoutPrefix.indexOf('/');
      const serverKey = firstSlashIndex === -1 
        ? pathWithoutPrefix 
        : pathWithoutPrefix.substring(0, firstSlashIndex);

      if (!serverKey) {
        logger.warn('No serverKey', { component: this.componentName });
        res.status(404).json({
          error: 'Server key not provided',
          message: `Usage: ${this.pathPrefix}/:serverKey`
        });
        return;
      }

      logger.debug(`serverKey=${serverKey}`, { component: this.componentName });

      // Parse serverKey
      const parts = this.parseServerKey(serverKey);
      if (!parts) {
        logger.warn(`Invalid serverKey format: ${serverKey}`, { component: this.componentName });
        res.status(400).json({
          error: 'Invalid server key format',
          message: `Invalid server key: ${serverKey}`,
          received: serverKey
        });
        return;
      }

      logger.debug(`Parsed: ${JSON.stringify(parts)}`, { component: this.componentName });

      // Lookup port
      let port: number | null;
      try {
        port = await this.getPort(parts);

        if (!port) {
          logger.info(`No port found for ${serverKey}`, { component: this.componentName });
          res.status(404).json({
            error: `${this.getRegistryType()} not found`,
            message: `No ${this.getRegistryType()} running for ${serverKey}`,
            serverKey
          });
          return;
        }

        logger.debug(`Port found: ${port}`, { component: this.componentName });

        // Update last access time
        await this.updateLastAccess(parts);

      } catch (error) {
        logger.error('Port lookup error', { component: this.componentName }, error);
        res.status(500).json({
          error: `Failed to lookup ${this.getRegistryType()} port`,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        return;
      }

      // Strip prefix from path
      const prefix = `${this.pathPrefix}/${serverKey}`;
      let targetPath = req.url;
      while (targetPath.startsWith(prefix)) {
        targetPath = targetPath.slice(prefix.length) || '/';
      }

      const context: ProxyContext = {
        req,
        res,
        serverKeyParts: parts,
        targetPort: port,
        targetPath
      };

      await this.proxyRequest(context);
    };
  }

  /**
   * Proxy the request to the target server
   */
  protected async proxyRequest(context: ProxyContext): Promise<void> {
    const { req, res, targetPort, targetPath } = context;
    const targetUrl = `http://localhost:${targetPort}${targetPath}`;

    logger.debug(`Proxy to ${targetUrl}`, { component: this.componentName });

    try {
      // Retry logic for server startup race condition
      let response: globalThis.Response | null = null;
      let lastError: Error | null = null;
      const maxRetries = 3;
      const retryDelay = 500;
      const method = (req.method || 'GET').toUpperCase();
      const hasRequestBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await fetch(targetUrl, {
            method: req.method,
            headers: {
              ...req.headers,
              host: `localhost:${targetPort}`,
              'accept-encoding': 'identity',
              'if-none-match': undefined,
              'if-modified-since': undefined
            } as any,
            ...(hasRequestBody ? { body: req as any, duplex: 'half' as any } : {})
          });
          break;
        } catch (error: any) {
          lastError = error;
          if (attempt < maxRetries) {
            logger.debug(`Retry ${attempt}/${maxRetries} in ${retryDelay}ms`, { component: this.componentName });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to connect after retries');
      }

      const contentType = response.headers.get('content-type') || '';
      logger.debug(`Upstream response: ${response.status} (${contentType})`, { component: this.componentName });

      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        const lower = key.toLowerCase();
        if (['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) return;
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
        res.setHeader(key, value);
      });

      res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');

      // Check if content needs rewriting
      const needsRewrite = this.shouldRewriteContent() && (
        contentType.includes('text/html') || 
        contentType.includes('javascript') || 
        contentType.includes('text/javascript') ||
        contentType.includes('application/javascript') ||
        contentType.includes('text/css')
      );

      if (needsRewrite) {
        const text = await response.text();
        logger.debug(`Rewriting ${text.length} bytes`, { component: this.componentName });
        const rewritten = this.rewriteContent(text, contentType, context);
        res.setHeader('content-length', Buffer.byteLength(rewritten));
        res.send(rewritten);
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader('content-length', buffer.length);
        res.send(buffer);
      }
    } catch (error: any) {
      logger.error(`Fetch error: ${error.message}`, { component: this.componentName });
      res.status(502).json({
        error: 'Bad Gateway',
        message: `Failed to connect to ${this.getRegistryType()} on port ${context.targetPort}`,
        details: error.message
      });
    }
  }
}
