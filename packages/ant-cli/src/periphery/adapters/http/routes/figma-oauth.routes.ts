/**
 * Figma OAuth Routes
 * 
 * Handles Figma OAuth 2.0 authentication flow
 */

import { Router, Request, Response } from 'express';
import { UserConfigManager, FigmaCredentials } from '../../../../utils/userConfig';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';

interface FigmaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number;
  user_id_string?: string;
}

interface FigmaUserResponse {
  id: string;
  email?: string;
  handle?: string;
}

export function createFigmaOAuthRoutes(workspaceRoot: string): Router {
  const router = Router();
  const userConfig = new UserConfigManager(workspaceRoot);
  
  const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID || '';
  const FIGMA_CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET || '';
  
  /**
   * Get redirect URI based on request (supports multiple ports for development)
   */
  const getRedirectUri = (req: Request): string => {
    // Priority 1: Environment variable (production)
    if (process.env.FIGMA_REDIRECT_URI) {
      return process.env.FIGMA_REDIRECT_URI;
    }
    
    // Priority 2: Dynamic from request (development - supports any port)
    const protocol = req.protocol; // http or https
    const host = req.get('host'); // localhost:54112, localhost:4100, etc.
    return `${protocol}://${host}/api/figma/oauth/callback`;
  };
  
  /**
   * Helper to get user context from JWT-authenticated request
   */
  const getUserContext = (req: Request) => {
    if ((req as any).user && (req as any).organization) {
      return {
        userId: (req as any).user.id,
        organizationId: (req as any).organization.id,
      };
    }
    
    // Local mode fallback
    return null;
  };
  
  /**
   * GET /api/figma/config
   * Check Figma OAuth configuration status
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const userContext = getUserContext(req);
      
      if (!userContext) {
        return res.status(401).json({
          success: false,
          error: 'User context not found'
        });
      }
      
      const credentials = await userConfig.credentials.get<FigmaCredentials>(userContext, 'figma');
      const integration = await userConfig.integrations.get(userContext, 'figma');
      
      if (credentials && credentials.accessToken) {
        const figmaIntegration = integration as any;
        
        return res.json({
          configured: true,
          enabled: integration?.enabled || false,
          email: credentials.email,
          userId: credentials.userId,
          autoExtractTokens: figmaIntegration?.autoExtractTokens,
          autoGenerateCode: figmaIntegration?.autoGenerateCode,
          defaultFileFormat: figmaIntegration?.defaultFileFormat,
          updatedAt: credentials.updatedAt
        });
      }
      
      res.json({
        configured: false
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaConfig');
    }
  });
  
  /**
   * GET /api/figma/oauth/authorize
   * Redirect to Figma OAuth authorization page
   */
  router.get('/oauth/authorize', (req: Request, res: Response) => {
    if (!FIGMA_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        error: 'Figma OAuth not configured. Please set FIGMA_CLIENT_ID in .env'
      });
    }
    
    // Get user context from JWT auth middleware
    const userContext = getUserContext(req);
    if (!userContext) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    const { userId, organizationId } = userContext;
    
    // Get dynamic redirect URI
    const redirectUri = getRedirectUri(req);
    
    const state = Buffer.from(JSON.stringify({
      timestamp: Date.now(),
      userId,
      organizationId,
      redirectUri  // Store for verification in callback
    })).toString('base64');
    
    const authUrl = new URL('https://www.figma.com/oauth');
    authUrl.searchParams.set('client_id', FIGMA_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'current_user:read file_content:read');  // ✅ Both scopes needed
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    
    logger.debug('Redirecting to Figma OAuth', { component: 'FigmaOAuth' });
    res.redirect(authUrl.toString());
  });
  
  /**
   * GET /api/figma/oauth/callback
   * Handle OAuth callback from Figma
   */
  router.get('/oauth/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Figma OAuth error: ${error}`
      });
    }
    
    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state parameter'
      });
    }
    
    try {
      // Decode state to get user context
      const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      const userContext = {
        userId: stateData.userId,
        organizationId: stateData.organizationId,
      };
      
      // Get redirect URI from state (same as used in authorize)
      const redirectUri = stateData.redirectUri || getRedirectUri(req);
      
      // Exchange code for access token
      const tokenResponse = await fetch('https://api.figma.com/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: FIGMA_CLIENT_ID,
          client_secret: FIGMA_CLIENT_SECRET,
          redirect_uri: redirectUri,
          code: code as string,
          grant_type: 'authorization_code'
        }).toString()
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        logger.error(`Figma token exchange failed (status: ${tokenResponse.status})`, { component: 'FigmaOAuth' });
        throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
      }
      
      const tokenData = await tokenResponse.json() as FigmaTokenResponse;
      
      // Get user info from /v1/me endpoint
      const userResponse = await fetch('https://api.figma.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`
        }
      });
      
      if (!userResponse.ok) {
        logger.error(`Figma user info fetch failed (status: ${userResponse.status})`, { component: 'FigmaOAuth' });
        throw new Error(`Failed to get user info: ${userResponse.status}`);
      }
      
      const userData = await userResponse.json() as FigmaUserResponse;
      
      // Calculate expiration
      const expiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined;
      
      // Use user_id_string (new format) or fall back to user_id (deprecated)
      const figmaUserId = tokenData.user_id_string || String(tokenData.user_id);
      
      // Save credentials
      await userConfig.credentials.set<FigmaCredentials>(
        userContext,
        'figma',
        {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          userId: figmaUserId,
          email: userData.email,
          expiresAt
        }
      );
      
      // Enable integration
      await userConfig.integrations.set(userContext, 'figma', {
        enabled: true,
        autoExtractTokens: true,
        autoGenerateCode: false,
        defaultFileFormat: 'svg'
      });
      
      logger.info('Figma OAuth completed successfully', { component: 'FigmaOAuth' });
      
      // Redirect to success page and notify parent window
      const displayEmail = userData.email || 'Unknown';
      const displayUserId = figmaUserId || 'Unknown';
      
      res.send(`
        <html>
          <head><title>Figma Connected</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>✅ Figma Connected Successfully!</h1>
            <p>Connected as: <strong>${displayEmail}</strong></p>
            <p>User ID: <code>${displayUserId}</code></p>
            <p>You can close this window and return to ANT.</p>
            <script>
              console.log('[Figma OAuth Callback] Sending postMessage to opener...');
              
              // Notify parent window (opener)
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'figma-oauth-success',
                  email: '${displayEmail}',
                  userId: '${displayUserId}'
                }, '*');
                console.log('[Figma OAuth Callback] ✅ postMessage sent');
              } else {
                console.error('[Figma OAuth Callback] ❌ No window.opener found!');
              }
              
              // Auto-close after 3 seconds
              setTimeout(() => {
                console.log('[Figma OAuth Callback] Closing window...');
                window.close();
              }, 3000);
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaOAuthCallback');
    }
  });
  
  /**
   * POST /api/figma/oauth/disconnect
   * Disconnect Figma integration
   */
  router.post('/oauth/disconnect', async (req: Request, res: Response) => {
    try {
      const userContext = getUserContext(req);
      
      if (!userContext) {
        return res.status(401).json({
          success: false,
          error: 'User context not found'
        });
      }
      
      await userConfig.removeService(userContext, 'figma');
      
      res.json({
        success: true,
        message: 'Figma disconnected successfully'
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaDisconnect');
    }
  });
  
  return router;
}
