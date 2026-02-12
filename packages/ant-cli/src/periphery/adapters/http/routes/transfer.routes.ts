/**
 * Transfer Routes
 * 
 * API endpoints for artifact transfer operations:
 * - POST /api/artifacts/transfer - Self-transfer (immediate)
 * - POST /api/artifacts/transfer-request - Cross-user transfer request
 * - GET  /api/artifacts/transfer-requests - List transfer requests
 * - POST /api/artifacts/transfer-requests/:id/resolve - Approve/reject
 * - POST /api/artifacts/transfer-requests/:id/cancel - Cancel pending request
 */

import { Router, Request, Response } from 'express';
import { ArtifactTransferService } from '../../../../infrastructure/workspace/ArtifactTransferService';
import { extractUserContext } from './helpers/userContext';
import { TRANSFER_ERROR_MESSAGES } from '../../../../core/types/transfer';
import { RedisStateStore } from '../../../../infrastructure/state/RedisStateStore';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';

export interface TransferRoutesDeps {
  transferService: ArtifactTransferService;
  stateStore: RedisStateStore;
}

/**
 * Send a standardized transfer error response.
 */
function sendTransferError(res: Response, error: any): void {
  const httpStatus = error.httpStatus || 500;
  const code = error.code || 'IO_ERROR';
  const message = TRANSFER_ERROR_MESSAGES[code] || '알 수 없는 오류가 발생했습니다.';
  
  res.status(httpStatus).json({
    error: code,
    message,
    ...(process.env.NODE_ENV === 'development' ? { details: error.details || error.message } : {}),
  });
}

export function createTransferRoutes(deps: TransferRoutesDeps): Router {
  const router = Router();
  const { transferService, stateStore } = deps;

  // ============================================
  // Self-Transfer (Immediate)
  // ============================================

  /**
   * POST /api/artifacts/transfer
   * Transfer files/directories between own projects/features.
   */
  router.post('/artifacts/transfer', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const { source, destination, mode = 'copy' } = req.body;

      if (!source?.projectId || !source?.featureId || !source?.path) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'source 정보가 누락되었습니다.' });
      }
      if (!destination?.projectId || !destination?.featureId || !destination?.path) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'destination 정보가 누락되었습니다.' });
      }
      if (!['copy', 'move'].includes(mode)) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'mode는 copy 또는 move여야 합니다.' });
      }

      const result = await transferService.transferOwn({
        userContext: {
          userId: userContext.userId,
          organizationId: userContext.organizationId,
        },
        source,
        destination,
        mode,
      });

      res.json(result);
    } catch (error: any) {
      sendTransferError(res, error);
    }
  });

  // ============================================
  // Cross-User Transfer Request
  // ============================================

  /**
   * POST /api/artifacts/transfer-request
   * Create a transfer request to another user (requires approval).
   */
  router.post('/artifacts/transfer-request', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const { recipient, source, destination } = req.body;

      if (!recipient?.userId) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'recipient 정보가 누락되었습니다.' });
      }
      if (!source?.projectId || !source?.featureId || !source?.path) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'source 정보가 누락되었습니다.' });
      }
      if (!destination?.projectId || !destination?.featureId || !destination?.path) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'destination 정보가 누락되었습니다.' });
      }

      const request = await transferService.requestTransfer({
        sender: {
          orgId: userContext.organizationId,
          userId: userContext.userId,
        },
        recipient: {
          orgId: recipient.orgId || userContext.organizationId,
          userId: recipient.userId,
        },
        source,
        destination,
      });

      // Notify recipient via Pub/Sub
      try {
        const channel = getRealtimeBroadcastChannel(request.recipient.orgId, request.recipient.userId);
        await stateStore.publish(channel, {
          type: 'transfer-request-new',
          requestId: request.id,
          sender: request.sender,
          source: request.source,
          destination: request.destination,
        });
      } catch {
        // Non-critical: notification failure shouldn't block request creation
      }

      res.json(request);
    } catch (error: any) {
      sendTransferError(res, error);
    }
  });

  // ============================================
  // List Transfer Requests
  // ============================================

  /**
   * GET /api/artifacts/transfer-requests
   * List transfer requests (received or sent).
   * Query params:
   *   - direction: 'received' (default) | 'sent'
   *   - status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' (optional)
   */
  router.get('/artifacts/transfer-requests', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const direction = (req.query.direction as string) || 'received';
      const status = req.query.status as string | undefined;

      let requests;
      if (direction === 'sent') {
        requests = await stateStore.getTransferRequestsBySender(
          userContext.organizationId,
          userContext.userId,
          status as any
        );
      } else {
        requests = await stateStore.getTransferRequestsByRecipient(
          userContext.organizationId,
          userContext.userId,
          status as any
        );
      }

      // Sort by createdAt descending
      requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({
        requests,
        count: requests.length,
        pendingCount: requests.filter(r => r.status === 'pending').length,
      });
    } catch (error: any) {
      sendTransferError(res, error);
    }
  });

  // ============================================
  // Resolve Transfer Request
  // ============================================

  /**
   * POST /api/artifacts/transfer-requests/:id/resolve
   * Approve or reject a transfer request.
   * Body: { action: 'approve' | 'reject' }
   */
  router.post('/artifacts/transfer-requests/:id/resolve', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const requestId = req.params.id;
      const { action } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'INVALID_PATH', message: 'action은 approve 또는 reject여야 합니다.' });
      }

      const result = await transferService.resolveTransfer(
        requestId,
        action,
        userContext.userId,
        userContext.organizationId
      );

      // Notify sender of resolution via Pub/Sub
      try {
        const channel = getRealtimeBroadcastChannel(result.sender.orgId, result.sender.userId);
        await stateStore.publish(channel, {
          type: 'transfer-request-resolved',
          requestId: result.id,
          action,
        });
      } catch {
        // Non-critical
      }

      res.json(result);
    } catch (error: any) {
      console.error(`📦 [Transfer] Resolve failed for ${req.params.id}:`, error.code || error.message, error.details || '');
      sendTransferError(res, error);
    }
  });

  // ============================================
  // Cancel Transfer Request
  // ============================================

  /**
   * POST /api/artifacts/transfer-requests/:id/cancel
   * Cancel a pending transfer request (sender only).
   */
  router.post('/artifacts/transfer-requests/:id/cancel', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const requestId = req.params.id;

      const result = await transferService.cancelTransfer(
        requestId,
        userContext.userId,
        userContext.organizationId
      );

      // Notify recipient of cancellation via Pub/Sub
      try {
        const channel = getRealtimeBroadcastChannel(result.recipient.orgId, result.recipient.userId);
        await stateStore.publish(channel, {
          type: 'transfer-request-cancelled',
          requestId: result.id,
        });
      } catch {
        // Non-critical
      }

      res.json(result);
    } catch (error: any) {
      sendTransferError(res, error);
    }
  });

  return router;
}
