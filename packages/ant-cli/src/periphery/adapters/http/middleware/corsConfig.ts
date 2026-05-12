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
 * Auto-allow when Origin.hostname == request.hostname — the page is served
 * from the very BE host it targets. Safe because the browser-set Origin
 * cannot be forged from another page, and `req.hostname` (trust-proxy
 * aware) reflects X-Forwarded-Host from ALB / ingress.
 *
 * Closes the openvscode-server iframe regression: module scripts (`<script
 * type="module">`, `<script crossorigin>`) always emit an Origin header per
 * CORS spec — even same-origin — so without this gate the BE rejects its
 * own assets unless an operator registers the BE host in its own allowlist.
 */
function isSelfOrigin(req: Request, origin: string): boolean {
  if (!req.hostname) return false;
  try {
    return new URL(origin).hostname === req.hostname;
  } catch {
    return false;
  }
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

  const base: Omit<cors.CorsOptions, 'origin'> = {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  const delegate: cors.CorsOptionsDelegate<Request> = (req, callback) => {
    const origin = req.header('Origin');
    if (!origin) return callback(null, { ...base, origin: true });
    if (allowAllOrigins) return callback(null, { ...base, origin: true });
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
