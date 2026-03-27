/**
 * Bridge Routes
 * 
 * API endpoints for the Ant Desktop bridge.
 * The bridge is a general-purpose local machine proxy,
 * independent of any specific integration (Figma, IDE, etc.).
 */

import { Router, Request, Response } from 'express';
import { BRIDGE_PROBE_TIMEOUT_MS } from '@ant/shared';
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
   * Check Ant Desktop bridge connection status
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

  /**
   * POST /api/bridge/probe
   * Trigger an on-demand heartbeat from Ant Desktop and wait for fresh status.
   * Uses the same publish → poll pattern as MCP request-response relay.
   */
  router.post('/probe', async (req: Request, res: Response) => {
    try {
      const userContext = getUserContext(req);

      if (!deps.stateStore) {
        return res.json({ connected: false, detected: false });
      }

      const { BridgeSessionManager } = await import('../../../../infrastructure/realtime/BridgeSessionManager');
      const manager = new BridgeSessionManager(deps.stateStore);

      const currentStatus = await manager.getStatus(userContext.userId);
      if (!currentStatus.connected) {
        return res.json(currentStatus);
      }

      const session = currentStatus.session!;
      const prevPingAt = session.lastPingAt;

      await deps.stateStore.publish(`bridge:status:probe:${userContext.userId}`, { type: 'probe' });

      const startTime = Date.now();
      const pollInterval = 200;

      while (Date.now() - startTime < BRIDGE_PROBE_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, pollInterval));
        const freshStatus = await manager.getStatus(userContext.userId);
        if (freshStatus.session && freshStatus.session.lastPingAt > prevPingAt) {
          return res.json(freshStatus);
        }
      }

      return res.json(await manager.getStatus(userContext.userId));
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'BridgeProbe');
    }
  });

  return router;
}
