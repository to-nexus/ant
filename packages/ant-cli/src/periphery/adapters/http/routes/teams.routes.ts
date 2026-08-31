/**
 * Team organization routes (Phase 1) — creation, membership, roles,
 * invitations, and email-domain claims. OSS core: mounted for every
 * cloud-mode deployment (self-hosted and managed alike); local mode never
 * reaches these routes (they require a JWT session, which local doesn't
 * issue — kind-dispatch, not a server-mode branch).
 *
 * Authorization is the LIVE membership row (never the JWT `org` claim —
 * stale-JWT safety), fetched per request via `requireTeamRole`. Role
 * ladder: member < admin < owner.
 *
 *   admin+ : invite(member) · invite list · revoke · remove(member) ·
 *            rename · domain claim/verify
 *   owner  : invite(admin) · remove(admin) · role change · domain delete ·
 *            ownership transfer · org delete (sole member only)
 *   leave  : member/admin — owner must transfer first (OWNER_MUST_TRANSFER)
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import type { Organization, Membership, Invitation, OrgDomainClaim } from '../../../../core/auth/types';
import { slugify, InvalidOrganizationNameError } from '../../../../core/auth/slugify';
import { isConsumerDomain } from '../../../../core/auth/consumerDomains';
import {
  verifyDomainOwnership,
  generateVerificationToken,
  normalizeHostname,
  isValidHostname,
  CHALLENGE_PREFIX,
} from '../../../../infrastructure/deploy/customDomain/verification';
import { sendErrorResponse } from './helpers/errorResponse';
import { hasMinRole, resolveLiveTeamMembership } from './helpers/teamRole';
import { logger } from '../../../../utils/logger';
import {
  ORG_INVITE_TTL_DAYS,
  ORG_ID_TAKEN,
  ORG_ID_RESERVED,
  ORG_NAME_INVALID,
  ORG_NOT_FOUND,
  ORG_NOT_EMPTY,
  NOT_A_MEMBER,
  ALREADY_MEMBER,
  ROLE_FORBIDDEN,
  OWNER_MUST_TRANSFER,
  CANNOT_CHANGE_OWNER_ROLE,
  INVITE_NOT_FOUND,
  INVITE_EXPIRED,
  INVITE_REVOKED,
  INVITE_ALREADY_ACCEPTED,
  INVITE_ALREADY_PENDING,
  INVITE_EMAIL_MISMATCH,
  DOMAIN_ALREADY_CLAIMED,
  DOMAIN_INVALID,
  DOMAIN_NOT_FOUND,
  DOMAIN_NOT_VERIFIED,
  CONSUMER_DOMAIN_NOT_CLAIMABLE,
  type OrgMembershipRole,
  type OrgInviteRole,
  type OrgMemberView,
  type OrgInviteView,
  type OrgDomainClaimView,
  type OrgSummaryView,
} from '@ant/shared';

export interface TeamsRoutesDeps {
  organizationRepository: OrganizationRepositoryPort;
}

const INVITE_ROLES: readonly OrgInviteRole[] = ['admin', 'member'];

function isInviteExpired(invite: Invitation): boolean {
  return invite.status === 'pending' && Date.parse(invite.expiresAt) <= Date.now();
}

export function toInviteView(invite: Invitation): OrgInviteView {
  return {
    id: invite.id,
    organizationId: invite.organizationId,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invitedBy,
    status: isInviteExpired(invite) ? 'expired' : invite.status,
    token: invite.token,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    ...(invite.acceptedAt ? { acceptedAt: invite.acceptedAt } : {}),
    ...(invite.revokedAt ? { revokedAt: invite.revokedAt } : {}),
    ...(invite.revokedBy ? { revokedBy: invite.revokedBy } : {}),
  };
}

export function toDomainClaimView(claim: OrgDomainClaim): OrgDomainClaimView {
  return {
    domain: claim.domain,
    organizationId: claim.organizationId,
    status: claim.status,
    autoJoinRole: claim.autoJoinRole,
    claimedBy: claim.claimedBy,
    createdAt: claim.createdAt,
    ...(claim.verifiedAt ? { verifiedAt: claim.verifiedAt } : {}),
    ...(claim.verifiedBy ? { verifiedBy: claim.verifiedBy } : {}),
    txtRecordName: `${CHALLENGE_PREFIX}.${claim.domain}`,
    verificationToken: claim.verificationToken,
  };
}

export async function buildMemberViews(
  repo: OrganizationRepositoryPort,
  memberships: Membership[],
): Promise<OrgMemberView[]> {
  return Promise.all(
    memberships.map(async (m) => {
      const user = await repo.getUser(m.userId);
      return {
        userId: m.userId,
        email: user?.email ?? m.userId,
        ...(user?.name ? { name: user.name } : {}),
        ...(user?.picture ? { picture: user.picture } : {}),
        role: m.role,
        joinedAt: m.createdAt,
      };
    }),
  );
}

function toSummaryView(org: Organization): OrgSummaryView {
  return { id: org.id, name: org.name, kind: org.kind ?? 'team', createdAt: org.createdAt };
}

export function createTeamsRoutes(deps: TeamsRoutesDeps): Router {
  const router = Router();
  const repo = deps.organizationRepository;

  /** Authenticated caller from the jwtAuth middleware; 401 when absent. */
  function requireUser(req: Request, res: Response): { userId: string; email: string } | null {
    const user = (req as any).user as { id?: string; email?: string } | undefined;
    if (!user?.id || !user?.email) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return { userId: user.id, email: user.email.toLowerCase() };
  }

  /**
   * Resolve org + LIVE membership and enforce the minimum role. Responds
   * (404/403) and returns null on failure. Soft-deleted / non-team orgs are
   * indistinguishable 404s.
   */
  async function requireTeamRole(
    req: Request,
    res: Response,
    minRole: OrgMembershipRole,
  ): Promise<{ userId: string; email: string; org: Organization; membership: Membership } | null> {
    const caller = requireUser(req, res);
    if (!caller) return null;

    const orgId = req.params.orgId;
    const org = orgId ? await repo.getOrganization(orgId) : null;
    if (!org || org.deletedAt || (org.kind ?? 'team') !== 'team') {
      res.status(404).json({ error: 'Organization not found.', code: ORG_NOT_FOUND });
      return null;
    }

    const resolved = await resolveLiveTeamMembership(repo, caller.userId, org.id);
    if (!resolved) {
      res.status(404).json({ error: 'Organization not found.', code: NOT_A_MEMBER });
      return null;
    }
    if (!hasMinRole(resolved.membership.role, minRole)) {
      res.status(403).json({ error: 'Insufficient role.', code: ROLE_FORBIDDEN });
      return null;
    }
    return { ...caller, org: resolved.org, membership: resolved.membership };
  }

  // ========================================
  // Organization lifecycle
  // ========================================

  /**
   * POST /api/organizations — create a team. Open to every account that
   * reaches this route (decision 5: open creation + post-hoc superadmin
   * control); approval is bounded surface-wide by `requireApprovedAccount`, so
   * an unapproved caller never arrives. The caller becomes the owner.
   * Activation stays a separate explicit `POST /auth/switch-org` — creation
   * never silently switches context.
   */
  router.post('/organizations', async (req: Request, res: Response) => {
    try {
      const caller = requireUser(req, res);
      if (!caller) return;

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Organization name required.', code: ORG_NAME_INVALID });
      }

      let id: string;
      try {
        id = slugify(name);
      } catch (err) {
        if (err instanceof InvalidOrganizationNameError) {
          const reserved = /reserved/.test(err.message);
          return res.status(400).json({
            error: err.message,
            code: reserved ? ORG_ID_RESERVED : ORG_NAME_INVALID,
          });
        }
        throw err;
      }
      // `personal-*` is the legacy individual-org prefix — deriveKindFromOrgId
      // would misclassify such a team, so the namespace is reserved.
      if (id.startsWith('personal-')) {
        return res.status(400).json({ error: 'Names starting with "personal-" are reserved.', code: ORG_ID_RESERVED });
      }

      const org = await repo.createOrganization({ id, name, kind: 'team', ownerId: caller.userId });
      if (!org) {
        return res.status(409).json({ error: 'That organization id is taken.', code: ORG_ID_TAKEN });
      }
      await repo.attachMembership({ userId: caller.userId, organizationId: org.id, role: 'owner' });

      logger.info(`[Teams] created org ${org.id} (owner ${caller.userId})`, { component: 'Teams' });
      res.status(201).json({ organization: toSummaryView(org) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** GET /api/organizations/:orgId — summary + caller's role (member+). */
  router.get('/organizations/:orgId', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'member');
      if (!ctx) return;
      res.json({ organization: toSummaryView(ctx.org), role: ctx.membership.role });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** PUT /api/organizations/:orgId/name — rename display name (admin+). Id is immutable. */
  router.put('/organizations/:orgId/name', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Organization name required.', code: ORG_NAME_INVALID });
      }
      const updated = await repo.updateOrganizationName(ctx.org.id, name);
      res.json({ organization: toSummaryView(updated ?? ctx.org) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /**
   * DELETE /api/organizations/:orgId — soft-delete (owner, sole member only).
   * A populated org must be emptied (or superadmin force-deleted) first.
   */
  router.delete('/organizations/:orgId', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'owner');
      if (!ctx) return;
      const members = await repo.listOrgMemberships(ctx.org.id);
      if (members.length > 1) {
        return res.status(409).json({ error: 'Organization still has members.', code: ORG_NOT_EMPTY });
      }
      await repo.softDeleteOrganization(ctx.org.id, ctx.userId);
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  // ========================================
  // Members & roles
  // ========================================

  /** GET /api/organizations/:orgId/members (member+). */
  router.get('/organizations/:orgId/members', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'member');
      if (!ctx) return;
      const memberships = await repo.listOrgMemberships(ctx.org.id);
      res.json({ members: await buildMemberViews(repo, memberships) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /**
   * DELETE /api/organizations/:orgId/members/:userId — remove a member.
   * admin+ may remove members; only the owner may remove admins. The owner
   * cannot be removed (transfer first). Self-removal goes through /leave.
   */
  router.delete('/organizations/:orgId/members/:userId', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const targetUserId = req.params.userId;
      if (targetUserId === ctx.userId) {
        return res.status(400).json({ error: 'Use the leave endpoint to remove yourself.', code: ROLE_FORBIDDEN });
      }
      const target = await repo.getMembership(targetUserId, ctx.org.id);
      if (!target) {
        return res.status(404).json({ error: 'Member not found.', code: NOT_A_MEMBER });
      }
      if (target.role === 'owner') {
        return res.status(403).json({ error: 'The owner cannot be removed.', code: OWNER_MUST_TRANSFER });
      }
      if (target.role === 'admin' && ctx.membership.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can remove an admin.', code: ROLE_FORBIDDEN });
      }
      await repo.removeMembership(targetUserId, ctx.org.id);
      logger.info(`[Teams] ${ctx.userId} removed ${targetUserId} from ${ctx.org.id}`, { component: 'Teams' });
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** PUT /api/organizations/:orgId/members/:userId/role — owner only, admin↔member. */
  router.put('/organizations/:orgId/members/:userId/role', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'owner');
      if (!ctx) return;
      const role = req.body?.role as OrgMembershipRole;
      if (role !== 'admin' && role !== 'member') {
        return res.status(400).json({ error: 'Role must be admin or member.', code: CANNOT_CHANGE_OWNER_ROLE });
      }
      const targetUserId = req.params.userId;
      const target = await repo.getMembership(targetUserId, ctx.org.id);
      if (!target) {
        return res.status(404).json({ error: 'Member not found.', code: NOT_A_MEMBER });
      }
      if (target.role === 'owner') {
        return res.status(403).json({ error: 'Ownership changes go through transfer.', code: CANNOT_CHANGE_OWNER_ROLE });
      }
      const updated = await repo.setMembershipRole(targetUserId, ctx.org.id, role);
      res.json({ membership: updated });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** POST /api/organizations/:orgId/transfer-ownership — owner only. */
  router.post('/organizations/:orgId/transfer-ownership', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'owner');
      if (!ctx) return;
      const toUserId = typeof req.body?.toUserId === 'string' ? req.body.toUserId : '';
      if (!toUserId || toUserId === ctx.userId) {
        return res.status(400).json({ error: 'A different member is required.', code: NOT_A_MEMBER });
      }
      const ok = await repo.transferOwnership(ctx.org.id, ctx.userId, toUserId);
      if (!ok) {
        return res.status(404).json({ error: 'Member not found.', code: NOT_A_MEMBER });
      }
      logger.info(`[Teams] ownership of ${ctx.org.id}: ${ctx.userId} → ${toUserId}`, { component: 'Teams' });
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** POST /api/organizations/:orgId/leave — member/admin; owner must transfer first. */
  router.post('/organizations/:orgId/leave', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'member');
      if (!ctx) return;
      if (ctx.membership.role === 'owner') {
        return res.status(403).json({ error: 'Transfer ownership before leaving.', code: OWNER_MUST_TRANSFER });
      }
      await repo.removeMembership(ctx.userId, ctx.org.id);
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  // ========================================
  // Invitations
  // ========================================

  /**
   * POST /api/organizations/:orgId/invites — create an invite link.
   * admin+ may invite members; only the owner may invite admins. One live
   * pending invite per (org, email).
   */
  router.post('/organizations/:orgId/invites', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;

      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const role = req.body?.role as OrgInviteRole;
      if (!/^[^\s@:/\\]+@[^\s@:/\\]+\.[^\s@:/\\]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.', code: ORG_NAME_INVALID });
      }
      if (!INVITE_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or member.', code: ROLE_FORBIDDEN });
      }
      if (role === 'admin' && ctx.membership.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can invite admins.', code: ROLE_FORBIDDEN });
      }

      // Already a member? (cloud userId = lowercased email; the byEmail lookup
      // covers records whose id ever diverges from the email.)
      const existingUser = await repo.getUserByEmail(email);
      const candidateId = existingUser?.id ?? email;
      if (await repo.getMembership(candidateId, ctx.org.id)) {
        return res.status(409).json({ error: 'Already a member.', code: ALREADY_MEMBER });
      }

      const existing = await repo.listOrgInvites(ctx.org.id);
      const livePending = existing.find(
        (i) => i.email === email && i.status === 'pending' && !isInviteExpired(i),
      );
      if (livePending) {
        return res.status(409).json({
          error: 'An invite for this email is already pending.',
          code: INVITE_ALREADY_PENDING,
          invite: toInviteView(livePending),
        });
      }

      const now = Date.now();
      const invite: Invitation = {
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        email,
        role,
        invitedBy: ctx.userId,
        token: crypto.randomBytes(24).toString('hex'),
        status: 'pending',
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ORG_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      };
      await repo.createInvite(invite);
      logger.info(`[Teams] invite ${invite.id} (${email} → ${ctx.org.id} as ${role})`, { component: 'Teams' });
      res.status(201).json({ invite: toInviteView(invite) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** GET /api/organizations/:orgId/invites (admin+). */
  router.get('/organizations/:orgId/invites', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const invites = await repo.listOrgInvites(ctx.org.id);
      res.json({ invites: invites.map(toInviteView) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** POST /api/organizations/:orgId/invites/:inviteId/revoke (admin+, idempotent). */
  router.post('/organizations/:orgId/invites/:inviteId/revoke', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const invite = await repo.getInvite(req.params.inviteId);
      if (!invite || invite.organizationId !== ctx.org.id) {
        return res.status(404).json({ error: 'Invite not found.', code: INVITE_NOT_FOUND });
      }
      if (invite.status === 'pending') {
        invite.status = 'revoked';
        invite.revokedAt = new Date().toISOString();
        invite.revokedBy = ctx.userId;
        await repo.updateInvite(invite);
      }
      res.json({ invite: toInviteView(invite) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /**
   * POST /api/organizations/invites/accept — accept by token. The invite is
   * bound to the invitee email (403 INVITE_EMAIL_MISMATCH otherwise). An
   * already-member caller gets a 200 with `alreadyMember: true` so the FE
   * can treat it as a switch prompt.
   */
  router.post('/organizations/invites/accept', async (req: Request, res: Response) => {
    try {
      const caller = requireUser(req, res);
      if (!caller) return;
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const invite = token ? await repo.getInviteByToken(token) : null;
      if (!invite) {
        return res.status(404).json({ error: 'Invite not found.', code: INVITE_NOT_FOUND });
      }

      const org = await repo.getOrganization(invite.organizationId);
      if (!org || org.deletedAt) {
        return res.status(404).json({ error: 'Organization not found.', code: ORG_NOT_FOUND });
      }

      if (invite.email !== caller.email) {
        return res.status(403).json({
          error: 'This invite was issued for a different email.',
          code: INVITE_EMAIL_MISMATCH,
        });
      }

      if (await repo.getMembership(caller.userId, org.id)) {
        return res.json({ alreadyMember: true, organization: toSummaryView(org) });
      }

      if (invite.status === 'revoked') {
        return res.status(410).json({ error: 'Invite was revoked.', code: INVITE_REVOKED });
      }
      if (invite.status === 'accepted') {
        return res.status(410).json({ error: 'Invite was already used.', code: INVITE_ALREADY_ACCEPTED });
      }
      if (isInviteExpired(invite)) {
        return res.status(410).json({ error: 'Invite expired.', code: INVITE_EXPIRED });
      }

      await repo.attachMembership({ userId: caller.userId, organizationId: org.id, role: invite.role });
      invite.status = 'accepted';
      invite.acceptedAt = new Date().toISOString();
      await repo.updateInvite(invite);

      logger.info(`[Teams] ${caller.userId} accepted invite to ${org.id} as ${invite.role}`, { component: 'Teams' });
      res.json({ alreadyMember: false, organization: toSummaryView(org), role: invite.role });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  // ========================================
  // Domain claims
  // ========================================

  /**
   * POST /api/organizations/:orgId/domains — claim an email domain (admin+).
   * Fast-path: a claimant whose own login email host EXACTLY matches the
   * domain proves mailbox control — instantly `verified` (verifiedBy:
   * 'email'). Everyone else gets a DNS TXT challenge. Consumer domains are
   * never claimable; one org per domain globally.
   */
  router.post('/organizations/:orgId/domains', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;

      const raw = typeof req.body?.domain === 'string' ? req.body.domain : '';
      const domain = normalizeHostname(raw);
      if (!domain || !isValidHostname(domain)) {
        return res.status(400).json({ error: 'A valid domain is required.', code: DOMAIN_INVALID });
      }
      if (isConsumerDomain(domain)) {
        return res.status(400).json({
          error: 'Consumer email domains cannot be claimed.',
          code: CONSUMER_DOMAIN_NOT_CLAIMABLE,
        });
      }

      const callerHost = ctx.email.split('@')[1]?.toLowerCase() ?? '';
      const emailFastPath = callerHost === domain;
      const now = new Date().toISOString();
      const claim: OrgDomainClaim = {
        domain,
        organizationId: ctx.org.id,
        claimedBy: ctx.userId,
        verificationToken: generateVerificationToken(),
        status: emailFastPath ? 'verified' : 'pending',
        autoJoinRole: 'member',
        createdAt: now,
        ...(emailFastPath ? { verifiedAt: now, verifiedBy: 'email' as const } : {}),
      };

      const created = await repo.createDomainClaim(claim);
      if (!created) {
        return res.status(409).json({ error: 'Domain already claimed.', code: DOMAIN_ALREADY_CLAIMED });
      }
      logger.info(
        `[Teams] domain ${domain} claimed by ${ctx.org.id} (${claim.status})`,
        { component: 'Teams' },
      );
      res.status(201).json({ domain: toDomainClaimView(created) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** GET /api/organizations/:orgId/domains (admin+). */
  router.get('/organizations/:orgId/domains', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const claims = await repo.listOrgDomains(ctx.org.id);
      res.json({ domains: claims.map(toDomainClaimView) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /**
   * POST /api/organizations/:orgId/domains/:domain/verify — explicit DNS TXT
   * check (admin+, no polling). `verified: false` is a 200 — "record not
   * visible yet" is a normal propagation state, not an error.
   */
  router.post('/organizations/:orgId/domains/:domain/verify', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'admin');
      if (!ctx) return;
      const claim = await repo.getDomainClaim(normalizeHostname(req.params.domain));
      if (!claim || claim.organizationId !== ctx.org.id) {
        return res.status(404).json({ error: 'Domain claim not found.', code: DOMAIN_NOT_FOUND });
      }
      if (claim.status === 'verified') {
        return res.json({ verified: true, domain: toDomainClaimView(claim) });
      }
      const ok = await verifyDomainOwnership(claim.domain, claim.verificationToken);
      if (ok) {
        claim.status = 'verified';
        claim.verifiedAt = new Date().toISOString();
        claim.verifiedBy = 'dns';
        await repo.updateDomainClaim(claim);
        logger.info(`[Teams] domain ${claim.domain} verified via DNS for ${ctx.org.id}`, { component: 'Teams' });
      }
      res.json({ verified: ok, domain: toDomainClaimView(claim) });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /** DELETE /api/organizations/:orgId/domains/:domain — release a claim (owner). */
  router.delete('/organizations/:orgId/domains/:domain', async (req: Request, res: Response) => {
    try {
      const ctx = await requireTeamRole(req, res, 'owner');
      if (!ctx) return;
      const domain = normalizeHostname(req.params.domain);
      const claim = await repo.getDomainClaim(domain);
      if (!claim || claim.organizationId !== ctx.org.id) {
        return res.status(404).json({ error: 'Domain claim not found.', code: DOMAIN_NOT_FOUND });
      }
      await repo.deleteDomainClaim(domain);
      res.json({ ok: true });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  /**
   * POST /api/organizations/join-by-domain — one-click join. Server-side
   * re-validation of everything `/auth/me` advertised: the caller's email
   * host must match a VERIFIED claim owned by the requested org.
   */
  router.post('/organizations/join-by-domain', async (req: Request, res: Response) => {
    try {
      const caller = requireUser(req, res);
      if (!caller) return;
      const organizationId =
        typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : '';
      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId required.', code: ORG_NOT_FOUND });
      }

      const callerHost = caller.email.split('@')[1]?.toLowerCase() ?? '';
      const claim = callerHost ? await repo.getDomainClaim(callerHost) : null;
      if (!claim || claim.organizationId !== organizationId || claim.status !== 'verified') {
        return res.status(403).json({
          error: 'Your email domain does not grant access to this organization.',
          code: DOMAIN_NOT_VERIFIED,
        });
      }

      const org = await repo.getOrganization(organizationId);
      if (!org || org.deletedAt || (org.kind ?? 'team') !== 'team') {
        return res.status(404).json({ error: 'Organization not found.', code: ORG_NOT_FOUND });
      }

      if (await repo.getMembership(caller.userId, org.id)) {
        return res.json({ alreadyMember: true, organization: toSummaryView(org) });
      }

      await repo.attachMembership({
        userId: caller.userId,
        organizationId: org.id,
        role: claim.autoJoinRole,
      });
      logger.info(`[Teams] ${caller.userId} joined ${org.id} via domain ${callerHost}`, { component: 'Teams' });
      res.json({ alreadyMember: false, organization: toSummaryView(org), role: claim.autoJoinRole });
    } catch (err) {
      sendErrorResponse(res, 500, err, 'Teams');
    }
  });

  return router;
}
