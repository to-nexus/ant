/**
 * Figma Files Routes
 * 
 * API endpoints for working with Figma files in features
 */

import { Router, Request, Response } from 'express';
import { FigmaFileReader } from '../../../../core/usecases/figma/FigmaFileReader';
import { FigmaDesignExtractor } from '../../../../core/usecases/figma/FigmaDesignExtractor';
import { FigmaMCPAdapter } from '../../../adapters/figma/FigmaMCPAdapter';
import { sendErrorResponse } from './helpers/errorResponse';
import { UserConfigManager } from '../../../../utils/userConfig';

export interface FigmaFilesRoutesDeps {
  workspaceRoot: string;
  workspaceResolver: any; // WorkspaceResolver
}

export function createFigmaFilesRoutes(deps: FigmaFilesRoutesDeps): Router {
  const router = Router();
  const userConfig = new UserConfigManager(deps.workspaceRoot);
  
  /**
   * Helper to get user context from request
   */
  const getUserContext = (req: Request) => {
    if ((req as any).user && (req as any).organization) {
      return {
        userId: (req as any).user.id,
        organizationId: (req as any).organization.id,
      };
    }
    
    // Fallback for local mode
    return { userId: 'local', organizationId: 'local' };
  };
  
  /**
   * GET /api/figma/files/:projectId/:featureName
   * Get Figma file references from inputs/figma.md
   */
  router.get('/files/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.params;
      const userContext = getUserContext(req);
      
      const featurePath = deps.workspaceResolver.getFeaturePath(
        userContext,
        projectId,
        featureName
      );
      
      const references = FigmaFileReader.readFigmaReferences(featurePath);
      
      res.json({
        success: true,
        references,
        count: references.length
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaFiles');
    }
  });
  
  /**
   * POST /api/figma/extract/:projectId/:featureName
   * Extract design information from Figma files
   */
  router.post('/extract/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.params;
      const userContext = getUserContext(req);
      
      const featurePath = deps.workspaceResolver.getFeaturePath(
        userContext,
        projectId,
        featureName
      );
      
      const figmaAdapter = new FigmaMCPAdapter();
      const extractor = new FigmaDesignExtractor(
        figmaAdapter,
        userConfig,
        deps.workspaceRoot
      );
      
      const designs = await extractor.extractDesigns(featurePath, userContext);
      
      res.json({
        success: true,
        designs,
        count: designs.length
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaExtract');
    }
  });
  
  /**
   * POST /api/figma/create-example/:projectId/:featureName
   * Create example figma.md file
   */
  router.post('/create-example/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const { projectId, featureName } = req.params;
      const userContext = getUserContext(req);
      
      const featurePath = deps.workspaceResolver.getFeaturePath(
        userContext,
        projectId,
        featureName
      );
      
      FigmaFileReader.createExampleFile(featurePath);
      
      res.json({
        success: true,
        message: 'Example figma.md created'
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaCreateExample');
    }
  });
  
  return router;
}
