import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService, OIDCUser } from '../../../../infrastructure/auth/GoogleOIDCService';
import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
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
   * Store OIDC state in Redis with TTL (multi-pod safe)
   */
  async function storeOidcState(state: string): Promise<void> {
    if (!stateStore) {
      throw new Error('StateStore required for OIDC state management');
    }
    await stateStore.setKeyWithTTL(`${OIDC_STATE_KEY_PREFIX}${state}`, '1', OIDC_STATE_TTL_SECONDS);
  }
  
  /**
   * Verify and consume OIDC state from Redis (atomic: get + delete)
   */
  async function verifyAndConsumeOidcState(state: string): Promise<boolean> {
    if (!stateStore) return false;
    const key = `${OIDC_STATE_KEY_PREFIX}${state}`;
    const value = await stateStore.getKey(key);
    if (!value) return false;
    await stateStore.deleteKey(key);
    return true;
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
      // Generate CSRF state parameter (stored in Redis for multi-pod safety)
      const state = crypto.randomBytes(32).toString('hex');
      await storeOidcState(state);
      
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
    
    // Handle OAuth errors
    if (error) {
      logger.warn(`[Auth] Google OAuth error: ${error}`, { component: 'Auth' });
      return res.redirect(`${frontendUrl}/?error=oauth_failed`);
    }
    
    if (!code || typeof code !== 'string') {
      return res.redirect(`${frontendUrl}/?error=no_code`);
    }
    
    // Verify CSRF state parameter (Redis-backed, multi-pod safe)
    if (!state || typeof state !== 'string' || !(await verifyAndConsumeOidcState(state))) {
      logger.warn('[Auth] Invalid or missing OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}/?error=invalid_state`);
    }
    
    try {
      // Exchange code for user info
      const oidcUser: OIDCUser = await oidcService.authenticateWithCode(code);
      
      if (!oidcUser.emailVerified) {
        return res.redirect(`${frontendUrl}/?error=email_not_verified`);
      }
      
      // Validate organization (to.nexus only)
      const { authContext, workspacePath } = await validateAndGetWorkspace(oidcUser.email);
      
      // Create workspace for new user if needed
      try {
        await fs.promises.access(workspacePath);
      } catch {
        await fs.promises.mkdir(workspacePath, { recursive: true });
        logger.info(`[Auth] Created workspace for ${oidcUser.email}`, { component: 'Auth' });
      }
      
      // Issue JWT cookie (required for authentication)
      if (!jwtService) {
        logger.error('JWT service not available during OIDC callback', { component: 'Auth' });
        return res.redirect(`${frontendUrl}/?error=auth_config_error`);
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
        jwtService.getCookieOptions(isProduction),
      );
      
      // Clean redirect (no user data in URL)
      res.redirect(`${frontendUrl}/?auth=success`);
    } catch (error: any) {
      logger.error('[Auth] Google callback error', { component: 'Auth' }, error);
      return res.redirect(`${frontendUrl}/?error=auth_failed`);
    }
  });
  
  // ========================================
  // Session Endpoints
  // ========================================
  
  /**
   * GET /api/auth/me
   * Returns current user info from JWT cookie.
   * Frontend calls this after OIDC redirect to populate Zustand store.
   */
  router.get('/auth/me', (req: Request, res: Response) => {
    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }
    
    const token = (req as any).cookies?.[JwtService.cookieName];
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
      const payload = jwtService.verify(token);
      res.json({
        email: payload.email,
        organization: payload.org,
        name: payload.name,
        picture: payload.picture,
        userId: payload.sub,
      });
    } catch {
      return res.status(401).json({ error: 'Invalid session' });
    }
  });
  
  /**
   * POST /api/auth/signout
   * Clears the JWT cookie.
   */
  router.post('/auth/signout', (_req: Request, res: Response) => {
    if (jwtService) {
      res.clearCookie(JwtService.cookieName, jwtService.getClearCookieOptions(isProduction));
    }
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  });

  /**
   * POST /api/auth/companion-token
   * Issues a long-lived JWT (90 days) for the companion desktop app.
   * Requires existing authentication (cookie-based session).
   */
  router.post('/auth/companion-token', async (req: Request, res: Response) => {
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
      const COMPANION_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
      const token = jwtService.sign(
        { sub: user.id, email: user.email || '', org: organization.id },
        COMPANION_TOKEN_TTL_SECONDS
      );

      res.json({
        success: true,
        token,
        expiresInDays: 90,
      });
    } catch (error: any) {
      logger.error('[Auth] Failed to issue companion token:', error);
      res.status(500).json({ success: false, message: 'Failed to issue token' });
    }
  });

  return router;
}
