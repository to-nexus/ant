/**
 * BaseProxyMiddleware
 * 
 * Abstract base class for proxy middlewares (dev server, IDE).
 * Provides common proxy logic: port lookup, fetch with retry, header handling.
 */

import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { logger } from '../../../../utils/logger';
import { withRetry } from '../../../../core/utils/retry';

export interface BaseProxyConfig {
  portRegistry: PortRegistryPort;
  pathPrefix: string;  // e.g., '/dev' or '/ide'
  componentName: string;  // For logging, e.g., 'DevProxy' or 'IDEProxy'
}

export interface ServerKeyParts {
  tenantId: string;
  userId: string;
  projectId: string;
  feature?: string;  // Feature name (used by both IDE and dev server)
  serverKey: string;  // Full key for reference
}

export interface ProxyContext {
  req: Request;
  res: ExpressResponse;
  serverKeyParts: ServerKeyParts;
  targetPort: number;
  targetHost: string;  // 'localhost' for Docker, Pod IP for K8s
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
   * Get host for the given server key parts (default: localhost)
   * Override for K8s mode to return Pod IP
   */
  protected async getHost(_parts: ServerKeyParts): Promise<string> {
    return 'localhost';
  }

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
   * Whether to strip `${pathPrefix}/${serverKey}` from the URL before
   * forwarding upstream.
   *
   * Default true — dev/preview servers serve at root and require the prefix
   * stripped. IDE consumers that run openvscode-server with
   * `--server-base-path /ide/<key>` MUST override to false: openvscode-server
   * mounts every route under the base-path, so a stripped request lands on
   * an unmatched route and returns 500 / 404 for every static asset.
   */
  protected stripPrefix(): boolean {
    return true;
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

      // Temporarily promoted to warn so Datadog surfaces it during the
      // ide-groovy-cloud RCA (Signal A — raw request URL). Demote back to
      // debug once the integrated Case fix lands.
      logger.warn(`PROXY_REQUEST: ${req.method} ${req.url}`, { component: this.componentName });

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
          logger.warn(`No port found for ${serverKey}`, { component: this.componentName });
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

      // Get host (localhost for Docker, Pod IP for K8s)
      const host = await this.getHost(parts);

      // Path forwarded upstream. `stripPrefix()` decides whether
      // `${pathPrefix}/${serverKey}` is removed (dev / preview) or preserved
      // (IDE — openvscode-server requires its `--server-base-path` prefix on
      // every incoming request, see ideProxy.ts).
      const prefix = `${this.pathPrefix}/${serverKey}`;
      let targetPath = req.url;
      if (this.stripPrefix()) {
        while (targetPath.startsWith(prefix)) {
          targetPath = targetPath.slice(prefix.length) || '/';
        }
      }

      const context: ProxyContext = {
        req,
        res,
        serverKeyParts: parts,
        targetPort: port,
        targetHost: host,
        targetPath
      };

      await this.proxyRequest(context);
    };
  }

  /**
   * Proxy the request to the target server
   */
  protected async proxyRequest(context: ProxyContext): Promise<void> {
    const { req, res, targetPort, targetHost, targetPath } = context;
    const targetUrl = `http://${targetHost}:${targetPort}${targetPath}`;

    // Signal A (forwarded upstream URL) — temporarily promoted for the
    // ide-groovy-cloud RCA.
    logger.warn(`Proxy to ${targetUrl}`, { component: this.componentName });

    try {
      const method = (req.method || 'GET').toUpperCase();
      const hasRequestBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);

      // Retry only on transport-level errors (connect refused / reset / DNS / fetch
      // failed). Upstream 5xx responses are passed through verbatim — masking them
      // with retries would hide genuine code-server failures that the readinessProbe
      // is supposed to surface.
      const response = await withRetry<globalThis.Response>(
        () => fetch(targetUrl, {
          method: req.method,
          headers: {
            ...req.headers,
            host: `${targetHost}:${targetPort}`,
            'accept-encoding': 'identity',
            'if-none-match': undefined,
            'if-modified-since': undefined
          } as any,
          ...(hasRequestBody ? { body: req as any, duplex: 'half' as any } : {})
        }),
        {
          maxAttempts: 6,
          initialDelayMs: 250,
          maxDelayMs: 2500,
          backoffMultiplier: 2,
          shouldRetry: (err) => {
            const msg = ((err as Error)?.message || '').toLowerCase();
            return (
              msg.includes('econnrefused') ||
              msg.includes('econnreset') ||
              msg.includes('socket') ||
              msg.includes('fetch failed') ||
              msg.includes('network') ||
              msg.includes('terminated')
            );
          },
        }
      );

      const contentType = response.headers.get('content-type') || '';
      // Signal B (upstream HTTP status) — temporarily promoted for the
      // ide-groovy-cloud RCA so Datadog captures whether openvscode-server
      // is responding 200 / 404 / 500 to each forwarded request.
      logger.warn(`Upstream response: ${response.status} (${contentType})`, { component: this.componentName });

      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        const lower = key.toLowerCase();
        if (['etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) return;
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(lower)) return;
        if (lower === 'x-frame-options') return;
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
