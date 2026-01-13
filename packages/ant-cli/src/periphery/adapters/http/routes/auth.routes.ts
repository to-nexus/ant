import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
import { GoogleOIDCService, OIDCUser } from '../../../../infrastructure/auth/GoogleOIDCService';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';

/**
 * Authentication routes for Cloud Mode
 * 
 * Handles:
 * - Legacy email-based authentication (sign up/in)
 * - Google OIDC authentication flow
 */
export function createAuthRoutes(deps: {
  authService: AuthService;
  workspaceResolver: WorkspaceResolver;
  oidcService?: GoogleOIDCService;
}): Router {
  const router = Router();
  const { authService, workspaceResolver, oidcService } = deps;
  
  // ========================================
  // Google OIDC Routes
  // ========================================
  
  /**
   * Initiate Google OAuth2 flow
   * GET /api/auth/google
   */
  router.get('/auth/google', (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      });
    }
    
    try {
      const authUrl = oidcService.getAuthorizationUrl();
      
      // Redirect user to Google sign-in page
      res.redirect(authUrl);
    } catch (error: any) {
      console.error('[Auth] Google OAuth error:', error);
      return res.status(500).json({
        error: 'Failed to initiate Google authentication',
        message: error.message
      });
    }
  });
  
  /**
   * Google OAuth2 callback
   * GET /api/auth/google/callback
   */
  router.get('/auth/google/callback', async (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured'
      });
    }
    
    const { code, error } = req.query;
    
    // Handle OAuth errors
    if (error) {
      console.error('[Auth] Google OAuth error:', error);
      const frontendUrl = process.env.FRONTEND_URL || '';
      return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code || typeof code !== 'string') {
      const frontendUrl = process.env.FRONTEND_URL || '';
      return res.redirect(`${frontendUrl}/?error=no_code`);
    }
    
    try {
      // Exchange code for user info
      const oidcUser: OIDCUser = await oidcService.authenticateWithCode(code);
      
      // Verify email is verified
      if (!oidcUser.emailVerified) {
        const frontendUrl = process.env.FRONTEND_URL || '';
        return res.redirect(`${frontendUrl}/?error=email_not_verified`);
      }
      
      // Extract organization from email domain
      const [username, domain] = oidcUser.email.split('@');
      
      // Get workspace path
      const workspacePath = workspaceResolver.getWorkspacePath({
        userId: username,
        organizationId: domain,
        workspacePath: ''
      });
      
      // Check if workspace exists (sign in vs sign up)
      let isNewUser = false;
      try {
        await fs.promises.access(workspacePath);
      } catch {
        // Create workspace for new user
        await fs.promises.mkdir(workspacePath, { recursive: true });
        isNewUser = true;
        console.log(`[Auth] Created workspace for ${oidcUser.email} at ${workspacePath}`);
      }
      
      // Redirect to frontend with user info
      // Frontend will store this in localStorage
      const userData = encodeURIComponent(JSON.stringify({
        email: oidcUser.email,
        name: oidcUser.name,
        picture: oidcUser.picture,
        organization: domain,
        isNewUser
      }));
      
      // Get frontend URL from environment or use same origin
      const frontendUrl = process.env.FRONTEND_URL || '';
      res.redirect(`${frontendUrl}/?auth=success&user=${userData}`);
    } catch (error: any) {
      console.error('[Auth] Google callback error:', error);
      const frontendUrl = process.env.FRONTEND_URL || '';
      return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(error.message)}`);
    }
  });
  
  // ========================================
  // Legacy Email-based Routes
  // ========================================
  
  /**
   * Sign Up - Create user workspace
   * POST /api/auth/signup
   */
  router.post('/auth/signup', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          error: 'Email is required'
        });
      }
      
      // Validate email format
      if (!email.includes('@')) {
        return res.status(400).json({
          error: 'Invalid email format'
        });
      }
      
      // Parse email to get organization and username
      const [username, domain] = email.split('@');
      
      // Only accept to.nexus organization
      if (domain !== 'to.nexus') {
        return res.status(400).json({
          error: 'Only to.nexus organization is currently supported'
        });
      }
      
      // Authenticate (extract user context)
      const authContext = await authService.authenticate({ email });
      
      // Get workspace path
      const workspacePath = workspaceResolver.getWorkspacePath({
        userId: authContext.user.id,
        organizationId: authContext.organization.id,
        workspacePath: '' // not used here
      });
      
      // Check if workspace already exists
      try {
        await fs.promises.access(workspacePath);
        return res.status(409).json({
          error: 'Account already exists',
          message: 'This email is already registered. Please sign in instead.'
        });
      } catch {
        // Workspace doesn't exist, create it
        await fs.promises.mkdir(workspacePath, { recursive: true });
        
        console.log(`[Auth] Created workspace for ${email} at ${workspacePath}`);
        
        return res.json({
          success: true,
          message: 'Account created successfully',
          user: {
            email: authContext.user.email,
            userId: authContext.user.id,
            organization: authContext.organization.name
          }
        });
      }
    } catch (error: any) {
      console.error('[Auth] Sign up error:', error);
      return res.status(500).json({
        error: 'Sign up failed',
        message: error.message
      });
    }
  });
  
  /**
   * Sign In - Validate user workspace exists
   * POST /api/auth/signin
   */
  router.post('/auth/signin', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          error: 'Email is required'
        });
      }
      
      // Validate email format
      if (!email.includes('@')) {
        return res.status(400).json({
          error: 'Invalid email format'
        });
      }
      
      // Parse email to get organization and username
      const [username, domain] = email.split('@');
      
      // Only accept to.nexus organization
      if (domain !== 'to.nexus') {
        return res.status(400).json({
          error: 'Only to.nexus organization is currently supported'
        });
      }
      
      // Authenticate (extract user context)
      const authContext = await authService.authenticate({ email });
      
      // Get workspace path
      const workspacePath = workspaceResolver.getWorkspacePath({
        userId: authContext.user.id,
        organizationId: authContext.organization.id,
        workspacePath: '' // not used here
      });
      
      // Check if workspace exists
      try {
        await fs.promises.access(workspacePath);
        
        console.log(`[Auth] User signed in: ${email}`);
        
        return res.json({
          success: true,
          message: 'Signed in successfully',
          user: {
            email: authContext.user.email,
            userId: authContext.user.id,
            organization: authContext.organization.name
          }
        });
      } catch {
        return res.status(404).json({
          error: 'Account not found',
          message: 'No account found for this email. Please sign up first.'
        });
      }
    } catch (error: any) {
      console.error('[Auth] Sign in error:', error);
      return res.status(500).json({
        error: 'Sign in failed',
        message: error.message
      });
    }
  });
  
  /**
   * Sign Out - Client-side only (clear localStorage)
   * No server-side action needed
   */
  router.post('/auth/signout', (_req: Request, res: Response) => {
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  });
  
  return router;
}
