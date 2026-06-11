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
import type { UsageHistoryResponse, PaymentMethodInput, SubscriptionTier } from '@ant/shared';
import { CREDIT_LEDGER_MAX_ENTRIES } from '@ant/shared';
import { getCreditPackage, getPlan, buildCatalog } from '../../../../infrastructure/billing/catalog';
import { logger } from '../../../../utils/logger';

const PAID_TIERS: readonly SubscriptionTier[] = ['pro', 'max'];

export interface BillingRoutesDeps {
  creditLedger: CreditLedgerPort;
  paymentProvider: PaymentProviderPort;
  /** Cloud-mode only; absent in local. When absent, the caller is the operator. */
  organizationRepository?: OrganizationRepositoryPort;
}

export function createBillingRoutes(deps: BillingRoutesDeps): Router {
  const router = Router();

  // GET /billing/catalog → { plans, creditPackages, currency }
  // Server-driven offering: the FE never hardcodes plan/package pricing.
  router.get('/billing/catalog', (_req: Request, res: Response) => {
    res.json(buildCatalog());
  });

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
      const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, CREDIT_LEDGER_MAX_ENTRIES));
      const txs = await deps.creditLedger.listTransactions(organizationId, userId, limit);
      const body: UsageHistoryResponse = { transactions: txs, canViewUsd: true };
      res.json(body);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  // POST /billing/purchase { packageId, paymentMethod, idempotencyKey } → BalanceSnapshot
  // Price + credits are resolved server-side from the CREDIT_PACKAGES SSOT; the
  // client-sent body is never trusted for amount/credits.
  router.post('/billing/purchase', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      const packageId = String(req.body?.packageId ?? '');
      const paymentMethod = req.body?.paymentMethod as PaymentMethodInput | undefined;
      const idempotencyKey = String(req.body?.idempotencyKey ?? `purchase-${Date.now()}`);

      const pkg = getCreditPackage(packageId);
      if (!pkg) {
        res.status(400).json({ error: 'unknown package', code: 'invalid-package' });
        return;
      }
      if (!paymentMethod || typeof paymentMethod !== 'object') {
        res.status(400).json({ error: 'payment method required', code: 'missing-payment-method' });
        return;
      }

      const outcome = await deps.paymentProvider.purchaseCredits({
        orgId: organizationId,
        userId,
        packageId: pkg.id,
        credits: pkg.credits,
        amountUsd: pkg.priceUsd,
        paymentMethod,
        idempotencyKey,
      });
      if (!outcome.ok) {
        res.status(402).json({
          error: outcome.reason ?? 'payment failed',
          code: outcome.status,
          declineCode: outcome.declineCode,
        });
        return;
      }
      const snapshot = await deps.creditLedger.getBalance(organizationId, userId);
      logger.info(
        `purchase ${pkg.id} (+${pkg.credits} credits, $${pkg.priceUsd}) → ${organizationId}:${userId}`,
        { component: 'Billing' },
      );
      res.json(snapshot);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  // POST /billing/subscribe { tier, paymentMethod?, idempotencyKey } → BalanceSnapshot
  // Price is resolved server-side from the catalog SSOT; the client-sent body is
  // never trusted for amount. The provider charges; the ledger owns tier-change.
  router.post('/billing/subscribe', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      const tier = String(req.body?.tier ?? '') as SubscriptionTier;
      const paymentMethod = req.body?.paymentMethod as PaymentMethodInput | undefined;
      const idempotencyKey = String(req.body?.idempotencyKey ?? `subscribe-${Date.now()}`);

      if (!PAID_TIERS.includes(tier)) {
        // `free` is a cancellation, not a subscribe; unknown tiers are invalid.
        res.status(400).json({ error: 'invalid tier', code: 'invalid-tier' });
        return;
      }
      // Resolve the plan from the catalog SSOT (validates the tier exists).
      getPlan(tier);

      const outcome = await deps.paymentProvider.startSubscription(
        organizationId,
        userId,
        tier,
        paymentMethod,
      );
      if (!outcome.ok) {
        res.status(402).json({
          error: outcome.reason ?? 'payment failed',
          code: outcome.status ?? 'error',
          declineCode: outcome.declineCode,
        });
        return;
      }
      const snapshot = await deps.creditLedger.changeTier(organizationId, userId, tier, {
        providerRef: outcome.providerRef,
        idempotencyKey,
      });
      logger.info(`subscribe ${tier} → ${organizationId}:${userId}`, { component: 'Billing' });
      res.json(snapshot);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  // POST /billing/cancel-subscription → BalanceSnapshot (cycle-end downgrade)
  router.post('/billing/cancel-subscription', async (req: Request, res: Response) => {
    try {
      const { userId, organizationId } = extractUserContext(req);
      await deps.paymentProvider.cancelSubscription(organizationId, userId);
      const snapshot = await deps.creditLedger.cancelSubscription(organizationId, userId);
      logger.info(`cancel-subscription → ${organizationId}:${userId}`, { component: 'Billing' });
      res.json(snapshot);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Billing');
    }
  });

  return router;
}
