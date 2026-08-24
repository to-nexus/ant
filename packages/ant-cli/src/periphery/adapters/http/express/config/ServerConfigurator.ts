import { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createIDEProxyMiddleware } from '../../middleware/ideProxy';
import { createIdeFaviconStub, createIdeVsdaStub } from '../../middleware/ideStubInterceptors';
import { createCorsMiddleware } from '../../middleware/corsConfig';
import { createJwtAuthMiddleware } from '../../middleware/jwtAuth';
import { createSameOriginGuard, isTrustedCookieOrigin } from '../../middleware/sameOriginGuard';
import {
  NAV_TICKET_PARAM,
  redeemIdeNavTicket,
  resolveNavTicketStore,
  stripNavTicket,
} from '../../middleware/ideNavTicket';
import { createRequireOnboardedJwt } from '../../middleware/requireOnboardedJwt';

import { JwtService } from '../../../../../infrastructure/auth/JwtService';
import { parseIDEKey } from '../../../../../infrastructure/state/redisKeyUtils';
import { assertProxyOwnership } from '../../middleware/proxyOwnership';
import { logger } from '../../../../../utils/logger';
import { ServerConfig, ServerDependencies } from '../types';

/**
 * Body-size budgets, split by whether the caller has been authenticated yet.
 *
 * The public endpoints are health, config, the agents catalog, the pricing
 * catalog and the OAuth callbacks — none carries a meaningful payload, so this
 * is generous for them and cheap for everyone else.
 */
const PUBLIC_JSON_BODY_LIMIT = '100kb';

/** Artifacts and base64-bearing payloads legitimately reach this size. */
const AUTHENTICATED_JSON_BODY_LIMIT = '50mb';

/**
 * ServerConfigurator
 * 
 * Configures Express app with middleware, body parsers, and authentication.
 * Handles CORS, proxy middleware, and Cloud/Local mode authentication.
 */
export class ServerConfigurator {
  constructor(
    private readonly config: ServerConfig,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Apply all middleware and configuration to Express app
   *
   * Middleware order matters:
   * 1. CORS + security headers
   * 2. Favicon (avoid noisy 401s)
   * 3. Cookie parser (needed by IDE proxy auth)
   * 4. IDE proxy auth (JWT check before proxy intercepts)
   * 5. IDE stub interceptors (short-circuit cosmetic-noise paths; after JWT, before proxy)
   * 6. Proxy middleware (intercepts /ide/ requests, no next())
   * 7. Small-body parser for PUBLIC endpoints only (must come after proxy)
   * 8. General JWT auth (all other routes)
   * 9. Full-size body parser — only reached once authenticated
   */
  configure(app: Express): void {
    if (process.env.NODE_ENV === 'production') {
      app.set('trust proxy', 1);
    }
    this.setupCors(app);
    this.setupSecurityHeaders(app);
    this.setupFaviconHandler(app);
    this.setupCookieParser(app);
    this.setupIdeProxyAuth(app);
    this.setupIdeStubInterceptors(app);
    this.setupProxyMiddleware(app);
    this.setupPublicBodyParser(app);
    this.setupAuthentication(app);
    this.setupBodyParsers(app);
  }

  /**
   * Configure CORS with environment-aware origin checking
   */
  private setupCors(app: Express): void {
    app.use(createCorsMiddleware());
  }

  /**
   * Apply security headers via helmet
   */
  private setupSecurityHeaders(app: Express): void {
    app.use(helmet({
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      contentSecurityPolicy: false,
      frameguard: false,
    }));
  }

  /**
   * Handle favicon.ico requests to avoid noisy 401s
   */
  private setupFaviconHandler(app: Express): void {
    app.get('/favicon.ico', (_req: Request, res: Response) => {
      res.status(204).end();
    });
  }

  /**
   * Short-circuit cosmetic-noise paths (vsda.js / vsda_bg.wasm / favicon.ico)
   * under `/ide/{key}/...` before the proxy forwards them upstream. Runs after
   * setupIdeProxyAuth() so cloud-mode JWT gating still applies.
   *
   * See ideStubInterceptors.ts for rationale (gitpod/openvscode-server omits
   * vsda; favicon would generate 404 + text/plain MIME mismatch in console).
   */
  private setupIdeStubInterceptors(app: Express): void {
    app.use(createIdeFaviconStub());
    app.use(createIdeVsdaStub());
  }

  /**
   * Setup proxy middleware for IDE containers
   * IMPORTANT: Must be registered BEFORE body parsers (proxy streams raw bytes)
   * JWT auth is handled by setupIdeProxyAuth() which runs before this.
   *
   * Note: Preview Proxy moved to ant-preview (see 10-cloud-architecture.md)
   */
  private setupProxyMiddleware(app: Express): void {
    app.use(createIDEProxyMiddleware({
      portRegistry: this.deps.portRegistry,
      pathPrefix: '/ide'
    }));
  }

  /**
   * Setup cookie parser (must come BEFORE proxy and auth middleware)
   */
  private setupCookieParser(app: Express): void {
    app.use(cookieParser());
  }

  /**
   * Authenticate /ide/ requests BEFORE the proxy middleware intercepts them.
   * In cloud mode, verifies JWT cookie and sets req.user.
   * In local mode, skips auth (authService is undefined).
   */
  private setupIdeProxyAuth(app: Express): void {
    if (!this.deps.authService) {
      // Local mode: no authentication
      return;
    }

    const jwtService = this.deps.jwtService;
    if (!jwtService) {
      return;
    }

    app.use('/ide/', (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const token = req.cookies?.[JwtService.cookieName];
        if (!token) {
          res.status(401).json({ error: 'Authentication required for IDE access' });
          return;
        }

        // Verified before the origin/ticket decision: it is pure crypto with no
        // side effect, and it means only a real session can spend a state-store
        // read on ticket redemption. The H-013 ordering requirement — refuse
        // before owner check, port touch and upstream forwarding — still holds.
        let payload;
        try {
          payload = jwtService.verify(token);
        } catch {
          res.status(401).json({ error: 'Invalid session for IDE access' });
          return;
        }

        const serverKey = req.path.split('/').filter(Boolean)[0];

        // CSRF: the proxy forwards this ambient-cookie request to a user's IDE
        // upstream, so even a GET is effectively state-changing. createSameOriginGuard
        // gates only mutating methods and is mounted AFTER this, so it never sees
        // `/ide/` — check the origin here, for every method (H-013).
        //
        // Two non-ambient lanes bypass the origin check because neither can be spent
        // by another origin: `Authorization: Bearer` (Ant Desktop), and a nav ticket
        // on the iframe's document navigation, which carries no `Origin` for the
        // predicate to judge. The predicate itself is unchanged and still refuses
        // `same-site` — see ideNavTicket.ts.
        const bearer = req.headers.authorization?.startsWith('Bearer ');
        const navigable = req.method === 'GET' || req.method === 'HEAD';
        if (!bearer && !isTrustedCookieOrigin(req)) {
          const ticketAdmitted = Boolean(serverKey) && navigable && await redeemIdeNavTicket(
            await resolveNavTicketStore(),
            { ticket: req.query?.[NAV_TICKET_PARAM], serverKey, payload },
          );
          if (!ticketAdmitted) {
            logger.warn(`[IDEProxyAuth] refused ${req.method} ${req.path}`, {
              component: 'IDEProxyAuth',
            }, {
              secFetchSite: req.headers['sec-fetch-site'] ?? null,
              secFetchMode: req.headers['sec-fetch-mode'] ?? null,
              secFetchDest: req.headers['sec-fetch-dest'] ?? null,
              hasOrigin: Boolean(req.header('Origin')),
              navigable,
              hasTicket: Boolean(req.query?.[NAV_TICKET_PARAM]),
            });
            res.status(403).json({ error: 'Cross-origin request refused' });
            return;
          }
        }

        // Ownership gate: the IDE serverKey embeds the owning (tenant, user) as
        // its first two segments. A valid session for a DIFFERENT owner must not
        // reach another account's IDE pod — JWT validity alone is not enough
        // (urlKeys are enumerable). Unparseable keys fall through unchanged; the
        // proxy itself returns 404 for those.
        const owner = serverKey ? parseIDEKey(serverKey) : null;
        if (owner && !assertProxyOwnership(payload, owner)) {
          res.status(403).json({ error: 'Forbidden: IDE belongs to another account' });
          return;
        }

        // Unconditional: the ticket never reaches the upstream IDE or the proxy's
        // request log, including on a same-origin deployment where the origin lane
        // admits first and the ticket is simply unused.
        req.url = stripNavTicket(req.url);

        req.user = {
          id: payload.sub,
          email: payload.email,
          organizationId: payload.org,
        };
        req.organization = {
          id: payload.org,
          name: payload.org,
        };
        next();
      })().catch(next);
    });
  }

  /**
   * Small-body parser for the handful of endpoints that answer without a JWT.
   *
   * Mounted BEFORE authentication, so it is the only parser an unauthenticated
   * request can reach — and it is capped at a size no public endpoint needs.
   * `body-parser` marks a parsed request (`req._body`) and later parsers no-op,
   * so the full-size parser below never re-reads these.
   */
  private setupPublicBodyParser(app: Express): void {
    app.use(express.json({ limit: PUBLIC_JSON_BODY_LIMIT }));
  }

  /**
   * Full-size body parser (must come AFTER proxy middleware AND authentication).
   *
   * A 50 MB parser ahead of the JWT check let an unauthenticated caller make the
   * server buffer and parse arbitrarily many large bodies before they were
   * rejected (M-010). Ordering it after authentication means only an
   * authenticated caller can spend that budget.
   */
  private setupBodyParsers(app: Express): void {
    app.use(express.json({ limit: AUTHENTICATED_JSON_BODY_LIMIT }));
  }

  /**
   * Setup authentication middleware
   * 
   * Cloud mode: JWT cookie-based authentication
   * Local mode: no auth (authService is undefined, early return)
   */
  private setupAuthentication(app: Express): void {
    if (!this.deps.authService) {
      // Local mode: no authentication
      return;
    }

    // Cloud mode: JWT cookie authentication
    const jwtService = this.deps.jwtService;
    if (!jwtService) {
      throw new Error('ANT_JWT_PUBLIC_KEY + ANT_JWT_PRIVATE_KEY are required in cloud mode. Set the environment variables to enable authentication.');
    }

    app.use(createJwtAuthMiddleware({
      jwtService,
      // Method-aware: each exemption names the method its route actually serves
      // so a mismatched method (e.g. POST /api/health) is not waved past the
      // JWT gate to the body parser behind it (M-010).
      publicPaths: [
        { path: '/api/health', methods: ['GET'] },
        { path: '/api/system/config', methods: ['GET'] },
        { path: '/api/agents', methods: ['GET'] },
        // Server-driven pricing catalog — read anonymously by the marketing
        // site (`@ant/site`). Billing is always-on today so this is mounted;
        // a future `@ant/cloud`-absent OSS build leaves the router unmounted
        // (→ 404, which the site degrades to its self-host fallback).
        { path: '/api/billing/catalog', methods: ['GET'] },
        { path: '/', methods: ['GET'] },
        { path: '/local', methods: ['GET'] },
        { path: '/api/auth/google', methods: ['GET'] },
        { path: '/api/auth/google/callback', methods: ['GET'] },
        { path: '/api/auth/me', methods: ['GET'] },
        { path: '/api/auth/signout', methods: ['POST'] },
      ],
      publicPrefixes: [],
    }));

    // Cookie-authenticated state changes must originate same-origin (or from the
    // registered frontend). ant-preview publishes user-authored content — a public
    // deploy's build output, a user's dev server — and a document served there
    // must not be able to spend the viewer's session against this API
    // (H-NEW-001). Bearer-authenticated callers (Ant Desktop) are exempt.
    app.use(createSameOriginGuard({
      publicPaths: ['/api/health', '/api/auth/google', '/api/auth/google/callback'],
    }));

    // Phase 3: refuse `_pending` JWT on every protected path except the
    // onboarding-flow endpoints (auth/me, auth/signout, auth/onboarding,
    // organizations). Local mode skips this entirely (early return above).
    app.use('/api', createRequireOnboardedJwt());
  }

  /**
   * Check if path is a polling endpoint (reduce logging noise)
   */
  isPollingEndpoint(path: string): boolean {
    return path.includes('/projects') || 
           path.includes('/session') || 
           path.includes('/stream');
  }
}
