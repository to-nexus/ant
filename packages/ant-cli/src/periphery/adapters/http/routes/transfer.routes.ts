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
import * as fs from 'fs';
import * as path from 'path';
import { ArtifactTransferService } from '../../../../infrastructure/workspace/ArtifactTransferService';
import { extractUserContext } from './helpers/userContext';
import { TRANSFER_ERROR_MESSAGES } from '../../../../core/types/transfer';
import { RedisStateStore } from '../../../../infrastructure/state/RedisStateStore';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';

export interface TransferRoutesDeps {
  transferService: ArtifactTransferService;
  stateStore: RedisStateStore;
  workspaceResolver?: any;  // For resolving feature paths (unseen artifact tracking)
}

/**
 * Recursively collect all file paths under a directory (feature-relative).
 */
async function collectFilePaths(fullPath: string, featurePath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const stat = await fs.promises.stat(fullPath);
    if (stat.isFile()) {
      results.push(path.relative(featurePath, fullPath).replace(/\\/g, '/'));
    } else if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        if (entry.isFile()) {
          results.push(path.relative(featurePath, entryPath).replace(/\\/g, '/'));
        } else if (entry.isDirectory()) {
          const sub = await collectFilePaths(entryPath, featurePath);
          results.push(...sub);
        }
      }
    }
  } catch {
    // Ignore errors (destination may not exist yet)
  }
  return results;
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
  const { transferService, stateStore, workspaceResolver } = deps;

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

      // Add unseen artifact notifications for transferred files
      if (workspaceResolver && result.success) {
        try {
          const destFeaturePath = workspaceResolver.getFeaturePath(
            userContext, destination.projectId, destination.featureId
          );
          const destFullPath = path.join(destFeaturePath, destination.path);
          const transferredPaths = await collectFilePaths(destFullPath, destFeaturePath);
          if (transferredPaths.length > 0) {
            await stateStore.addUnseenArtifacts(
              userContext.userId, destination.projectId, destination.featureId, transferredPaths
            );
            const allUnseen = await stateStore.getUnseenArtifacts(
              userContext.userId, destination.projectId, destination.featureId
            );
            const channel = getRealtimeBroadcastChannel(
              userContext.organizationId, userContext.userId
            );
            await stateStore.publish(channel, {
              projectId: destination.projectId, featureName: destination.featureId,
              type: 'unseenArtifacts',
              data: { type: 'update', paths: allUnseen }, userContext,
            });
          }
        } catch (e) {
          console.warn(`📦 [Transfer] Failed to add unseen artifacts: ${(e as Error).message}`);
        }
      }

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

      // Add unseen artifact notifications for approved transfers
      if (action === 'approve' && workspaceResolver) {
        try {
          const recipientUserContext = {
            userId: result.recipient.userId,
            organizationId: result.recipient.orgId,
            workspacePath: '',
          };
          const destFeaturePath = workspaceResolver.getFeaturePath(
            recipientUserContext, result.destination.projectId, result.destination.featureId
          );
          const destFullPath = path.join(destFeaturePath, result.destination.path);
          const transferredPaths = await collectFilePaths(destFullPath, destFeaturePath);
          if (transferredPaths.length > 0) {
            await stateStore.addUnseenArtifacts(
              result.recipient.userId, result.destination.projectId,
              result.destination.featureId, transferredPaths
            );
            const allUnseen = await stateStore.getUnseenArtifacts(
              result.recipient.userId, result.destination.projectId,
              result.destination.featureId
            );
            const recipientChannel = getRealtimeBroadcastChannel(
              result.recipient.orgId, result.recipient.userId
            );
            await stateStore.publish(recipientChannel, {
              projectId: result.destination.projectId,
              featureName: result.destination.featureId,
              type: 'unseenArtifacts',
              data: { type: 'update', paths: allUnseen },
              userContext: recipientUserContext,
            });
          }
        } catch (e) {
          console.warn(`📦 [Transfer] Failed to add unseen artifacts for approved transfer: ${(e as Error).message}`);
        }
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

  // ============================================
  // Delete Transfer Request (Remove from history)
  // ============================================

  /**
   * DELETE /api/artifacts/transfer-requests/:id
   * Delete a completed transfer request from history.
   * Only the sender can delete their own sent requests.
   * Only non-pending requests can be deleted (approved/rejected/expired/cancelled).
   */
  router.delete('/artifacts/transfer-requests/:id', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const requestId = req.params.id;

      // Verify the request exists and belongs to the sender
      const request = await stateStore.getTransferRequest(requestId);
      if (!request) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '전송 요청을 찾을 수 없습니다.' });
      }

      // Only sender can delete
      if (request.sender.userId !== userContext.userId || request.sender.orgId !== userContext.organizationId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '본인이 보낸 요청만 삭제할 수 있습니다.' });
      }

      // Only completed (non-pending) requests can be deleted
      if (request.status === 'pending') {
        return res.status(400).json({ error: 'INVALID_STATUS', message: '대기 중인 요청은 취소만 가능합니다.' });
      }

      await stateStore.deleteTransferRequest(requestId);

      res.json({ success: true, id: requestId });
    } catch (error: any) {
      sendTransferError(res, error);
    }
  });

  return router;
}
