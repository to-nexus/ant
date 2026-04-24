/**
 * Figma Files Routes
 *
 * API endpoints for reading/writing the figma workfile reference
 * (canonical path: outputs/design/ui/figma/figma.json).
 */

import { Router, Request, Response } from 'express';
import { sendErrorResponse } from './helpers/errorResponse';
import { FigmaDataConfig, FIGMA_CONFIG_PATH, createEmptyFigmaData, migrateFigmaConfig } from '@ant/shared';
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
    return path.join(featurePath, FIGMA_CONFIG_PATH);
  };

  /**
   * GET /api/figma/config/:projectId/:featureName
   *
   * Read the canonical figma workfile reference. Canonical structure
   * (including `outputs/design/ui/{ant,figma,handoff}/` + the figma.json file
   * itself) is guaranteed to exist by `ensureCanonicalFeatureMiddleware` that
   * runs before this handler — no partial self-heal here. Legacy on-disk
   * shapes are migrated in-place.
   */
  router.get('/config/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const figmaPath = getFigmaJsonPath(req);
      let config: FigmaDataConfig;

      let content: string | undefined;
      try {
        content = await fs.readFile(figmaPath, 'utf-8');
      } catch {
        // Middleware guarantees the file exists for valid features. If read
        // still fails (feature genuinely missing, permission error, etc.),
        // surface an empty config — callers can persist via PUT.
        config = createEmptyFigmaData();
        res.json({ success: true, config });
        return;
      }

      try {
        const raw = JSON.parse(content);
        config = migrateFigmaConfig(raw);
        if (JSON.stringify(config) !== JSON.stringify(raw)) {
          await fs.writeFile(figmaPath, JSON.stringify(config, null, 2), 'utf-8');
        }
      } catch {
        config = createEmptyFigmaData();
      }

      res.json({ success: true, config });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaConfig');
    }
  });

  /**
   * PUT /api/figma/config/:projectId/:featureName
   *
   * Write the canonical figma workfile reference. Canonical parent directory
   * is guaranteed to exist by `ensureCanonicalFeatureMiddleware`.
   */
  router.put('/config/:projectId/:featureName', async (req: Request, res: Response) => {
    try {
      const figmaPath = getFigmaJsonPath(req);
      const config: FigmaDataConfig = req.body;

      await fs.writeFile(figmaPath, JSON.stringify(config, null, 2), 'utf-8');

      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'FigmaConfig');
    }
  });

  return router;
}
