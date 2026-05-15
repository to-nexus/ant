/**
 * proxyForwarding — shared helpers for preview / deploy reverse proxies.
 *
 * Two proxies (`previewProxy.ts` and `PreviewServer.createDeployProxyMiddleware`)
 * forward HTTP traffic to per-project upstream Node servers. They must speak
 * the same contract so that:
 *
 *   - Next.js App Router RSC navigation works (RSC, Next-Router-State-Tree,
 *     Next-Url, Next-Router-Prefetch headers must survive the hop).
 *   - Auth flows (cookies, NextAuth callbacks, redirect URIs) compute correct
 *     external URLs (X-Forwarded-Host/Proto/Port).
 *   - POST/PUT/PATCH/DELETE bodies stream upstream, not silently dropped.
 *   - Set-Cookie Path and Location headers are rewritten to include the
 *     externally-visible basePath when the upstream emits a bare `/path`.
 *
 * This module owns the contract. `BaseProxyMiddleware` (dev/IDE) implements
 * the same intent in a class shape — kept separate to avoid a 4-way refactor.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { Readable } from 'stream';

/**
 * Hop-by-hop headers (RFC 7230 §6.1) and a couple of conditional-request
 * headers we deliberately strip so upstream always sees a fresh GET.
 */
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'if-none-match',
  'if-modified-since',
]);

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ForwardingContext {
  externalHost?: string;
  externalProto?: string;
  externalClientIp?: string;
  externalPort?: string;
}

/**
 * Resolve the externally-visible request context from an Express Request.
 * Honors existing `X-Forwarded-*` (set by an upstream reverse proxy / ingress)
 * and falls back to the immediate request.
 */
export function extractForwardingContext(req: Request): ForwardingContext {
  const hdr = (name: string): string | undefined => {
    const v = req.headers[name];
    if (Array.isArray(v)) return v[0];
    return typeof v === 'string' ? v : undefined;
  };

  const forwardedHost = hdr('x-forwarded-host') || hdr('host') || undefined;
  const forwardedProto =
    hdr('x-forwarded-proto') ||
    (typeof req.protocol === 'string' && req.protocol ? req.protocol : undefined);
  const forwardedFor = hdr('x-forwarded-for') || (req.ip ? req.ip : undefined);
  const forwardedPort = hdr('x-forwarded-port') || undefined;

  return {
    externalHost: forwardedHost,
    externalProto: forwardedProto,
    externalClientIp: forwardedFor,
    externalPort: forwardedPort,
  };
}

/**
 * Build the headers for an upstream fetch.
 *
 *   - Drop hop-by-hop and conditional headers.
 *   - Drop non-string values (Node's headers can hold arrays/undefined for
 *     repeated names — fetch's `headers` init rejects those shapes).
 *   - Override `host` so the upstream sees its own bind address.
 *   - Force `accept-encoding: identity` so the upstream doesn't compress
 *     (we re-stream the raw bytes and can't repackage gzip on the fly).
 *   - Inject X-Forwarded-* when a context is supplied, preserving values
 *     already set by an upstream proxy.
 */
export function buildCleanHeaders(
  req: Request,
  targetHost: string,
  targetPort: number,
  ctx?: ForwardingContext,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value !== 'string') continue;
    headers[key] = value;
  }

  headers['host'] = `${targetHost}:${targetPort}`;
  headers['accept-encoding'] = 'identity';

  if (ctx) {
    if (ctx.externalHost && !headers['x-forwarded-host']) {
      headers['x-forwarded-host'] = ctx.externalHost;
    }
    if (ctx.externalProto && !headers['x-forwarded-proto']) {
      headers['x-forwarded-proto'] = ctx.externalProto;
    }
    if (ctx.externalClientIp && !headers['x-forwarded-for']) {
      headers['x-forwarded-for'] = ctx.externalClientIp;
    }
    if (ctx.externalPort && !headers['x-forwarded-port']) {
      headers['x-forwarded-port'] = ctx.externalPort;
    }
  }

  return headers;
}

/**
 * fetch body init for the upstream call. Returns `{ body, duplex }` for
 * methods that may carry a body, `{}` otherwise.
 *
 * Note: Express's `Request` is a Node Readable, which undici accepts as a
 * fetch body — but its TS types don't overlap with the WHATWG `BodyInit`
 * union, so the return is typed loosely and spread into the `fetch` init at
 * the call site:
 *
 *   fetch(url, { method, headers, ...forwardRequestBody(req) })
 */
export function forwardRequestBody(req: Request): Record<string, unknown> {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return {};
  // undici streaming-request requires duplex: 'half' when body is a Readable.
  return { body: req, duplex: 'half' };
}

/**
 * Rewrite a single Set-Cookie string so that its `Path` attribute is
 * prefixed with `basePath`. Idempotent — if Path already starts with
 * `basePath`, the cookie is returned unchanged.
 *
 *   - `name=val`                        → `name=val; Path=<basePath>`
 *   - `name=val; Path=/`                → `name=val; Path=<basePath>`
 *   - `name=val; Path=/foo`             → `name=val; Path=<basePath>/foo`
 *   - `name=val; Path=<basePath>/foo`   → unchanged
 */
export function rewriteSetCookiePath(cookie: string, basePath: string): string {
  const parts = cookie.split(';').map((p) => p.trim());
  const pathIdx = parts.findIndex((p) => /^path\s*=/i.test(p));

  if (pathIdx === -1) {
    // No Path attribute — append one so the cookie is scoped to this deploy.
    return `${cookie}; Path=${basePath}`;
  }

  const eq = parts[pathIdx].indexOf('=');
  const currentPath = parts[pathIdx].slice(eq + 1).trim();

  if (currentPath.startsWith(basePath)) return cookie; // already scoped

  // Treat `Path=/` as the document root → just use basePath.
  // Otherwise compose basePath + currentPath (currentPath always starts with `/`
  // in well-formed cookies; if it doesn't, leave the cookie alone to avoid
  // generating an invalid value).
  if (!currentPath.startsWith('/')) return cookie;

  const newPath = currentPath === '/' ? basePath : `${basePath}${currentPath}`;
  parts[pathIdx] = `Path=${newPath}`;
  return parts.join('; ');
}

/**
 * Rewrite a Location header value so that paths internal to the upstream
 * are exposed externally under `basePath`.
 *
 *   - relative path `/foo`        → `<basePath>/foo`
 *   - already-prefixed `<basePath>/foo` → unchanged
 *   - `http://<upstreamHost>/foo` → `<basePath>/foo` (host-relative form;
 *     browser resolves against the current page so external host is
 *     preserved automatically — this avoids leaking the internal host name)
 *   - external absolute URL (e.g. https://accounts.google.com/...)  → unchanged
 *     (OAuth provider redirects must not be touched)
 */
export function rewriteLocation(
  location: string,
  basePath: string,
  upstreamHost: string,
): string {
  if (!location) return location;

  // Relative URL — keep it host-relative so the browser stays on the external
  // origin. Only inject basePath when missing.
  if (location.startsWith('/') && !location.startsWith('//')) {
    if (location.startsWith(`${basePath}/`) || location === basePath) return location;
    return `${basePath}${location}`;
  }

  // Try parsing as absolute URL.
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    // Not a URL we recognize (e.g. relative `?foo=1`, `#anchor`) — leave alone.
    return location;
  }

  // Match against the internal upstream host (e.g. "127.0.0.1:30001"). If the
  // upstream returned an absolute URL pointing at itself, collapse to a
  // host-relative form under basePath. Otherwise leave external URLs alone.
  const upstreamMatch =
    parsed.host === upstreamHost ||
    parsed.host === `localhost:${upstreamHost.split(':')[1]}` ||
    parsed.host === `127.0.0.1:${upstreamHost.split(':')[1]}`;

  if (!upstreamMatch) return location;

  const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (pathAndQuery.startsWith(`${basePath}/`) || pathAndQuery === basePath) return pathAndQuery;
  return `${basePath}${pathAndQuery}`;
}

export interface StreamResponseOptions {
  /**
   * External basePath under which this deploy/preview is exposed. When set,
   * Set-Cookie Path and Location headers are rewritten so external clients
   * see the correct paths.
   */
  basePath?: string;

  /**
   * Internal upstream `host:port` — used to detect absolute Location URLs
   * that point at the upstream itself.
   */
  upstreamHost?: string;

  /**
   * Additional response headers to strip (in addition to the hop-by-hop and
   * caching defaults). Lowercased.
   */
  stripResponseHeaders?: ReadonlySet<string>;

  /**
   * Force Cache-Control on the downstream response (overrides anything
   * upstream emitted). Preview uses this to guarantee no client-side cache
   * of dev-server output.
   */
  cacheControl?: string;

  /**
   * Additional Set-Cookie strings to emit alongside whatever the upstream
   * returned (e.g. the preview routing cookie `__ant_preview_sk`). Appended
   * verbatim — the caller is responsible for the cookie's own Path/Domain.
   */
  extraSetCookies?: string[];
}

const DEFAULT_STRIPPED_RESPONSE_HEADERS = new Set([
  'etag',
  'if-none-match',
  'if-modified-since',
  'last-modified',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

/**
 * Copy headers + status from a fetch Response onto an Express Response and
 * stream the body. Applies Set-Cookie / Location rewriting when `basePath`
 * is supplied.
 *
 * Side effects: writes status + headers via `res.status` / `res.setHeader`,
 * pipes the response body, and ends the response. The caller does NOT need
 * to call `res.end` afterwards.
 */
export async function streamUpstreamResponse(
  response: globalThis.Response,
  res: ExpressResponse,
  opts: StreamResponseOptions = {},
): Promise<void> {
  const { basePath, upstreamHost, stripResponseHeaders, cacheControl, extraSetCookies } = opts;

  res.status(response.status);

  // Set-Cookie needs special handling: a fetch Response can carry multiple
  // Set-Cookie headers and the only correct accessor that preserves all of
  // them is `getSetCookie()` (undici / WHATWG).
  const upstreamCookies =
    typeof (response.headers as any).getSetCookie === 'function'
      ? ((response.headers as any).getSetCookie() as string[])
      : [];

  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return; // handled below
    if (lower === 'cache-control' && cacheControl) return; // overridden below
    if (DEFAULT_STRIPPED_RESPONSE_HEADERS.has(lower)) return;
    if (stripResponseHeaders?.has(lower)) return;

    if (lower === 'location' && basePath && upstreamHost) {
      res.setHeader(key, rewriteLocation(value, basePath, upstreamHost));
      return;
    }

    res.setHeader(key, value);
  });

  const cookiesOut: string[] = [];
  if (upstreamCookies.length > 0) {
    cookiesOut.push(
      ...(basePath
        ? upstreamCookies.map((c) => rewriteSetCookiePath(c, basePath))
        : upstreamCookies),
    );
  }
  if (extraSetCookies && extraSetCookies.length > 0) {
    cookiesOut.push(...extraSetCookies);
  }
  if (cookiesOut.length > 0) {
    res.setHeader('Set-Cookie', cookiesOut);
  }

  if (cacheControl) {
    res.setHeader('cache-control', cacheControl);
  }

  // content-length stripped because we may stream chunked.
  res.removeHeader('content-length');

  if (response.body) {
    const nodeStream = Readable.fromWeb(response.body as any);
    nodeStream.pipe(res);
  } else {
    res.end();
  }
}
