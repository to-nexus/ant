import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService, OIDCUser } from '../../../../infrastructure/auth/GoogleOIDCService';
import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { StateStorePort } from '../../../../core/ports/stateStore';
import { authRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../../../../utils/logger';
import type { AuthContext } from '../../../../core/ports/auth';

const OIDC_STATE_TTL_SECONDS = 5 * 60; // 5 minutes
const OIDC_STATE_KEY_PREFIX = 'ant:oidc:state:';

/**
 * Authentication routes for Cloud Mode
 * 
 * Handles:
 * - Google OIDC authentication flow (JWT cookie issuance)
 * - Session info endpoint (/api/auth/me)
 * - Sign out (cookie clear)
 */
export function createAuthRoutes(deps: {
  authService: AuthService;
  workspaceResolver: WorkspaceResolver;
  oidcService?: GoogleOIDCService;
  jwtService?: JwtService;
  stateStore?: StateStorePort;
}): Router {
  const router = Router();
  const { authService, workspaceResolver, oidcService, jwtService, stateStore } = deps;
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  // ========================================
  // Common validation logic
  // ========================================
  
  /**
   * Validate organization and workspace
   * Common logic for both email-based and OAuth login
   */
  async function validateAndGetWorkspace(email: string): Promise<{
    authContext: AuthContext;
    workspacePath: string;
  }> {
    const [, domain] = email.split('@');
    
    if (domain !== 'to.nexus') {
      throw new Error('Only to.nexus organization is currently supported');
    }
    
    const authContext = await authService.authenticate({ email });
    
    const workspacePath = workspaceResolver.getWorkspacePath({
      userId: authContext.user.id,
      organizationId: authContext.organization.id,
    });
    
    return { authContext, workspacePath };
  }
  
  /**
   * Store OIDC state in Redis with TTL (multi-pod safe).
   * Optionally stores a returnTo path for post-auth redirect.
   */
  async function storeOidcState(state: string, returnTo?: string): Promise<void> {
    if (!stateStore) {
      throw new Error('StateStore required for OIDC state management');
    }
    const value = returnTo ? JSON.stringify({ returnTo }) : '1';
    await stateStore.setKeyWithTTL(`${OIDC_STATE_KEY_PREFIX}${state}`, value, OIDC_STATE_TTL_SECONDS);
  }
  
  /**
   * Verify and consume OIDC state from Redis (atomic: get + delete).
   * Returns the stored returnTo path if present.
   */
  async function verifyAndConsumeOidcState(state: string): Promise<{ valid: boolean; returnTo?: string }> {
    if (!stateStore) return { valid: false };
    const key = `${OIDC_STATE_KEY_PREFIX}${state}`;
    const value = await stateStore.getKey(key);
    if (!value) return { valid: false };
    await stateStore.deleteKey(key);
    let returnTo: string | undefined;
    if (value !== '1') {
      try { returnTo = JSON.parse(value).returnTo; } catch { /* ignore */ }
    }
    return { valid: true, returnTo };
  }
  
  /**
   * Validate returnTo path: must be a relative path starting with /
   * Prevents open redirect attacks.
   */
  function sanitizeReturnTo(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    if (!raw.startsWith('/') || raw.startsWith('//')) return undefined;
    return raw;
  }
  
  // ========================================
  // Google OIDC Routes
  // ========================================
  
  /**
   * Initiate Google OAuth2 flow
   * GET /api/auth/google
   */
  router.get('/auth/google', authRateLimiter, async (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      });
    }
    
    try {
      const returnTo = sanitizeReturnTo(req.query.returnTo);
      const state = crypto.randomBytes(32).toString('hex');
      await storeOidcState(state, returnTo);
      
      const authUrl = oidcService.getAuthorizationUrl(state);
      res.redirect(authUrl);
    } catch (error: any) {
      logger.error('[Auth] Google OAuth error', { component: 'Auth' }, error);
      return res.status(500).json({
        error: 'Failed to initiate Google authentication',
      });
    }
  });
  
  /**
   * Google OAuth2 callback
   * GET /api/auth/google/callback
   * 
   * Issues JWT httpOnly cookie and redirects to frontend.
   */
  router.get('/auth/google/callback', authRateLimiter, async (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured'
      });
    }
    
    const { code, error, state } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || '';
    const fallbackPath = '/app/';
    
    // Handle OAuth errors (redirect to App with error param)
    if (error) {
      logger.warn(`[Auth] Google OAuth error: ${error}`, { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=oauth_failed`);
    }
    
    if (!code || typeof code !== 'string') {
      return res.redirect(`${frontendUrl}${fallbackPath}?error=no_code`);
    }
    
    // Verify CSRF state parameter (Redis-backed, multi-pod safe)
    if (!state || typeof state !== 'string') {
      logger.warn('[Auth] Missing OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=invalid_state`);
    }
    
    const stateResult = await verifyAndConsumeOidcState(state);
    if (!stateResult.valid) {
      logger.warn('[Auth] Invalid or expired OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=invalid_state`);
    }
    
    const returnTo = stateResult.returnTo || fallbackPath;
    
    try {
      const oidcUser: OIDCUser = await oidcService.authenticateWithCode(code);
      
      if (!oidcUser.emailVerified) {
        return res.redirect(`${frontendUrl}${fallbackPath}?error=email_not_verified`);
      }
      
      const { authContext, workspacePath } = await validateAndGetWorkspace(oidcUser.email);
      
      try {
        await fs.promises.access(workspacePath);
      } catch {
        await fs.promises.mkdir(workspacePath, { recursive: true });
        logger.info(`[Auth] Created workspace for ${oidcUser.email}`, { component: 'Auth' });
      }
      
      if (!jwtService) {
        logger.error('JWT service not available during OIDC callback', { component: 'Auth' });
        return res.redirect(`${frontendUrl}${fallbackPath}?error=auth_config_error`);
      }
      
      const token = jwtService.sign({
        sub: authContext.user.id,
        email: authContext.user.email,
        org: authContext.organization.id,
        name: oidcUser.name,
        picture: oidcUser.picture,
      });
      
      res.cookie(
        JwtService.cookieName,
        token,
        jwtService.getCookieOptions(isProduction, req.hostname),
      );
      
      // Redirect to returnTo path; append ?auth=success for SPA paths so App.tsx can detect login
      const redirectUrl = returnTo.startsWith('/app')
        ? `${frontendUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}auth=success`
        : `${frontendUrl}${returnTo}`;
      res.redirect(redirectUrl);
    } catch (error: any) {
      logger.error('[Auth] Google callback error', { component: 'Auth' }, error);
      return res.redirect(`${frontendUrl}${fallbackPath}?error=auth_failed`);
    }
  });
  
  // ========================================
  // Session Endpoints
  // ========================================
  
  /**
   * GET /api/auth/me
   * Returns current user info from JWT cookie, or `{ user: null }` when no
   * session is present. Always 200 — "not signed in" is a valid state, not
   * an error, so callers don't need to differentiate 401 from genuine
   * failures (503 / network) and the browser doesn't log routine
   * unauthenticated probes as console errors.
   */
  router.get('/auth/me', (req: Request, res: Response) => {
    // Authoritative session state — must never be cached by intermediaries
    // (CloudFront, browser, proxy). A stale cached `{user: ...}` after the
    // user has signed out would re-authenticate the post-logout reload.
    res.set('Cache-Control', 'private, no-store');

    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }

    const token = (req as any).cookies?.[JwtService.cookieName];

    // Gated diagnostic — flip ANT_AUTH_DEBUG=1 for one reproduce window.
    // Pairs with the FE log `[Auth] me-fetch failed kind=...` to pinpoint
    // whether the cookie is being sent on the credentialed cross-origin
    // request (split-host deployments).
    if (process.env.ANT_AUTH_DEBUG === '1') {
      logger.info(
        `[Auth][debug] /auth/me cookiePresent=${!!token} origin=${req.headers.origin ?? ''} host=${req.headers.host ?? ''} xfp=${req.headers['x-forwarded-proto'] ?? ''} xfh=${req.headers['x-forwarded-host'] ?? ''}`,
        { component: 'Auth' },
      );
    }

    if (!token) {
      return res.json({ user: null });
    }

    try {
      const payload = jwtService.verify(token);
      res.json({
        user: {
          email: payload.email,
          organization: payload.org,
          name: payload.name,
          picture: payload.picture,
          userId: payload.sub,
        },
      });
    } catch {
      return res.json({ user: null });
    }
  });
  
  /**
   * POST /api/auth/signout
   *
   * Clears the JWT cookie. Emits TWO clearCookie calls — one with the
   * inferred `Domain` (post-81637eaf SSOT), and one host-only legacy
   * drain. RFC 6265bis requires attribute-set match for clearCookie, so a
   * Domain=.crosstoken.io clear can't touch a host-only cookie left over
   * from a pre-81637eaf deploy. The second call drains those legacy
   * cookies; idempotent when none exist.
   *
   * Sunset: remove the legacy drain after a 14-day window during which
   * `ANT_AUTH_DEBUG=1` shows no host-only cookies in the wild.
   */
  router.post('/auth/signout', (req: Request, res: Response) => {
    res.set('Cache-Control', 'private, no-store');

    if (jwtService) {
      // Primary: clears post-81637eaf cookies via the SSOT options resolver.
      res.clearCookie(
        JwtService.cookieName,
        jwtService.getClearCookieOptions(isProduction, req.hostname),
      );
      // Legacy drain: host-only cookies from pre-81637eaf deploys. Same
      // attribute set as the primary call EXCEPT no `domain`, so the
      // browser matches it against the host-only cookie and clears it.
      res.clearCookie(JwtService.cookieName, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
      });

      // Gated diagnostic — flip ANT_AUTH_DEBUG=1 for one reproduce window.
      // Logs every cookie sent in the request (so we see *all* `ant_session`
      // instances and their order) plus the resolved clearCookie options.
      if (process.env.ANT_AUTH_DEBUG === '1') {
        const setCookieHeader = res.getHeader('Set-Cookie');
        logger.info(
          `[Auth][debug] /auth/signout hostname=${req.hostname} rawCookieHeader="${req.headers.cookie ?? ''}" clearOptions=${JSON.stringify(jwtService.getClearCookieOptions(isProduction, req.hostname))} setCookieResp=${JSON.stringify(setCookieHeader ?? '')}`,
          { component: 'Auth' },
        );
      }
    }
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  });

  /**
   * POST /api/auth/desktop-token
   * Issues a long-lived JWT (90 days) for Ant Desktop.
   * Requires existing authentication (cookie-based session).
   */
  router.post('/auth/desktop-token', async (req: Request, res: Response) => {
    // Local mode: no JWT service, issue a fixed token that the bridge handler accepts
    if (!jwtService) {
      return res.json({
        success: true,
        token: 'local',
        expiresInDays: 9999,
      });
    }

    const user = (req as any).user;
    const organization = (req as any).organization;
    if (!user || !organization) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
      const DESKTOP_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
      const token = jwtService.sign(
        { sub: user.id, email: user.email || '', org: organization.id },
        DESKTOP_TOKEN_TTL_SECONDS
      );

      res.json({
        success: true,
        token,
        expiresInDays: 90,
      });
    } catch (error: any) {
      logger.error('[Auth] Failed to issue desktop token:', error);
      res.status(500).json({ success: false, message: 'Failed to issue token' });
    }
  });

  return router;
}
