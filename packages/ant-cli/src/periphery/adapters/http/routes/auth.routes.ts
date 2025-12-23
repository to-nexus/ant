import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
import { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';

/**
 * Authentication routes for Cloud Mode
 * 
 * Handles sign up (workspace creation) and sign in (validation)
 */
export function createAuthRoutes(deps: {
  authService: AuthService;
  workspaceResolver: WorkspaceResolver;
}): Router {
  const router = Router();
  const { authService, workspaceResolver } = deps;
  
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

