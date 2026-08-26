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
  AdminAccountRow,
  AdminAccountListResponse,
  AdminScopeDetail,
  AdminScopeInfo,
  AdminUserDetail,
  AdminUserIdentity,
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
  deriveKindFromOrgId,
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
/** Onboarding sentinel — never a real billing scope. */
const PENDING_ORG_SENTINEL = '_pending';

/**
 * `peekBalance` never applies a due grant, so a stale cycle would otherwise be
 * indistinguishable from a spent balance. `nextBillingDate` is the cycle end.
 */
function isGrantOverdue(balance: { nextBillingDate?: string }): boolean {
  if (!balance.nextBillingDate) return false;
  const due = Date.parse(balance.nextBillingDate);
  return Number.isFinite(due) && due < Date.now();
}
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

  function toIdentity(u: UserRecord): AdminUserIdentity {
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
    };
  }

  /**
   * Per-request org cache — the shared `individual` org is a member of nearly
   * every user, so resolving per user would refetch it once per row.
   */
  function orgResolver(): (orgId: string) => Promise<Organization | null> {
    const cache = new Map<string, Promise<Organization | null>>();
    return (orgId) => {
      let hit = cache.get(orgId);
      if (!hit) {
        hit = organizationRepository.getOrganization(orgId);
        cache.set(orgId, hit);
      }
      return hit;
    };
  }

  /**
   * Every scope whose money belongs to this user: memberships (the authoritative
   * list), plus scopes the ledger still holds an account for so a balance that
   * outlived its membership stays visible, plus the active pointer as a
   * legacy-`personal-*` safety net. `currentOrganizationId` is a denormalised
   * JWT-issuance pointer and is never the authority here.
   *
   * `includeUnaccounted` keeps scopes the ledger has no account for — the detail
   * view shows them so an admin can tell "org exists, never billed" apart from
   * "org absent".
   */
  async function resolveScopes(
    u: UserRecord,
    resolveOrg: (orgId: string) => Promise<Organization | null>,
    includeUnaccounted = false,
  ): Promise<AdminScopeInfo[]> {
    const [memberships, ledgerScopes] = await Promise.all([
      organizationRepository.listMembershipsByUser(u.id),
      creditLedger.listAccountScopes(u.id),
    ]);

    const roleByOrg = new Map(memberships.map((m) => [m.organizationId, m.role]));
    const active = u.currentOrganizationId ?? INDIVIDUAL_ORG_ID;
    const candidates = new Set(
      [...roleByOrg.keys(), ...ledgerScopes, active].filter(
        (id) => id !== PENDING_ORG_SENTINEL,
      ),
    );

    const build = async (
      organizationId: string,
      force = false,
    ): Promise<AdminScopeInfo | null> => {
      const [peeked, org] = await Promise.all([
        creditLedger.peekBalance(organizationId, u.id),
        resolveOrg(organizationId),
      ]);
      if (!peeked && !includeUnaccounted && !force) return null;
      const role = roleByOrg.get(organizationId);
      // A pre-cutover account's stored number is in the old unit, so report the
      // account's existence without a balance rather than a wrong one.
      const usable = peeked && !peeked.stale ? peeked.snapshot : null;
      return {
        organizationId,
        organizationName: org?.name,
        organizationKind: org?.kind ?? deriveKindFromOrgId(organizationId),
        role,
        orphaned: role === undefined,
        active: organizationId === active,
        tier: usable?.tier ?? null,
        credits: usable?.credits ?? null,
        grantOverdue: usable ? isGrantOverdue(usable) : false,
        stale: peeked?.stale ?? false,
      };
    };

    // Wrap: `.map(build)` would pass the array index in as `force`.
    const rows = (await Promise.all([...candidates].map((id) => build(id)))).filter(
      (r): r is AdminScopeInfo => r !== null,
    );

    // Approval and test level are user-axis duties, so a user with no billing
    // account anywhere must still be listed — otherwise a brand-new pending
    // account would be invisible and therefore unapprovable.
    if (rows.length === 0) {
      const fallback =
        [...roleByOrg.keys()].find((id) => deriveKindFromOrgId(id) === 'individual') ??
        memberships[0]?.organizationId ??
        INDIVIDUAL_ORG_ID;
      return [(await build(fallback, true))!];
    }

    return rows.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.organizationId.localeCompare(b.organizationId),
    );
  }

  async function toRows(
    u: UserRecord,
    resolveOrg: (orgId: string) => Promise<Organization | null>,
  ): Promise<AdminAccountRow[]> {
    const identity = toIdentity(u);
    const scopes = await resolveScopes(u, resolveOrg);
    return scopes.map((scope) => ({ ...identity, ...scope }));
  }

  // GET /admin/users?status=&limit=&organizationId= → { rows, defaultApprovalMode }
  // One row per (user × scope). `limit` bounds the identity axis; the org
  // filter applies to assembled rows, since rows outnumber users.
  router.get('/admin/users', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as ApprovalStatus | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) || undefined : undefined;
      const organizationId = req.query.organizationId
        ? String(req.query.organizationId)
        : undefined;
      const records = await organizationRepository.listUsers({
        ...(status && APPROVAL_VALUES.includes(status) ? { status } : {}),
        ...(limit ? { limit } : {}),
      });
      const resolveOrg = orgResolver();
      const assembled = await Promise.all(records.map((u) => toRows(u, resolveOrg)));
      const rows = assembled
        .flat()
        .filter((r) => !organizationId || r.organizationId === organizationId);
      const cfg = await organizationRepository.getAdminConfig();
      const body: AdminAccountListResponse = {
        rows,
        defaultApprovalMode: cfg.defaultApprovalMode,
      };
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
      const [memberships, scopeInfos] = await Promise.all([
        organizationRepository.listMembershipsByUser(userId),
        resolveScopes(u, orgResolver(), true),
      ]);
      const scopes: AdminScopeDetail[] = await Promise.all(
        scopeInfos.map(async (scope) => ({
          ...scope,
          balance:
            (await creditLedger.peekBalance(scope.organizationId, u.id))?.snapshot ?? null,
          transactions:
            scope.tier === null && !scope.stale
              ? []
              : await creditLedger.listTransactions(
                  scope.organizationId,
                  u.id,
                  CREDIT_LEDGER_MAX_ENTRIES,
                ),
        })),
      );
      const detail: AdminUserDetail = {
        ...toIdentity(u),
        memberships: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
        scopes,
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
      res.json(u ? { rows: await toRows(u, orgResolver()) } : { ok: true });
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
      res.json(u ? { rows: await toRows(u, orgResolver()) } : { ok: true });
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
