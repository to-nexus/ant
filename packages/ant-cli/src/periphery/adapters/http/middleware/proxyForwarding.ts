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
import { withRetry } from '../../../../core/utils/retry';

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

/**
 * Parse a raw `Cookie` request header into a name→value map. Used by the
 * deploy proxy (HTTP gate) and the WS upgrade gate, both of which run BEFORE
 * `cookie-parser`, so they cannot rely on `req.cookies`.
 */
export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }),
  );
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
 * True when the request targets a framework dev-resource endpoint subject to
 * cross-origin dev-resource protection — Next.js `/_next` (chunks, HMR) and
 * `/__nextjs` (middleware). The prefix match survives the preview basePath
 * (`/{urlKey}/_next/…`) because we test `includes`, mirroring Next's own
 * `isInternalEndpoint`. App routes, API, and Server Actions are NOT dev
 * resources, so their `Origin` is left untouched.
 */
export function isDevResourceRequest(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('/_next') || url.includes('/__nextjs');
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
 *   - For internal dev-resource requests (`/_next`, `/__nextjs`), rewrite
 *     `Origin` to the dev server's trusted self-origin (`localhost`) — see
 *     `isDevResourceRequest`.
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

  // A dev server (Next 16, Vite, …) 403s its OWN dev resources when the
  // forwarded `Origin` is not its trusted self-origin. Next's block applies
  // ONLY to internal endpoints (`/_next`, `/__nextjs`) and trusts the literal
  // hostname `localhost` — not the public preview host, not a pod IP, not even
  // `127.0.0.1`. Scoping the rewrite to those paths leaves app routes / API /
  // Server Actions (which POST to page routes, never `/_next`) on their real
  // `Origin`, so production CSRF is unaffected. Only rewrite a present Origin.
  if (headers['origin'] !== undefined && isDevResourceRequest(req.url)) {
    headers['origin'] = `http://localhost:${targetPort}`;
  }

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
 * Bind an AbortController to the inbound request's lifecycle so the upstream
 * fetch is canceled when the client disconnects. Spread into the fetch init:
 *
 *   fetch(url, { method, headers, ...forwardRequestBody(req), ...forwardRequestAbort(req) })
 *
 * Critical for long-lived responses (SSE, large downloads): without this the
 * upstream connection leaks past the client's disconnect until undici's idle
 * timeout fires. Short-lived requests are unaffected since the response
 * completes before the client can typically abort.
 *
 * The listener is attached with `once`; if the request completes normally,
 * `close` fires after the response is sent and the resulting abort is a no-op
 * (signal is consumed by no one).
 */
export function forwardRequestAbort(req: Request): { signal: AbortSignal } {
  const controller = new AbortController();
  // Plain-object test mocks may not extend EventEmitter — feature-detect so
  // unit tests don't have to wire up a real `req` to exercise the proxy.
  const ee = req as unknown as { once?: (event: string, listener: () => void) => void };
  if (typeof ee.once === 'function') {
    ee.once('close', () => controller.abort());
  }
  return { signal: controller.signal };
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

/**
 * Match transient transport-layer errors (ECONNREFUSED, socket reset, etc.)
 * so callers can decide to retry. Upstream HTTP errors (4xx/5xx) do NOT throw
 * and therefore never reach this predicate — they remain the responsibility of
 * the caller's readiness probe.
 */
export const isTransportError = (err: unknown): boolean => {
  const msg = ((err as Error)?.message || '').toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('terminated')
  );
};

/**
 * Single canonical fetch wrapper for every HTTP reverse proxy in this codebase
 * (baseProxy / previewProxy / deployProxy). Retries transient transport
 * failures with exponential backoff; passes upstream HTTP responses through
 * verbatim.
 *
 * Do not introduce per-call-site tuning here — callers should be byte-identical
 * so that retry behavior is auditable in one place. If a proxy genuinely
 * needs different policy, it likely needs a different helper, not different
 * options here.
 */
export const fetchWithTransportRetry = (
  url: string,
  init: RequestInit,
): Promise<globalThis.Response> =>
  withRetry<globalThis.Response>(() => fetch(url, init), {
    maxAttempts: 6,
    initialDelayMs: 250,
    maxDelayMs: 2500,
    backoffMultiplier: 2,
    shouldRetry: isTransportError,
  });
