/**
 * Shared CORS SSOT for the three publicly-exposed Express servers in
 * ant-cli: ant-api / ant-realtime / ant-preview. (ant-job has no HTTP;
 * ant-ide is a separate K8s pod whose internal CORS is not managed here.)
 *
 * `isAllowedFrontendOrigin` is also reused by `resolveFrontendOrigin` so
 * the CORS gate and OAuth callback redirect target stay one predicate.
 */

import cors from 'cors';
import type { Request, RequestHandler } from 'express';
import { logger } from '../../../../utils/logger';

/** Exact-prefix match — `.includes('localhost')` would let `localhost.attacker.com` through. */
function isLoopbackOrigin(origin: string): boolean {
  return (
    origin.startsWith('http://localhost:') ||
    origin === 'http://localhost' ||
    origin.startsWith('http://127.0.0.1:') ||
    origin === 'http://127.0.0.1'
  );
}

function parseExtraOrigins(): string[] {
  return process.env.ANT_CORS_ORIGINS
    ? process.env.ANT_CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];
}

function frontendUrlOrigin(): string | null {
  if (!process.env.FRONTEND_URL) return null;
  try {
    return new URL(process.env.FRONTEND_URL).origin;
  } catch {
    return null;
  }
}

/**
 * Static FE allowlist: loopback / `FRONTEND_URL` / `ANT_CORS_ORIGINS` csv.
 * Wildcard `'*'` is intentionally NOT honored here — that's a CORS-only
 * policy and using it as an OAuth redirect target would be open-redirect.
 */
export function isAllowedFrontendOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (isLoopbackOrigin(origin)) return true;
  const fe = frontendUrlOrigin();
  if (fe && fe === origin) return true;
  return parseExtraOrigins().includes(origin);
}

/**
 * Auto-allow when the Origin IS this request's own origin — the page is served
 * from the very endpoint it targets. Safe because the browser-set Origin cannot
 * be forged from another page.
 *
 * Closes the openvscode-server iframe regression: module scripts (`<script
 * type="module">`, `<script crossorigin>`) always emit an Origin header per
 * CORS spec — even same-origin — so without this gate the BE rejects its
 * own assets unless an operator registers the BE host in its own allowlist.
 *
 * The comparison is on the FULL origin (scheme, host and port), not the hostname.
 * A hostname-only test made every port and scheme on the same host "self",
 * which silently re-merged origins that are deliberately separate — notably
 * ant-preview's user-content listener and its control-plane API, whose whole
 * point is being a different origin (H-NEW-001). `Host` already carries the port,
 * and `X-Forwarded-Host` / `X-Forwarded-Proto` carry what the browser actually
 * addressed when an ALB or ingress is in front.
 */
export function isSelfOrigin(req: Request, origin: string): boolean {
  // Read `headers` directly rather than `req.header()`: this predicate is also
  // exercised against plain request shapes, and the lookup is the same.
  const headers = req.headers ?? {};
  const host = firstHeaderValue(headers['x-forwarded-host']) ?? headers.host;
  if (!host) return false;

  const proto = firstHeaderValue(headers['x-forwarded-proto']) ?? req.protocol;
  if (!proto) return false;

  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

/** `X-Forwarded-*` may arrive as a comma-separated hop list; the client is first. */
function firstHeaderValue(raw: string | string[] | undefined): string | undefined {
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = value?.split(',')[0].trim();
  return first || undefined;
}

/**
 * Post-OAuth redirect base. Verbatim when the start-of-flow origin passes
 * the allowlist (so a localhost sign-in lands back on localhost), else
 * `FRONTEND_URL` so an attacker-supplied origin can't widen the target.
 * Empty string = caller composes a same-origin path-only redirect.
 */
export function resolveFrontendOrigin(
  startOrigin: string | undefined,
  fallbackEnv: string | undefined,
): string {
  if (startOrigin && isAllowedFrontendOrigin(startOrigin)) return startOrigin;
  return fallbackEnv ?? '';
}

/**
 * Resolution order:
 *   1. no Origin                       → allow (same-origin / health)
 *   2. ANT_CORS_ORIGINS contains '*'   → allow
 *   3. isSelfOrigin(req, origin)       → allow (iframe module scripts)
 *   4. isAllowedFrontendOrigin(origin) → allow (loopback / FRONTEND_URL / csv)
 *   5. otherwise                       → reject
 *
 * Uses `cors(delegate)` so `req` reaches the predicate.
 */
export function createCorsMiddleware(): RequestHandler {
  const allowAllOrigins = parseExtraOrigins().includes('*');

  if (allowAllOrigins) {
    // Reflecting any Origin WITH credentials would let any website make
    // credentialed reads of the authenticated API (the session cookie is
    // auto-attached) — a same-origin-policy bypass. We therefore serve the
    // wildcard WITHOUT credentials (cookies are not accepted cross-origin)
    // and surface the downgrade loudly so operators don't rely on it for
    // authenticated cross-origin calls.
    logger.warn(
      "⚠️  ANT_CORS_ORIGINS contains '*': reflecting all origins but WITHOUT " +
        'credentials (cross-origin cookies disabled). List explicit origins to ' +
        'allow credentialed cross-origin requests.',
      { component: 'cors' },
    );
  }

  const base: Omit<cors.CorsOptions, 'origin'> = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  const delegate: cors.CorsOptionsDelegate<Request> = (req, callback) => {
    const origin = req.header('Origin');
    if (!origin) return callback(null, { ...base, origin: true });
    // Wildcard: reflect the origin but strip credentials (see the startup warn).
    if (allowAllOrigins) return callback(null, { ...base, origin: true, credentials: false });
    if (isSelfOrigin(req, origin)) return callback(null, { ...base, origin: true });
    if (isAllowedFrontendOrigin(origin)) return callback(null, { ...base, origin: true });
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  };

  return cors(delegate);
}

/**
 * One-shot startup diagnostic. Cloud-mode deployments where both
 * `FRONTEND_URL` and `ANT_CORS_ORIGINS` are unset silently fail any FE
 * request whose host differs from the BE (split-host setups, Local FE
 * → Custom Cloud BE dev). Surface that here so operators see the cause
 * at boot instead of debugging a "preflight blocked" toast.
 *
 * Same-origin Cloud deployments (Persona B / C single-host) and local
 * mode rely on `isSelfOrigin` / loopback auto-allow respectively, so
 * the silent branch is correct for them — no warning needed.
 */
export function logCorsConfigSummary(): void {
  const mode = process.env.ANT_SERVER_MODE ?? 'local';
  const feUrl = process.env.FRONTEND_URL;
  const corsOrigins = process.env.ANT_CORS_ORIGINS;

  if (mode !== 'cloud') return;

  if (!feUrl && !corsOrigins) {
    console.warn(
      '[CORS] Cloud mode: FRONTEND_URL and ANT_CORS_ORIGINS both unset. ' +
      'Only loopback / self-origin requests will be allowed. Split-host ' +
      'deployments (FE origin != BE origin) WILL fail with CORS. ' +
      'Set FRONTEND_URL (single primary origin) or ANT_CORS_ORIGINS (CSV).'
    );
    return;
  }

  console.log(`[CORS] FE allowlist: ${feUrl ?? '(none)'}, extras: ${corsOrigins || '(none)'}`);
}

export const __testing = { isLoopbackOrigin, isSelfOrigin };
