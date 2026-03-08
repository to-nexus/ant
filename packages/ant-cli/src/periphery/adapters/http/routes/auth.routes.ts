import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService, OIDCUser } from '../../../../infrastructure/auth/GoogleOIDCService';
import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import { authRateLimiter } from '../middleware/rateLimiter';
import { logger } from '../../../../utils/logger';
import type { AuthContext } from '../../../../core/ports/auth';

// In-memory store for OIDC state parameter (CSRF protection)
// In production with multiple pods, use Redis TTL key instead.
const oidcStateStore = new Map<string, { createdAt: number }>();
const OIDC_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
}): Router {
  const router = Router();
  const { authService, workspaceResolver, oidcService, jwtService } = deps;
  
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
   * Cleanup expired OIDC states
   */
  function cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [key, val] of oidcStateStore) {
      if (now - val.createdAt > OIDC_STATE_TTL_MS) {
        oidcStateStore.delete(key);
      }
    }
  }
  
  // ========================================
  // Google OIDC Routes
  // ========================================
  
  /**
   * Initiate Google OAuth2 flow
   * GET /api/auth/google
   */
  router.get('/auth/google', authRateLimiter, (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      });
    }
    
    try {
      // Generate CSRF state parameter
      const state = crypto.randomBytes(32).toString('hex');
      cleanupExpiredStates();
      oidcStateStore.set(state, { createdAt: Date.now() });
      
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
    
    // Verify CSRF state parameter
    if (!state || typeof state !== 'string' || !oidcStateStore.has(state)) {
      logger.warn('[Auth] Invalid or missing OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}/?error=invalid_state`);
    }
    oidcStateStore.delete(state);
    
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
      
      // Issue JWT cookie
      if (jwtService) {
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
      }
      
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
  
  return router;
}
