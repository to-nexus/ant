/**
 * Admin routes — super-admin-only surface for the admin dashboard.
 *
 * Identity-axis operations (approval / test level / default policy / user
 * listing) — OSS core, available on every cloud-mode deployment including
 * self-hosted. The billing-axis admin action (refund) lives in the
 * `@ant/cloud` overlay (`admin-billing.routes.ts`), mounted before this
 * router so both share the same `/api/admin/*` gate semantics.
 *
 * `req.user.email` is set by the `jwtAuth` middleware. `/api/admin/*` is NOT
 * in the public-paths allowlist, so it already requires a valid session before
 * `requireAdmin` runs. `requireAdmin` is env-authoritative
 * (`ANT_SUPER_ADMIN_EMAILS`), never the DB projection.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendErrorResponse } from './helpers/errorResponse';
import type { CreditLedgerPort } from '../../../../core/ports/creditLedger';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import type { UserRecord } from '../../../../core/auth/types';
import type {
  AdminUserSummary,
  AdminUserDetail,
  AdminUserListResponse,
  ApprovalStatus,
  DefaultApprovalMode,
  AdminOrgSummary,
  AdminOrgDetail,
} from '@ant/shared';
import {
  ADMIN_REQUIRED,
  CREDIT_LEDGER_MAX_ENTRIES,
  INDIVIDUAL_ORG_ID,
  ORG_NOT_FOUND,
  DOMAIN_NOT_FOUND,
} from '@ant/shared';
import { isSuperAdminEmail } from '../../../../core/auth/superAdmin';
import { toInviteView, toDomainClaimView, buildMemberViews } from './teams.routes';
import type { Organization } from '../../../../core/auth/types';
import { logger } from '../../../../utils/logger';

export interface AdminRoutesDeps {
  creditLedger: CreditLedgerPort;
  organizationRepository: OrganizationRepositoryPort;
}

const APPROVAL_VALUES: readonly ApprovalStatus[] = ['pending', 'approved', 'denied'];
const POLICY_VALUES: readonly DefaultApprovalMode[] = ['auto-approve', 'require-approval'];

export function createAdminRoutes(deps: AdminRoutesDeps): Router {
  const router = Router();
  const { creditLedger, organizationRepository } = deps;

  // Every /admin/* route requires a super-admin session (env-authoritative).
  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    const email = (req as any).user?.email as string | undefined;
    if (!isSuperAdminEmail(email)) {
      res.status(403).json({ error: 'admin access required', code: ADMIN_REQUIRED });
      return;
    }
    next();
  };
  router.use('/admin', requireAdmin);

  function orgOf(u: UserRecord): string {
    return u.currentOrganizationId ?? INDIVIDUAL_ORG_ID;
  }

  async function toSummary(u: UserRecord): Promise<AdminUserSummary> {
    const balance = await creditLedger.getBalance(orgOf(u), u.id);
    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      picture: u.picture,
      approvalStatus: u.approvalStatus ?? 'approved',
      approvedAt: u.approvedAt,
      approvedBy: u.approvedBy,
      createdAt: u.createdAt,
      isSuperAdmin: u.isSuperAdmin ?? false,
      testAccountLevel: u.testAccountLevel ?? 0,
      tier: balance.tier,
      credits: balance.credits,
    };
  }

  // GET /admin/users?status=&limit= → { users, defaultApprovalMode }
  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as ApprovalStatus | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) || undefined : undefined;
      const records = await organizationRepository.listUsers({
        ...(status && APPROVAL_VALUES.includes(status) ? { status } : {}),
        ...(limit ? { limit } : {}),
      });
      const users = await Promise.all(records.map((u) => toSummary(u)));
      const cfg = await organizationRepository.getAdminConfig();
      const body: AdminUserListResponse = { users, defaultApprovalMode: cfg.defaultApprovalMode };
      res.json(body);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // GET /admin/users/:userId → AdminUserDetail
  router.get('/admin/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      const u = await organizationRepository.getUser(userId);
      if (!u) {
        res.status(404).json({ error: 'user not found', code: 'user-not-found' });
        return;
      }
      const summary = await toSummary(u);
      const memberships = await organizationRepository.listMembershipsByUser(userId);
      const balance = await creditLedger.getBalance(orgOf(u), u.id);
      const transactions = await creditLedger.listTransactions(orgOf(u), u.id, CREDIT_LEDGER_MAX_ENTRIES);
      const detail: AdminUserDetail = {
        ...summary,
        memberships: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
        balance,
        transactions,
      };
      res.json(detail);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // POST /admin/users/:userId/approval { status } — bidirectional control
  router.post('/admin/users/:userId/approval', async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      const status = req.body?.status as ApprovalStatus;
      if (!APPROVAL_VALUES.includes(status)) {
        res.status(400).json({ error: 'invalid status', code: 'invalid-status' });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      await organizationRepository.setUserApproval(userId, status, adminEmail);
      logger.info(`[Admin] approval ${userId} → ${status} by ${adminEmail}`, { component: 'Admin' });
      const u = await organizationRepository.getUser(userId);
      res.json(u ? await toSummary(u) : { ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // POST /admin/users/:userId/test-level { testAccountLevel }
  router.post('/admin/users/:userId/test-level', async (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      const level = Number(req.body?.testAccountLevel);
      if (!Number.isFinite(level) || level < 0) {
        res.status(400).json({ error: 'invalid level', code: 'invalid-level' });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      await organizationRepository.setTestAccountLevel(userId, level, adminEmail);
      const u = await organizationRepository.getUser(userId);
      res.json(u ? await toSummary(u) : { ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // NOTE: POST /admin/users/:userId/refund (billing-axis, mutates the ledger)
  // lives in the @ant/cloud overlay (`admin-billing.routes.ts`) — absent on
  // self-hosted deployments where the ledger is Noop.

  // ======== Organizations (superadmin oversight — Phase 1) ========

  async function toOrgSummary(org: Organization): Promise<AdminOrgSummary> {
    const [members, domains] = await Promise.all([
      organizationRepository.listOrgMemberships(org.id),
      organizationRepository.listOrgDomains(org.id),
    ]);
    return {
      id: org.id,
      name: org.name,
      kind: org.kind ?? 'team',
      ownerId: org.ownerId,
      memberCount: members.length,
      domainCount: domains.length,
      createdAt: org.createdAt,
      ...(org.deletedAt ? { deletedAt: org.deletedAt } : {}),
    };
  }

  // GET /admin/organizations → AdminOrgSummary[] (soft-deleted included)
  router.get('/admin/organizations', async (_req: Request, res: Response) => {
    try {
      const orgs = await organizationRepository.listOrganizations({ includeDeleted: true });
      res.json({ organizations: await Promise.all(orgs.map((o) => toOrgSummary(o))) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // GET /admin/organizations/:orgId → AdminOrgDetail
  router.get('/admin/organizations/:orgId', async (req: Request, res: Response) => {
    try {
      const org = await organizationRepository.getOrganization(req.params.orgId);
      if (!org) {
        res.status(404).json({ error: 'organization not found', code: ORG_NOT_FOUND });
        return;
      }
      const [summary, memberships, invites, domains] = await Promise.all([
        toOrgSummary(org),
        organizationRepository.listOrgMemberships(org.id),
        organizationRepository.listOrgInvites(org.id),
        organizationRepository.listOrgDomains(org.id),
      ]);
      const detail: AdminOrgDetail = {
        ...summary,
        members: await buildMemberViews(organizationRepository, memberships),
        invites: invites.map(toInviteView),
        domains: domains.map(toDomainClaimView),
      };
      res.json(detail);
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // POST /admin/organizations/:orgId/domains/:domain/verify — manual verify
  // (path c of decision 6). `verifiedBy` records the operator email.
  router.post('/admin/organizations/:orgId/domains/:domain/verify', async (req: Request, res: Response) => {
    try {
      const claim = await organizationRepository.getDomainClaim(req.params.domain.toLowerCase());
      if (!claim || claim.organizationId !== req.params.orgId) {
        res.status(404).json({ error: 'domain claim not found', code: DOMAIN_NOT_FOUND });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      claim.status = 'verified';
      claim.verifiedAt = new Date().toISOString();
      claim.verifiedBy = adminEmail;
      await organizationRepository.updateDomainClaim(claim);
      logger.info(`[Admin] domain ${claim.domain} manually verified by ${adminEmail}`, { component: 'Admin' });
      res.json({ domain: toDomainClaimView(claim) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // POST /admin/organizations/:orgId/domains/:domain/reject — superadmin verdict
  router.post('/admin/organizations/:orgId/domains/:domain/reject', async (req: Request, res: Response) => {
    try {
      const claim = await organizationRepository.getDomainClaim(req.params.domain.toLowerCase());
      if (!claim || claim.organizationId !== req.params.orgId) {
        res.status(404).json({ error: 'domain claim not found', code: DOMAIN_NOT_FOUND });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      claim.status = 'rejected';
      claim.verifiedAt = new Date().toISOString();
      claim.verifiedBy = adminEmail;
      await organizationRepository.updateDomainClaim(claim);
      logger.info(`[Admin] domain ${claim.domain} rejected by ${adminEmail}`, { component: 'Admin' });
      res.json({ domain: toDomainClaimView(claim) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // DELETE /admin/organizations/:orgId — force soft-delete cascade
  router.delete('/admin/organizations/:orgId', async (req: Request, res: Response) => {
    try {
      const org = await organizationRepository.getOrganization(req.params.orgId);
      if (!org) {
        res.status(404).json({ error: 'organization not found', code: ORG_NOT_FOUND });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      await organizationRepository.softDeleteOrganization(org.id, adminEmail);
      logger.info(`[Admin] force-deleted org ${org.id} by ${adminEmail}`, { component: 'Admin' });
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // GET /admin/config → AdminConfig
  router.get('/admin/config', async (_req: Request, res: Response) => {
    try {
      res.json(await organizationRepository.getAdminConfig());
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  // PUT /admin/config { defaultApprovalMode }
  router.put('/admin/config', async (req: Request, res: Response) => {
    try {
      const mode = req.body?.defaultApprovalMode as DefaultApprovalMode;
      if (!POLICY_VALUES.includes(mode)) {
        res.status(400).json({ error: 'invalid mode', code: 'invalid-mode' });
        return;
      }
      const adminEmail = (req as any).user?.email as string;
      await organizationRepository.setAdminConfig(mode, adminEmail);
      logger.info(`[Admin] default policy → ${mode} by ${adminEmail}`, { component: 'Admin' });
      res.json(await organizationRepository.getAdminConfig());
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Admin');
    }
  });

  return router;
}
