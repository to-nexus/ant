/**
 * Billing routes — balance / usage / top-up.
 *
 * Customer surface speaks credits; USD cost + per-model breakdown are gated to
 * organization owners (operators). For the test phase a non-cloud (local)
 * tenant is treated as operator so cost is fully visible during development.
 */

import { Router, Request, Response } from 'express';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import type { CreditLedgerPort } from '../../../../core/ports/creditLedger';
import type { PaymentProviderPort } from '../../../../core/ports/paymentProvider';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import type { UsageHistoryResponse } from '@ant/shared';
import { logger } from '../../../../utils/logger';

export interface BillingRoutesDeps {
  creditLedger: CreditLedgerPort;
  paymentProvider: PaymentProviderPort;
  /** Cloud-mode only; absent in local. When absent, the caller is the operator. */
  organizationRepository?: OrganizationRepositoryPort;
}

export function createBillingRoutes(deps: BillingRoutesDeps): Router {
  const router = Router();

  // GET /billing/balance → { tier, credits, microCredits, includedCreditsMonthly }
  router.get('/billing/balance', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      const snapshot = await deps.creditLedger.getBalance(organizationId, userId);
      res.json(snapshot);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  // GET /billing/usage?limit=N → { transactions, canViewUsd }
  // Fully transparent: USD cost + per-model breakdown are returned to everyone
  // (token → real USD → credit). The role-gate seam is retained in code
  // (`canViewUsd` above) for a future tightening, but is not applied now.
  router.get('/billing/usage', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 500));
      const txs = await deps.creditLedger.listTransactions(organizationId, userId, limit);
      const body: UsageHistoryResponse = { transactions: txs, canViewUsd: true };
      res.json(body);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  // POST /billing/topup { credits, idempotencyKey } → BalanceSnapshot
  router.post('/billing/topup', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      const credits = Number(req.body?.credits);
      const idempotencyKey = String(req.body?.idempotencyKey ?? `topup-${Date.now()}`);
      if (!Number.isFinite(credits) || credits <= 0) {
        res.status(400).json({ error: 'credits must be a positive number', code: 'invalid-credits' });
        return;
      }
      const result = await deps.paymentProvider.topUp({ orgId: organizationId, userId, credits, idempotencyKey });
      if (!result.ok) {
        res.status(402).json({ error: result.reason ?? 'top-up failed', code: 'topup-failed' });
        return;
      }
      const snapshot = await deps.creditLedger.getBalance(organizationId, userId);
      logger.info(`top-up ${credits} credits → ${organizationId}:${userId}`, { component: 'Billing' });
      res.json(snapshot);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  return router;
}
