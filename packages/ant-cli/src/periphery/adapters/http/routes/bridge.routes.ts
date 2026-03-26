/**
 * Bridge Routes
 * 
 * API endpoints for the Companion App bridge.
 * The bridge is a general-purpose local machine proxy,
 * independent of any specific integration (Figma, IDE, etc.).
 */

import { Router, Request, Response } from 'express';
import { sendErrorResponse } from './helpers/errorResponse';

export interface BridgeRoutesDeps {
  stateStore?: any;
}

export function createBridgeRoutes(deps: BridgeRoutesDeps): Router {
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

  /**
   * GET /api/bridge/status
   * Check companion app bridge connection status
   */
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const userContext = getUserContext(req);

      if (!deps.stateStore) {
        return res.json({ connected: false });
      }

      const { BridgeSessionManager } = await import('../../../../infrastructure/realtime/BridgeSessionManager');
      const manager = new BridgeSessionManager(deps.stateStore);
      const status = await manager.getStatus(userContext.userId);
      res.json(status);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'BridgeStatus');
    }
  });

  return router;
}
