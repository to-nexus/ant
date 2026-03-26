/**
 * Figma Files Routes
 * 
 * API endpoints for reading/writing inputs/figma.json in features.
 */

import { Router, Request, Response } from 'express';
import { sendErrorResponse } from './helpers/errorResponse';
import { FigmaDataConfig, FIGMA_FILENAME, createEmptyFigmaData, migrateFigmaConfig } from '@ant/shared';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface FigmaFilesRoutesDeps {
  workspaceRoot: string;
  workspaceResolver: any;
}

export function createFigmaFilesRoutes(deps: FigmaFilesRoutesDeps): Router {
  const router = Router();

  const getUserContext = (req: Request) => {
    if ((req as any).user && (req as any).organization) {
      return {
        userId: (req as any).user.id,
        organizationId: (req as any).organization.id,
      };
    }
    return { userId: 'local', organizationId: 'local' };
  };

  const getFigmaJsonPath = (req: Request): string => {
    const { projectId, featureName } = req.params;
    const userContext = getUserContext(req);
    const featurePath = deps.workspaceResolver.getFeaturePath(
      userContext,
      projectId,
      featureName
    );
    return path.join(featurePath, 'inputs', FIGMA_FILENAME);
  };

  /**
   * GET /api/figma/config/:projectId/:featureName
   * Read inputs/figma.json — auto-creates if missing, auto-migrates legacy format.
   */
  router.get('/config/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const figmaPath = getFigmaJsonPath(req);
      let config: FigmaDataConfig;

      let fileExists = true;
      let content: string | undefined;
      try {
        content = await fs.readFile(figmaPath, 'utf-8');
      } catch {
        fileExists = false;
      }

      if (!fileExists) {
        config = createEmptyFigmaData();
        await fs.mkdir(path.dirname(figmaPath), { recursive: true });
        await fs.writeFile(figmaPath, JSON.stringify(config, null, 2), 'utf-8');
      } else {
        try {
          const raw = JSON.parse(content!);
          config = migrateFigmaConfig(raw);
          if (JSON.stringify(config) !== JSON.stringify(raw)) {
            await fs.writeFile(figmaPath, JSON.stringify(config, null, 2), 'utf-8');
          }
        } catch {
          config = createEmptyFigmaData();
        }
      }

      res.json({ success: true, config });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaConfig');
    }
  });

  /**
   * PUT /api/figma/config/:projectId/:featureName
   * Write inputs/figma.json
   */
  router.put('/config/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const figmaPath = getFigmaJsonPath(req);
      const config: FigmaDataConfig = req.body;

      await fs.mkdir(path.dirname(figmaPath), { recursive: true });
      await fs.writeFile(figmaPath, JSON.stringify(config, null, 2), 'utf-8');

      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaConfig');
    }
  });

  return router;
}
