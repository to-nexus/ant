/**
 * Figma Integration Routes
 * 
 * Handles Figma MCP credential management and design data access
 */

import { Router, Request, Response } from 'express';
import { UserConfigManager, FigmaCredentials, FigmaIntegration } from '../../../../utils/userConfig';
import { FigmaMCPAdapter } from '../../figma/FigmaMCPAdapter';
import { parseFigmaUrl } from '../../../../core/ports/figma';

export function createFigmaRoutes(workspaceRoot: string): Router {
  const router = Router();
  const userConfig = new UserConfigManager(workspaceRoot);
  
  /**
   * POST /api/figma/config
   * Configure Figma integration (credentials + settings)
   */
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const { 
        token, 
        serverUrl, 
        serverType,
        userId,
        autoExtractTokens,
        autoGenerateCode,
        defaultFileFormat
      } = req.body;
      const userContext = (req as any).userContext;
      
      if (!userContext) {
        return res.status(401).json({ 
          success: false, 
          error: 'User context not found' 
        });
      }
      
      if (!token || !serverUrl) {
        return res.status(400).json({ 
          success: false, 
          error: 'token and serverUrl are required' 
        });
      }
      
      // Validate credential by testing connection
      const adapter = new FigmaMCPAdapter();
      try {
        await adapter.connect(token, serverUrl);
        await adapter.disconnect();
      } catch (error: any) {
        return res.status(400).json({ 
          success: false, 
          error: `Invalid credentials: ${error.message}` 
        });
      }
      
      // Save credentials and integration settings
      await userConfig.configureService<FigmaCredentials, FigmaIntegration>(
        userContext,
        'figma',
        {
          token,
          tokenType: 'mcp'
        },
        {
          enabled: true,
          serverUrl,
          serverType: serverType || 'remote',
          userId,
          autoExtractTokens: autoExtractTokens ?? false,
          autoGenerateCode: autoGenerateCode ?? false,
          defaultFileFormat: defaultFileFormat || 'svg'
        }
      );
      
      res.json({ 
        success: true, 
        message: 'Figma integration configured successfully' 
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error configuring Figma:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to configure Figma integration' 
      });
    }
  });
  
  /**
   * GET /api/figma/config
   * Get Figma configuration status for current user
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const userContext = (req as any).userContext;
      
      if (!userContext) {
        return res.status(401).json({ 
          success: false, 
          error: 'User context not found' 
        });
      }
      
      const status = await userConfig.getServiceStatus(userContext, 'figma');
      
      if (!status.hasCredentials) {
        return res.json({ 
          configured: false 
        });
      }
      
      const credentials = await userConfig.credentials.get<FigmaCredentials>(userContext, 'figma');
      
      res.json({ 
        configured: status.configured,
        enabled: status.enabled,
        serverUrl: status.settings.serverUrl,
        serverType: status.settings.serverType,
        userId: status.settings.userId,
        autoExtractTokens: status.settings.autoExtractTokens,
        autoGenerateCode: status.settings.autoGenerateCode,
        defaultFileFormat: status.settings.defaultFileFormat,
        updatedAt: credentials?.updatedAt
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error getting Figma config:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to get Figma configuration' 
      });
    }
  });
  
  /**
   * DELETE /api/figma/config
   * Remove Figma integration completely
   */
  router.delete('/config', async (req: Request, res: Response) => {
    try {
      const userContext = (req as any).userContext;
      
      if (!userContext) {
        return res.status(401).json({ 
          success: false, 
          error: 'User context not found' 
        });
      }
      
      await userConfig.removeService(userContext, 'figma');
      
      res.json({ 
        success: true, 
        message: 'Figma integration removed successfully' 
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error removing Figma integration:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to remove Figma integration' 
      });
    }
  });
  
  /**
   * POST /api/figma/validate
   * Validate Figma MCP connection
   */
  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const { token, serverUrl } = req.body;
      
      if (!token || !serverUrl) {
        return res.status(400).json({ 
          success: false, 
          error: 'token and serverUrl are required' 
        });
      }
      
      const adapter = new FigmaMCPAdapter();
      
      try {
        await adapter.connect(token, serverUrl);
        const isConnected = await adapter.isConnected();
        await adapter.disconnect();
        
        res.json({ 
          valid: isConnected,
          message: isConnected ? 'Connection successful' : 'Connection failed'
        });
      } catch (error: any) {
        res.json({ 
          valid: false, 
          error: error.message 
        });
      }
    } catch (error: any) {
      console.error('[FigmaRoutes] Error validating credential:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Validation failed' 
      });
    }
  });
  
  /**
   * GET /api/figma/files/:fileKey
   * Get Figma file information
   */
  router.get('/files/:fileKey', async (req: Request, res: Response) => {
    try {
      const { fileKey } = req.params;
      const userContext = (req as any).userContext;
      
      if (!userContext) {
        return res.status(401).json({ 
          success: false, 
          error: 'User context not found' 
        });
      }
      
      const [credentials, settings] = await Promise.all([
        userConfig.credentials.get<FigmaCredentials>(userContext, 'figma'),
        userConfig.integrations.get<FigmaIntegration>(userContext, 'figma')
      ]);
      
      if (!credentials || !settings.enabled) {
        return res.status(403).json({ 
          success: false, 
          error: 'Figma integration not configured' 
        });
      }
      
      const adapter = new FigmaMCPAdapter();
      await adapter.connect(credentials.token, settings.serverUrl);
      
      const file = await adapter.getFile(fileKey);
      await adapter.disconnect();
      
      res.json({ 
        success: true, 
        file 
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error getting file:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to get Figma file' 
      });
    }
  });
  
  /**
   * GET /api/figma/files/:fileKey/design-tokens
   * Extract design tokens from Figma file
   */
  router.get('/files/:fileKey/design-tokens', async (req: Request, res: Response) => {
    try {
      const { fileKey } = req.params;
      const userContext = (req as any).userContext;
      
      if (!userContext) {
        return res.status(401).json({ 
          success: false, 
          error: 'User context not found' 
        });
      }
      
      const [credentials, settings] = await Promise.all([
        userConfig.credentials.get<FigmaCredentials>(userContext, 'figma'),
        userConfig.integrations.get<FigmaIntegration>(userContext, 'figma')
      ]);
      
      if (!credentials || !settings.enabled) {
        return res.status(403).json({ 
          success: false, 
          error: 'Figma integration not configured' 
        });
      }
      
      const adapter = new FigmaMCPAdapter();
      await adapter.connect(credentials.token, settings.serverUrl);
      
      const tokens = await adapter.extractDesignTokens(fileKey);
      await adapter.disconnect();
      
      res.json({ 
        success: true, 
        tokens 
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error extracting design tokens:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to extract design tokens' 
      });
    }
  });
  
  /**
   * POST /api/figma/parse-url
   * Parse Figma URL to extract file key and node ID
   */
  router.post('/parse-url', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ 
          success: false, 
          error: 'url is required' 
        });
      }
      
      const parsed = parseFigmaUrl(url);
      
      if (!parsed) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid Figma URL' 
        });
      }
      
      res.json({ 
        success: true, 
        ...parsed 
      });
    } catch (error: any) {
      console.error('[FigmaRoutes] Error parsing URL:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to parse URL' 
      });
    }
  });
  
  return router;
}

