/**
 * Shared CORS Configuration
 *
 * Unified CORS config used by all three publicly exposed servers:
 * - ant-api
 * - ant-realtime
 * - ant-preview
 *
 * Single-origin deployments (FE + API on the same host) do not exercise
 * CORS — same-origin requests skip the origin header. The middleware
 * still passes them through (no `origin` header → allow). Sub-domain
 * split deployments add their FE / preview / staging origins via the
 * `ANT_CORS_ORIGINS` env (comma-separated). Localhost is permitted
 * unconditionally so a dev can run the FE locally against any backend.
 *
 * The same allowlist (`isAllowedFrontendOrigin`) drives OAuth callback
 * redirect resolution (auth.routes.ts) — both the CORS gate and the
 * post-auth redirect target ask the same question, so the predicate is
 * a single SSOT instead of two parallel implementations.
 */

import cors from 'cors';
import type { Request } from 'express';

/**
 * Loopback-only predicate. Matches `http://localhost:*` and
 * `http://127.0.0.1:*` exactly (scheme + host prefix), so a malicious
 * origin like `https://localhost.attacker.com` cannot slip past via a
 * naive `.includes('localhost')`. The browser only emits these origins
 * when the request actually originates from the user's own machine, so
 * allowing them in production is safe — there's no remote attacker who
 * can forge a `localhost` Origin header.
 */
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
 * Frontend-origin allowlist. Returns true when `origin` is one of:
 *   - a loopback origin (any port — `http://localhost:*`, `http://127.0.0.1:*`)
 *   - the origin of `FRONTEND_URL` (split-host deployment SSOT)
 *   - a member of `ANT_CORS_ORIGINS` (csv)
 *
 * The CORS allow-all wildcard `'*'` is intentionally NOT recognised here.
 * `'*'` is a CORS-only policy (browser pre-flight); using it as a
 * redirect target would be an open-redirect vulnerability. The
 * `createCorsMiddleware` keeps its own `allowAllOrigins` short-circuit
 * for the CORS gate above this predicate.
 *
 * Self-origin (request Host header == origin host) is NOT covered here
 * because resolveFrontendOrigin (auth-redirect) callers only deal with the
 * static FE allowlist. The self-origin gate is applied in-line by
 * `createCorsMiddleware` where the request is available.
 */
export function isAllowedFrontendOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (isLoopbackOrigin(origin)) return true;
  const fe = frontendUrlOrigin();
  if (fe && fe === origin) return true;
  return parseExtraOrigins().includes(origin);
}

/**
 * Self-origin predicate. Returns true when the Origin header's host matches
 * the Host header of the same request — i.e. the browser is talking to the
 * server's own canonical hostname.
 *
 * Why this is safe to auto-allow:
 *
 *   - The `Origin` header is set by the browser; JavaScript cannot forge it
 *     (CORS spec). An attacker page cannot put OUR backend's hostname into
 *     their Origin header.
 *   - The `Host` header is set by the client, but ALB/ingress preserves the
 *     original Host and `app.set('trust proxy', 1)` (ServerConfigurator) lets
 *     Express trust the forwarded chain. So `req.get('host')` is the
 *     hostname the user actually typed (or that the iframe inherited).
 *   - Therefore "origin == request host" means "the page making this request
 *     is itself served from this very BE host" — the only origin that we
 *     definitionally trust.
 *
 * The motivating case: openvscode-server inside the IDE iframe emits
 * `<script type="module">` / `<script crossorigin>` whose loads ALWAYS send
 * an Origin header (CORS spec) even when same-origin. Without this gate,
 * those self-host requests fall into the explicit-allowlist branch and 500
 * unless the operator manually registered the BE host in `ANT_CORS_ORIGINS`
 * — registering oneself in one's own allowlist is the kind of asymmetry
 * that should not exist.
 *
 * NB: we compare against `req.hostname` (trust-proxy aware) rather than the
 * raw `Host` header, because ALB / ingress preserves the public hostname in
 * `X-Forwarded-Host` while the raw Host header carries the cluster-internal
 * address. Port differences are ignored — production traffic goes through
 * implicit 443, and dev loopback is already covered by `isLoopbackOrigin`.
 */
function isSelfOrigin(req: Request, origin: string): boolean {
  const reqHostname = req.hostname;
  if (!reqHostname) return false;
  try {
    return new URL(origin).hostname === reqHostname;
  } catch {
    return false;
  }
}

/**
 * Pick the post-OAuth redirect base. When the start-of-flow origin is
 * known and passes the allowlist, use it verbatim — that's how a
 * localhost:4200 sign-in lands back on localhost:4200 even when the
 * OAuth flow ran through the production cloud BE. Falls back to
 * `FRONTEND_URL` (the split-host SSOT) when the start origin is
 * unknown / disallowed, so a malformed or attacker-supplied Origin can
 * never widen the redirect target.
 *
 * Empty-string return = "no absolute base known" → caller composes a
 * same-origin path-only redirect.
 */
export function resolveFrontendOrigin(
  startOrigin: string | undefined,
  fallbackEnv: string | undefined,
): string {
  if (startOrigin && isAllowedFrontendOrigin(startOrigin)) return startOrigin;
  return fallbackEnv ?? '';
}

/**
 * Create CORS middleware with environment-aware origin checking.
 *
 * Resolution order (per request):
 * 1. Missing `Origin` header (same-origin / server-to-server / health) → allow.
 * 2. `'*'` in `ANT_CORS_ORIGINS` (allow-all wildcard) → allow.
 * 3. **Self-origin** (request `Host` header == origin host) → allow. This
 *    is the SSOT gate for iframe / module-script same-host CORS requests
 *    (e.g. openvscode-server module loads). Eliminates the need for any
 *    operator to register the BE hostname in its own allowlist.
 * 4. `isAllowedFrontendOrigin(origin)` — loopback OR `FRONTEND_URL`
 *    origin OR `ANT_CORS_ORIGINS` member → allow.
 * 5. Otherwise → reject.
 *
 * Uses the `cors(delegate)` per-request pattern so the `req` is available
 * for the self-origin check.
 */
export function createCorsMiddleware() {
  // Snapshot the wildcard flag at startup — `'*'` is a deploy-time
  // policy, not a per-request decision. Other allowlist entries are
  // evaluated per-request inside `isAllowedFrontendOrigin` / `isSelfOrigin`
  // so process env changes (uncommon, but possible for tests) take effect.
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

/** Test-only exports. */
export const __testing = { isLoopbackOrigin, isSelfOrigin };
