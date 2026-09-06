/**
 * Approvals inbox — pending gates across the caller's own activations, and
 * the API resolve leg (same NX-guarded ChatService funnel as a card click).
 */

import type { Router, Request, Response } from 'express';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import { sendErrorResponse } from '../helpers/errorResponse';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerApprovalRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps } = ctx;

  // ── Approvals (inbox — the caller's own activations) ─────────────────
  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const approvals = await deps.coordinator.listPendingApprovals(owner);
      res.json({ approvals });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprovals');
    }
  });

  router.post('/approvals/:gateId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        res.status(400).json({ error: 'decision must be "approve" or "reject"' });
        return;
      }
      const hitl = await deps.coordinator.getHitlByGateId(req.params.gateId);
      if (!hitl || hitl.owner.userId !== owner.userId || hitl.owner.organizationId !== owner.organizationId) {
        res.status(404).json({ error: 'gate not found', gateId: req.params.gateId });
        return;
      }
      if (!deps.chatService) {
        res.status(503).json({ error: 'Chat service not available' });
        return;
      }
      // The card lives in the RUN's project (the route is cross-project).
      const run = await deps.coordinator.getRun(hitl.runId);
      if (!run) {
        res.status(404).json({ error: 'run not found for gate', gateId: req.params.gateId });
        return;
      }
      // Single funnel: same NX-guarded resolve as a chat-card click.
      const result = await deps.chatService.appendChoiceResolved(run.projectId, UNIVERSAL_FEATURE, {
        jobId: hitl.anchorJobId,
        cardId: hitl.cardId,
        choiceSelected: decision,
        resolvedLabel: decision === 'approve' ? 'Approved' : 'Rejected',
        userContext: owner,
      });
      if (!result.resolved) {
        res.status(409).json({ error: 'gate already resolved', gateId: req.params.gateId });
        return;
      }
      await deps.coordinator.applyResolvedGate(
        hitl.cardId,
        decision === 'approve' ? 'approved' : 'rejected',
        owner.userId,
        'api',
      );
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprove');
    }
  });
}
