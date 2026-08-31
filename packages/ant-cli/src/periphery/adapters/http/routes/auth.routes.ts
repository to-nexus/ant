import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AuthService } from '../../../../core/auth/AuthService';
import { GoogleOIDCService, OIDCUser } from '../../../../infrastructure/auth/GoogleOIDCService';
import { JwtService } from '../../../../infrastructure/auth/JwtService';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { StateStorePort } from '../../../../core/ports/stateStore';
import { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import { authRateLimiter } from '../middleware/rateLimiter';
import { resolveFrontendOrigin } from '../middleware/corsConfig';
import { extractStartOrigin } from '../middleware/originHelper';
import { logger } from '../../../../utils/logger';
import { extractUserContext, isLocalServerMode } from './helpers/userContext';
import { isSuperAdminEmail } from '../../../../core/auth/superAdmin';
import { resolveDomainJoin } from '../../../../core/auth/domainJoin';
import {
  INDIVIDUAL_ORG_ID,
  deriveKindFromOrgId,
  type OrganizationKind,
  type OrgMembershipRole,
  type PendingInviteView,
  type DomainJoinableOrgView,
  type MyJoinRequestView,
  type AutoJoinedOrgView,
} from '@ant/shared';

const OIDC_STATE_TTL_SECONDS = 5 * 60; // 5 minutes
const OIDC_STATE_KEY_PREFIX = 'ant:oidc:state:';

/**
 * Retired pre-onboarding sentinel. Nothing mints it any more — the org is
 * decided at login — but records written by the deleted onboarding flow may
 * still carry it as `currentOrganizationId`, so the read path must keep
 * refusing to honor it as an active org.
 */
const PENDING_ORG_SENTINEL = '_pending';

/**
 * OIDC state payload stored in Redis between `/auth/google` start and
 * `/auth/google/callback`. Both fields are optional — neither is
 * security-critical on the start side, and the callback uses defaults
 * (FRONTEND_URL fallback, fallbackPath) when fields are missing.
 */
type OidcStatePayload = { returnTo?: string; startOrigin?: string };

/**
 * Gate for the `/auth/*` debug log lines. These emit raw request headers
 * (cookie presence, `origin`, `host`, `x-forwarded-*`) which are sensitive
 * in a multi-tenant cloud deployment. The flag is a local-development aid
 * only: it is force-disabled in any production-like runtime
 * (`NODE_ENV=production` OR `ANT_SERVER_MODE=cloud`) regardless of
 * `ANT_AUTH_DEBUG`, so a stray env var can never leak headers in prod.
 * Read at call time (not boot) so tests can flip the env per-case.
 */
export function isAuthDebugLoggingEnabled(): boolean {
  if (process.env.ANT_AUTH_DEBUG !== '1') return false;
  const prodLike =
    process.env.NODE_ENV === 'production' || process.env.ANT_SERVER_MODE === 'cloud';
  return !prodLike;
}

/**
 * Authentication routes for Cloud Mode
 *
 * Handles:
 * - Google OIDC authentication flow (JWT cookie issuance)
 * - Session info endpoint (/api/auth/me)
 * - Sign out (cookie clear)
 * - Active-org switch (re-mints the JWT with a new `org` claim)
 */
export function createAuthRoutes(deps: {
  authService: AuthService;
  workspaceResolver: WorkspaceResolver;
  oidcService?: GoogleOIDCService;
  jwtService?: JwtService;
  stateStore?: StateStorePort;
  organizationRepository?: OrganizationRepositoryPort;
}): Router {
  const router = Router();
  const {
    authService,
    workspaceResolver,
    oidcService,
    jwtService,
    stateStore,
    organizationRepository,
  } = deps;

  const isProduction = process.env.NODE_ENV === 'production';

  // ========================================
  // Common validation logic
  // ========================================

  /**
   * Resolve workspace path. The legacy `to.nexus`-only guard is gone —
   * any well-formed email is accepted. Organization id classification
   * lives in `resolveOrganizationId`, which resolves every cloud signup to
   * the shared `individual` org.
   */
  async function validateAndGetWorkspace(
    email: string,
    userId: string,
  ): Promise<{
    authContext: { user: { id: string; email: string; organizationId: string }; organization: { id: string; name: string; kind?: OrganizationKind } };
    workspacePath: string;
  }> {
    const authContext = await authService.authenticate({ email, userId });

    const workspacePath = workspaceResolver.getWorkspacePath({
      userId: authContext.user.id,
      organizationId: authContext.organization.id,
    });

    return { authContext, workspacePath };
  }

  async function storeOidcState(state: string, payload: OidcStatePayload): Promise<void> {
    if (!stateStore) {
      throw new Error('StateStore required for OIDC state management');
    }
    await stateStore.setKeyWithTTL(
      `${OIDC_STATE_KEY_PREFIX}${state}`,
      JSON.stringify(payload),
      OIDC_STATE_TTL_SECONDS,
    );
  }

  async function verifyAndConsumeOidcState(state: string): Promise<{ valid: boolean } & Partial<OidcStatePayload>> {
    if (!stateStore) return { valid: false };
    const key = `${OIDC_STATE_KEY_PREFIX}${state}`;
    const value = await stateStore.getKey(key);
    if (!value) return { valid: false };
    await stateStore.deleteKey(key);
    if (value === '1') return { valid: true };
    try {
      const parsed = JSON.parse(value) as OidcStatePayload;
      return { valid: true, returnTo: parsed.returnTo, startOrigin: parsed.startOrigin };
    } catch {
      return { valid: true };
    }
  }

  function sanitizeReturnTo(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    if (!raw.startsWith('/') || raw.startsWith('//')) return undefined;
    return raw;
  }

  function issueJwtCookie(
    req: Request,
    res: Response,
    payload: {
      sub: string;
      email: string;
      org: string;
      kind?: OrganizationKind;
      name?: string;
      picture?: string;
    },
  ): void {
    if (!jwtService) {
      throw new Error('jwtService missing — cannot issue JWT');
    }
    const token = jwtService.sign(payload);
    res.cookie(
      JwtService.cookieName,
      token,
      jwtService.getCookieOptions(isProduction, req.hostname),
    );
  }

  /** A single membership projection for the `/auth/me` + switch envelopes. */
  type MembershipView = {
    organizationId: string;
    kind: OrganizationKind;
    name: string;
    role: OrgMembershipRole;
  };

  /**
   * Build the account-context envelope (active org + all memberships) for
   * the `/auth/me` and `/auth/switch-org` responses. The active org is
   * always present even if its membership row is momentarily missing.
   */
  async function buildAccountEnvelope(
    repo: OrganizationRepositoryPort,
    userId: string,
    activeOrgId: string,
  ): Promise<{ activeOrg: { id: string; kind: OrganizationKind; name: string }; memberships: MembershipView[] }> {
    const rows = await repo.listMembershipsByUser(userId);
    const orgs = await Promise.all(rows.map((m) => repo.getOrganization(m.organizationId)));
    const memberships: MembershipView[] = rows.map((m, i) => {
      const org = orgs[i];
      return {
        organizationId: m.organizationId,
        kind: org?.kind ?? deriveKindFromOrgId(m.organizationId),
        name: org?.name ?? m.organizationId,
        role: m.role,
      };
    });
    const active = memberships.find((v) => v.organizationId === activeOrgId);
    return {
      activeOrg: active
        ? { id: active.organizationId, kind: active.kind, name: active.name }
        : { id: activeOrgId, kind: deriveKindFromOrgId(activeOrgId), name: activeOrgId },
      memberships,
    };
  }

  /**
   * Org join surface for `/auth/me`: actionable pending invites addressed to
   * this email, verified-domain join candidates, the caller's own pending
   * join requests, and a one-off notice when a login backfilled them into a
   * team. Everything excludes orgs the user already belongs to and
   * soft-deleted orgs. Invite / request expiry is judged lazily here —
   * stored status stays `'pending'`.
   *
   * This is a READ. It never mints a membership — the login path does that
   * (see `docs/internals/40-org-model.md` §"Reads must not mint").
   */
  async function buildJoinSurface(
    repo: OrganizationRepositoryPort,
    userId: string,
    email: string,
    activeOrgId: string,
  ): Promise<{
    pendingInvites: PendingInviteView[];
    domainJoinableOrgs: DomainJoinableOrgView[];
    myJoinRequests: MyJoinRequestView[];
    autoJoinedOrg: AutoJoinedOrgView | null;
  }> {
    const now = Date.now();
    const pendingInvites: PendingInviteView[] = [];
    const invites = await repo.listInvitesByEmail(email);
    for (const invite of invites) {
      if (invite.status !== 'pending') continue;
      if (Date.parse(invite.expiresAt) <= now) continue;
      if (await repo.getMembership(userId, invite.organizationId)) continue;
      const org = await repo.getOrganization(invite.organizationId);
      if (!org || org.deletedAt) continue;
      pendingInvites.push({
        id: invite.id,
        token: invite.token,
        organizationId: invite.organizationId,
        organizationName: org.name,
        role: invite.role,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
      });
    }

    // The banner is the OFFER — shown whenever the shortcut is available and
    // has not already been taken. Two states produce it: auto-join is off, or
    // auto-join is on but the caller's session predates the claim (a cookie
    // lives days, so waiting for their next login would be a worse answer
    // than letting them join now). Once a login has granted the membership,
    // `resolveDomainJoin` refuses with `already-member` and this is empty.
    const domainJoinableOrgs: DomainJoinableOrgView[] = [];
    const shortcut = await resolveDomainJoin(repo, userId, email);
    if (shortcut.ok) {
      domainJoinableOrgs.push({
        organizationId: shortcut.org.id,
        organizationName: shortcut.org.name,
        domain: shortcut.domain,
        autoJoinRole: shortcut.claim.autoJoinRole,
      });
    }

    const myJoinRequests: MyJoinRequestView[] = [];
    for (const request of await repo.listJoinRequestsByUser(userId)) {
      if (request.status !== 'pending') continue;
      if (Date.parse(request.expiresAt) <= now) continue;
      if (await repo.getMembership(userId, request.organizationId)) continue;
      const org = await repo.getOrganization(request.organizationId);
      if (!org || org.deletedAt) continue;
      myJoinRequests.push({
        id: request.id,
        organizationId: request.organizationId,
        organizationName: org.name,
        status: request.status,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      });
    }

    // Backfill notice: only for an EXISTING account whose active org was left
    // alone. A brand-new account lands in the team as its active org, so
    // telling it "you were added" would be noise.
    let autoJoinedOrg: AutoJoinedOrgView | null = null;
    const user = await repo.getUser(userId);
    const stamp = user?.lastDomainAutoJoin;
    if (stamp && stamp.organizationId !== activeOrgId) {
      const org = await repo.getOrganization(stamp.organizationId);
      const stillMember = await repo.getMembership(userId, stamp.organizationId);
      if (org && !org.deletedAt && stillMember) {
        autoJoinedOrg = {
          organizationId: org.id,
          organizationName: org.name,
          domain: stamp.domain,
        };
      }
    }

    return { pendingInvites, domainJoinableOrgs, myJoinRequests, autoJoinedOrg };
  }

  // ========================================
  // Google OIDC Routes
  // ========================================

  /**
   * Initiate Google OAuth2 flow
   * GET /api/auth/google
   */
  router.get('/auth/google', authRateLimiter, async (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured',
        message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
      });
    }

    try {
      const returnTo = sanitizeReturnTo(req.query.returnTo);
      const startOrigin = extractStartOrigin(req.headers.origin, req.headers.referer);
      const state = crypto.randomBytes(32).toString('hex');
      await storeOidcState(state, { returnTo, startOrigin });

      const authUrl = oidcService.getAuthorizationUrl(state);
      res.redirect(authUrl);
    } catch (error: any) {
      logger.error('[Auth] Google OAuth error', { component: 'Auth' }, error);
      return res.status(500).json({
        error: 'Failed to initiate Google authentication',
      });
    }
  });

  /**
   * Google OAuth2 callback
   * GET /api/auth/google/callback
   *
   * Behavior:
   *  - Every account joins the shared `individual` org; a verified
   *    email-domain claim whose auto-join is on additionally grants that
   *    team, evaluated on EVERY login (which is what backfills accounts
   *    whose domain was claimed after they signed up).
   *  - Returning users keep their persisted `currentOrganizationId` when it
   *    is still a real membership.
   *  - If `organizationRepository` is absent (legacy path), derive the org
   *    from the email and issue a regular JWT immediately.
   */
  router.get('/auth/google/callback', authRateLimiter, async (req: Request, res: Response) => {
    if (!oidcService) {
      return res.status(503).json({
        error: 'Google authentication not configured'
      });
    }

    const { code, error, state } = req.query;
    let frontendUrl = process.env.FRONTEND_URL || '';
    const fallbackPath = '/app/';

    if (error) {
      logger.warn(`[Auth] Google OAuth error: ${error}`, { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=oauth_failed`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${frontendUrl}${fallbackPath}?error=no_code`);
    }

    if (!state || typeof state !== 'string') {
      logger.warn('[Auth] Missing OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=invalid_state`);
    }

    const stateResult = await verifyAndConsumeOidcState(state);
    if (!stateResult.valid) {
      logger.warn('[Auth] Invalid or expired OIDC state parameter', { component: 'Auth' });
      return res.redirect(`${frontendUrl}${fallbackPath}?error=invalid_state`);
    }

    frontendUrl = resolveFrontendOrigin(stateResult.startOrigin, process.env.FRONTEND_URL);
    const returnTo = stateResult.returnTo || fallbackPath;

    try {
      const oidcUser: OIDCUser = await oidcService.authenticateWithCode(code);

      if (!oidcUser.emailVerified) {
        return res.redirect(`${frontendUrl}${fallbackPath}?error=email_not_verified`);
      }

      if (!jwtService) {
        logger.error('JWT service not available during OIDC callback', { component: 'Auth' });
        return res.redirect(`${frontendUrl}${fallbackPath}?error=auth_config_error`);
      }

      // Org model: identity is the full lowercased email (org-independent,
      // collision-free in the shared `individual` org and stable across an
      // active-org switch). Every cloud signup joins `individual`; a verified
      // email-domain claim may additionally grant a team here (see below).
      // No onboarding round-trip — the org is decided at login.
      if (organizationRepository) {
        const userId = oidcUser.email.toLowerCase();
        const existing = await organizationRepository.getUser(userId);
        const isNewAccount = existing === null;

        // Honor a previously-chosen active org only if it is a real
        // membership; otherwise fall back to the shared individual org.
        let activeOrgId = INDIVIDUAL_ORG_ID;
        if (
          existing?.currentOrganizationId &&
          existing.currentOrganizationId !== PENDING_ORG_SENTINEL
        ) {
          const mem = await organizationRepository.getMembership(
            userId,
            existing.currentOrganizationId,
          );
          if (mem) activeOrgId = existing.currentOrganizationId;
        }

        // Every user is a member of the shared individual org.
        await organizationRepository.getOrCreateOrganization({
          id: INDIVIDUAL_ORG_ID,
          name: 'Individual',
          kind: 'individual',
          ownerId: null,
        });
        await organizationRepository.attachMembership({
          userId,
          organizationId: INDIVIDUAL_ORG_ID,
          role: 'member',
        });

        // Domain auto-join, evaluated on EVERY login, not only at signup —
        // that is what backfills accounts whose org claimed their domain
        // later. `attachMembership` is idempotent, so a repeat login is a
        // no-op. A brand-new account also activates the team; an existing
        // one keeps whatever org it was working in and gets a `/auth/me`
        // notice instead (a silent active-org swap would move the project
        // list out from under in-flight work).
        let lastDomainAutoJoin = existing?.lastDomainAutoJoin;
        try {
          const shortcut = await resolveDomainJoin(
            organizationRepository,
            userId,
            oidcUser.email,
          );
          if (shortcut.ok && shortcut.claim.autoJoin !== false) {
            await organizationRepository.attachMembership({
              userId,
              organizationId: shortcut.org.id,
              role: shortcut.claim.autoJoinRole,
            });
            logger.info(
              `[Auth] ${userId} auto-joined ${shortcut.org.id} via domain ${shortcut.domain}`,
              { component: 'Auth' },
            );
            if (isNewAccount) {
              activeOrgId = shortcut.org.id;
            } else {
              lastDomainAutoJoin = {
                organizationId: shortcut.org.id,
                domain: shortcut.domain,
                at: new Date().toISOString(),
              };
            }
          }
        } catch (err) {
          // A domain lookup must never cost the user their login.
          logger.warn(
            `[Auth] domain auto-join check failed for ${userId}`,
            { component: 'Auth' },
            err,
          );
        }

        const activeKind = deriveKindFromOrgId(activeOrgId);
        await organizationRepository.upsertUser({
          id: userId,
          email: oidcUser.email,
          name: oidcUser.name,
          picture: oidcUser.picture,
          currentOrganizationId: activeOrgId,
          lastDomainAutoJoin,
        });

        const workspacePath = workspaceResolver.getWorkspacePath({
          userId,
          organizationId: activeOrgId,
        });
        try {
          await fs.promises.access(workspacePath);
        } catch {
          await fs.promises.mkdir(workspacePath, { recursive: true });
        }

        issueJwtCookie(req, res, {
          sub: userId,
          email: oidcUser.email,
          org: activeOrgId,
          kind: activeKind,
          name: oidcUser.name,
          picture: oidcUser.picture,
        });

        const redirectUrl = returnTo.startsWith('/app')
          ? `${frontendUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}auth=success`
          : `${frontendUrl}${returnTo}`;
        return res.redirect(redirectUrl);
      }

      // Legacy path — no repository wired. AuthService resolves identity
      // (sub=email, org=individual, kind=individual).
      const { authContext, workspacePath } = await validateAndGetWorkspace(oidcUser.email, oidcUser.sub);

      try {
        await fs.promises.access(workspacePath);
      } catch {
        await fs.promises.mkdir(workspacePath, { recursive: true });
        logger.info(`[Auth] Created workspace for ${oidcUser.email}`, { component: 'Auth' });
      }

      issueJwtCookie(req, res, {
        sub: authContext.user.id,
        email: authContext.user.email,
        org: authContext.organization.id,
        kind: authContext.organization.kind,
        name: oidcUser.name,
        picture: oidcUser.picture,
      });

      const redirectUrl = returnTo.startsWith('/app')
        ? `${frontendUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}auth=success`
        : `${frontendUrl}${returnTo}`;
      res.redirect(redirectUrl);
    } catch (error: any) {
      logger.error('[Auth] Google callback error', { component: 'Auth' }, error);
      return res.redirect(`${frontendUrl}${fallbackPath}?error=auth_failed`);
    }
  });

  // ========================================
  // Session Endpoints
  // ========================================

  /**
   * GET /api/auth/me
   *
   * Unified contract across local / cloud:
   *   {
   *     user: { email, organization, userId, name?, picture? } | null,
   *     activeOrg, memberships[],
   *     pendingInvites[], domainJoinableOrgs[], myJoinRequests[],
   *     autoJoinedOrg | null,
   *   }
   *
   * - Local mode: identity reflects `extractUserContext(req)` so the
   *   `/auth/me` payload matches what every other route-handler sees.
   *   When the workspace has exactly one org × one user directory the
   *   organization/userId reflect that inference; otherwise the
   *   response falls back to the legacy `local:local` defaults.
   * - Cloud mode: reads JWT, then layers the account envelope (active org +
   *   memberships) and the join surface on top.
   */
  router.get('/auth/me', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'private, no-store');

    if (isLocalServerMode()) {
      const { userId, organizationId } = extractUserContext(req);
      return res.json({
        user: {
          email: `${userId}@${organizationId}`,
          organization: organizationId,
          userId,
          name: 'Local User',
          kind: 'local' as OrganizationKind,
          // Local/OSS is never gated — always approved, never admin.
          approvalStatus: 'approved' as const,
          isAdmin: false,
          testAccountLevel: 0,
        },
        activeOrg: { id: organizationId, kind: 'local' as OrganizationKind, name: organizationId },
        memberships: [
          { organizationId, kind: 'local' as OrganizationKind, name: organizationId, role: 'member' as const },
        ],
        pendingInvites: [],
        domainJoinableOrgs: [],
        myJoinRequests: [],
        autoJoinedOrg: null,
      });
    }

    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }

    const token = (req as any).cookies?.[JwtService.cookieName];

    if (isAuthDebugLoggingEnabled()) {
      logger.info(
        `[Auth][debug] /auth/me cookiePresent=${!!token} origin=${req.headers.origin ?? ''} host=${req.headers.host ?? ''} xfp=${req.headers['x-forwarded-proto'] ?? ''} xfh=${req.headers['x-forwarded-host'] ?? ''}`,
        { component: 'Auth' },
      );
    }

    if (!token) {
      return res.json({
        user: null,
        activeOrg: null,
        memberships: [],
        pendingInvites: [],
        domainJoinableOrgs: [],
        myJoinRequests: [],
        autoJoinedOrg: null,
      });
    }

    try {
      const payload = jwtService.verify(token);

      // A valid JWT whose user record is gone (a deleted account, or state
      // loss). `/auth/me` is a PUBLIC_PATH, so the approval guard never runs
      // here — without this the FE would render a signed-in user whose every
      // other call 401s (`getUserApproval` → `'unknown'`). This asks only
      // whether the subject exists; approval stays `checkApproval`'s alone.
      // The Noop repo answers `true`, so local mode never takes this branch.
      if (organizationRepository) {
        if (!(await organizationRepository.hasIdentity(payload.sub))) {
          res.clearCookie(
            JwtService.cookieName,
            jwtService.getClearCookieOptions(isProduction, req.hostname),
          );
          return res.json({
            user: null,
            activeOrg: null,
            memberships: [],
            pendingInvites: [],
            domainJoinableOrgs: [],
            myJoinRequests: [],
            autoJoinedOrg: null,
          });
        }
      }

      const activeKind = payload.kind ?? deriveKindFromOrgId(payload.org);

      // Account envelope (active org + memberships) when the repo is wired;
      // otherwise synthesize a single-membership view from the JWT.
      const envelope = organizationRepository
        ? await buildAccountEnvelope(organizationRepository, payload.sub, payload.org)
        : {
            activeOrg: { id: payload.org, kind: activeKind, name: payload.org },
            memberships: [
              { organizationId: payload.org, kind: activeKind, name: payload.org, role: 'member' as const },
            ],
          };

      // Approval + test-account level from the user record (Noop/no-repo ⇒
      // approved/0). `isAdmin` is env-authoritative, never the DB projection.
      const userRecord = organizationRepository ? await organizationRepository.getUser(payload.sub) : null;
      const approvalStatus = userRecord?.approvalStatus ?? 'approved';
      const testAccountLevel = userRecord?.testAccountLevel ?? 0;
      const isAdmin = isSuperAdminEmail(payload.email);

      const joinSurface = organizationRepository
        ? await buildJoinSurface(
            organizationRepository,
            payload.sub,
            payload.email,
            envelope.activeOrg.id,
          )
        : {
            pendingInvites: [],
            domainJoinableOrgs: [],
            myJoinRequests: [],
            autoJoinedOrg: null,
          };

      res.json({
        user: {
          email: payload.email,
          organization: payload.org,
          name: payload.name,
          picture: payload.picture,
          userId: payload.sub,
          kind: activeKind,
          approvalStatus,
          isAdmin,
          testAccountLevel,
        },
        activeOrg: envelope.activeOrg,
        memberships: envelope.memberships,
        pendingInvites: joinSurface.pendingInvites,
        domainJoinableOrgs: joinSurface.domainJoinableOrgs,
        myJoinRequests: joinSurface.myJoinRequests,
        autoJoinedOrg: joinSurface.autoJoinedOrg,
      });
    } catch {
      return res.json({
        user: null,
        activeOrg: null,
        memberships: [],
        pendingInvites: [],
        domainJoinableOrgs: [],
        myJoinRequests: [],
        autoJoinedOrg: null,
      });
    }
  });

  /**
   * POST /api/auth/switch-org — change the active org for the current
   * identity. Foundation for multi-org accounts: validates membership,
   * updates `currentOrganizationId`, and re-issues the JWT cookie with the
   * new `org`+`kind`. Today every user has exactly one membership
   * (`individual`), so the only legal switch is a no-op to self.
   */
  router.post('/auth/switch-org', async (req: Request, res: Response) => {
    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }
    if (!organizationRepository) {
      return res.status(503).json({ error: 'Organization repository not configured' });
    }

    const token = (req as any).cookies?.[JwtService.cookieName];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let payload: ReturnType<typeof jwtService.verify>;
    try {
      payload = jwtService.verify(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const organizationId =
      typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : '';
    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId required' });
    }

    const userId = payload.sub;
    const membership = await organizationRepository.getMembership(userId, organizationId);
    if (!membership) {
      return res.status(403).json({ error: 'not_a_member', message: 'You are not a member of that organization.' });
    }

    const org = await organizationRepository.getOrganization(organizationId);
    const kind = org?.kind ?? deriveKindFromOrgId(organizationId);

    await organizationRepository.upsertUser({
      id: userId,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      currentOrganizationId: organizationId,
    });

    const workspacePath = workspaceResolver.getWorkspacePath({ userId, organizationId });
    try {
      await fs.promises.access(workspacePath);
    } catch {
      await fs.promises.mkdir(workspacePath, { recursive: true });
    }

    issueJwtCookie(req, res, {
      sub: userId,
      email: payload.email,
      org: organizationId,
      kind,
      name: payload.name,
      picture: payload.picture,
    });

    const envelope = await buildAccountEnvelope(organizationRepository, userId, organizationId);
    res.json({
      user: {
        userId,
        email: payload.email,
        organization: organizationId,
        name: payload.name,
        picture: payload.picture,
        kind,
      },
      activeOrg: envelope.activeOrg,
      memberships: envelope.memberships,
    });
  });

  /**
   * POST /api/auth/signout — clears the JWT cookie. See pre-Phase-3
   * commentary for the legacy host-only drain rationale.
   */
  router.post('/auth/signout', (req: Request, res: Response) => {
    res.set('Cache-Control', 'private, no-store');

    if (jwtService) {
      res.clearCookie(
        JwtService.cookieName,
        jwtService.getClearCookieOptions(isProduction, req.hostname),
      );
      res.clearCookie(JwtService.cookieName, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
      });

      if (isAuthDebugLoggingEnabled()) {
        const setCookieHeader = res.getHeader('Set-Cookie');
        logger.info(
          `[Auth][debug] /auth/signout hostname=${req.hostname} rawCookieHeader="${req.headers.cookie ?? ''}" clearOptions=${JSON.stringify(jwtService.getClearCookieOptions(isProduction, req.hostname))} setCookieResp=${JSON.stringify(setCookieHeader ?? '')}`,
          { component: 'Auth' },
        );
      }
    }
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  });

  /**
   * POST /api/auth/desktop-token
   * Issues a long-lived JWT (90 days) for Ant Desktop.
   * Requires existing authentication (cookie-based session).
   */
  router.post('/auth/desktop-token', async (req: Request, res: Response) => {
    if (!jwtService) {
      return res.json({
        success: true,
        token: 'local',
        expiresInDays: 9999,
      });
    }

    const user = (req as any).user;
    const organization = (req as any).organization;
    if (!user || !organization) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
      const DESKTOP_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
      const token = jwtService.sign(
        {
          sub: user.id,
          email: user.email || '',
          org: organization.id,
          kind: organization.kind ?? deriveKindFromOrgId(organization.id),
        },
        DESKTOP_TOKEN_TTL_SECONDS
      );

      res.json({
        success: true,
        token,
        expiresInDays: 90,
      });
    } catch (error: any) {
      logger.error('[Auth] Failed to issue desktop token:', error);
      res.status(500).json({ success: false, message: 'Failed to issue token' });
    }
  });

  return router;
}
