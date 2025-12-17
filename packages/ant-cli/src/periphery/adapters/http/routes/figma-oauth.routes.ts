/**
 * Figma OAuth Routes
 * 
 * Handles Figma OAuth 2.0 authentication flow
 */

import { Router, Request, Response } from 'express';
import { UserConfigManager, FigmaCredentials } from '../../../../utils/userConfig';

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
   * Helper to get user context from request
   */
  const getUserContext = (req: Request) => {
    // Priority 1: From auth middleware (Cloud mode, already authenticated)
    if ((req as any).user && (req as any).organization) {
      console.log('[Figma getUserContext] Using authenticated user:', (req as any).user.id);
      return {
        userId: (req as any).user.id,
        organizationId: (req as any).organization.id,
        workspacePath: ''
      };
    }
    
    // Priority 2: From header/query (for OAuth flow)
    const emailFromHeader = req.headers['x-user-email'] as string;
    const emailFromQuery = req.query['user-email'] as string;
    const email = emailFromHeader || emailFromQuery;
    
    if (email) {
      console.log('[Figma getUserContext] Using email from header/query:', email);
      const [userId, organizationId] = email.split('@');
      return { userId, organizationId, workspacePath: '' };
    }
    
    console.log('[Figma getUserContext] No user context found');
    return null;
  };
  
  /**
   * GET /api/figma/config
   * Check Figma OAuth configuration status
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const userContext = getUserContext(req);
      console.log('[Figma /config] userContext:', userContext);
      
      if (!userContext) {
        console.log('[Figma /config] ❌ No user context');
        return res.status(401).json({
          success: false,
          error: 'User context not found'
        });
      }
      
      console.log('[Figma /config] Checking credentials for:', `${userContext.userId}@${userContext.organizationId}`);
      const credentials = await userConfig.credentials.get<FigmaCredentials>(userContext, 'figma');
      console.log('[Figma /config] credentials:', credentials ? 'Found' : 'Not found');
      console.log('[Figma /config] credentials.accessToken:', credentials?.accessToken ? 'Yes' : 'No');
      
      const integration = await userConfig.integrations.get(userContext, 'figma');
      console.log('[Figma /config] integration:', integration ? 'Found' : 'Not found');
      
      if (credentials && credentials.accessToken) {
        // Cast to FigmaIntegration to access Figma-specific properties
        const figmaIntegration = integration as any;
        
        console.log('[Figma /config] ✅ Returning configured=true, email:', credentials.email);
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
      
      console.log('[Figma /config] ❌ Returning configured=false');
      res.json({
        configured: false
      });
    } catch (error: any) {
      console.error('[FigmaOAuth] Error checking config:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to check Figma configuration'
      });
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
    
    // Get user email from query parameter (passed by frontend)
    const userEmail = req.query['user-email'] as string;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'user-email query parameter is required'
      });
    }
    
    // Parse user email to get userId and organizationId
    const [userId, organizationId] = userEmail.split('@');
    
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
    
    console.log('[Figma OAuth] Redirecting to Figma with URI:', redirectUri);
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
        workspacePath: ''  // Will be resolved by UserConfigManager
      };
      
      // Get redirect URI from state (same as used in authorize)
      const redirectUri = stateData.redirectUri || getRedirectUri(req);
      
      console.log('[Figma OAuth] Exchanging code for token with redirect_uri:', redirectUri);
      
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
        console.error('[Figma OAuth] Token exchange failed:', tokenResponse.status, errorText);
        throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
      }
      
      const tokenData = await tokenResponse.json();
      console.log('[Figma OAuth] Token exchange successful, user_id:', tokenData.user_id_string || tokenData.user_id);
      
      // Get user info from /v1/me endpoint
      console.log('[Figma OAuth] Fetching user info from /v1/me...');
      const userResponse = await fetch('https://api.figma.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`
        }
      });
      
      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.error('[Figma OAuth] ❌ Failed to get user info:', userResponse.status, errorText);
        throw new Error(`Failed to get user info: ${userResponse.status} ${errorText}`);
      }
      
      const userData = await userResponse.json();
      console.log('[Figma OAuth] User info response:', JSON.stringify(userData, null, 2));
      console.log('[Figma OAuth] User email:', userData.email);
      console.log('[Figma OAuth] User ID:', userData.id);
      
      // Calculate expiration
      const expiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined;
      
      // Use user_id_string (new format) or fall back to user_id (deprecated)
      const figmaUserId = tokenData.user_id_string || String(tokenData.user_id);
      
      console.log('[Figma OAuth] Preparing to save credentials...');
      console.log('[Figma OAuth]   ANT user:', `${userContext.userId}@${userContext.organizationId}`);
      console.log('[Figma OAuth]   Figma user:', userData.email || 'NO EMAIL');
      console.log('[Figma OAuth]   Figma userId:', figmaUserId);
      
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
      
      console.log('[Figma OAuth] ✅ Credentials saved successfully');
      
      // Enable integration
      console.log('[Figma OAuth] Saving integration settings...');
      await userConfig.integrations.set(userContext, 'figma', {
        enabled: true,
        autoExtractTokens: true,
        autoGenerateCode: false,
        defaultFileFormat: 'svg'
      });
      
      console.log('[Figma OAuth] ✅ Integration settings saved');
      
      // Redirect to success page and notify parent window
      const displayEmail = userData.email || 'Unknown';
      const displayUserId = figmaUserId || 'Unknown';
      
      console.log('[Figma OAuth] Sending success response with email:', displayEmail);
      
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
      console.error('[FigmaOAuth] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to complete OAuth flow'
      });
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
      console.error('[FigmaOAuth] Error disconnecting:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to disconnect Figma'
      });
    }
  });
  
  return router;
}
