import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { AuthService } from '../../../../infrastructure/auth/AuthService';
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
import {
  resolveOrganizationId,
  resolveOrgIdentity,
} from '../../../../core/auth/resolveOrganizationId';
import { InvalidOrganizationNameError } from '../../../../core/auth/slugify';
import {
  INDIVIDUAL_ORG_ID,
  LOCAL_ORG_ID,
  deriveKindFromOrgId,
  type OrganizationKind,
} from '@ant/shared';

const OIDC_STATE_TTL_SECONDS = 5 * 60; // 5 minutes
const OIDC_STATE_KEY_PREFIX = 'ant:oidc:state:';

/**
 * Pre-onboarding JWT sentinel. The OAuth callback issues a JWT with this
 * value as the `org` claim for users who have never completed onboarding;
 * `/auth/onboarding/organization` swaps it for a real org id and re-mints
 * the JWT. `requireOnboardedJwt` middleware (see middleware/) refuses
 * protected requests carrying this sentinel.
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
 * Authentication routes for Cloud Mode
 *
 * Handles:
 * - Google OIDC authentication flow (JWT cookie issuance)
 * - Session info endpoint (/api/auth/me)
 * - Sign out (cookie clear)
 * - Organization onboarding (Phase 3) — `_pending` JWT → real org JWT
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
   * lives in `resolveOrganizationId` (consumer → `personal-${sub}`,
   * business → domain). Onboarding may later overwrite the org via
   * `POST /auth/onboarding/organization`.
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
    role: 'owner' | 'member';
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
   * New behavior (Phase 3):
   *  - If `organizationRepository` is wired AND the user has not been
   *    seen before, issue a `_pending` JWT and redirect with
   *    `?onboarding=true`. The FE's OrganizationOnboardingScreen reads
   *    this and routes the user through `/auth/onboarding/organization`.
   *  - Existing users skip onboarding — their persisted
   *    `currentOrganizationId` is honored.
   *  - If `organizationRepository` is absent (legacy path), fall back to
   *    the pre-Phase-3 behavior: derive the org from the email and
   *    issue a regular JWT immediately.
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
      // active-org switch). Every cloud signup joins `individual`; the
      // active org defaults to it (team join is deferred). No onboarding
      // round-trip — the org is decided at signup.
      if (organizationRepository) {
        const userId = oidcUser.email.toLowerCase();
        const existing = await organizationRepository.getUser(userId);

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
        const activeKind = deriveKindFromOrgId(activeOrgId);

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
        await organizationRepository.upsertUser({
          id: userId,
          email: oidcUser.email,
          name: oidcUser.name,
          picture: oidcUser.picture,
          currentOrganizationId: activeOrgId,
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
   *     needsOnboarding: boolean,
   *     suggestedOrganizationName: string | null,
   *   }
   *
   * - Local mode: identity reflects `extractUserContext(req)` so the
   *   `/auth/me` payload matches what every other route-handler sees.
   *   When the workspace has exactly one org × one user directory the
   *   organization/userId reflect that inference; otherwise the
   *   response falls back to the legacy `local:local` defaults.
   * - Cloud mode: reads JWT. `needsOnboarding` is true when the JWT
   *   carries the `_pending` sentinel; `suggestedOrganizationName` is
   *   filled from `suggestOrganizationName(email)` in that case (Phase 3).
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
        },
        activeOrg: { id: organizationId, kind: 'local' as OrganizationKind, name: organizationId },
        memberships: [
          { organizationId, kind: 'local' as OrganizationKind, name: organizationId, role: 'member' as const },
        ],
        needsOnboarding: false,
        suggestedOrganizationName: null,
      });
    }

    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }

    const token = (req as any).cookies?.[JwtService.cookieName];

    if (process.env.ANT_AUTH_DEBUG === '1') {
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
        needsOnboarding: false,
        suggestedOrganizationName: null,
      });
    }

    try {
      const payload = jwtService.verify(token);
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

      res.json({
        user: {
          email: payload.email,
          organization: payload.org,
          name: payload.name,
          picture: payload.picture,
          userId: payload.sub,
          kind: activeKind,
        },
        activeOrg: envelope.activeOrg,
        memberships: envelope.memberships,
        needsOnboarding: false,
        suggestedOrganizationName: null,
      });
    } catch {
      return res.json({
        user: null,
        activeOrg: null,
        memberships: [],
        needsOnboarding: false,
        suggestedOrganizationName: null,
      });
    }
  });

  // ========================================
  // Onboarding (Phase 3)
  // ========================================

  /**
   * POST /api/auth/onboarding/organization
   *
   * Accepts `_pending` JWT (the route is whitelisted in
   * `requireOnboardedJwt`). Body: `{ organizationName?: string }`.
   * Empty / missing input → BE auto-resolves via
   * `resolveOrganizationId(email, undefined, userId)`.
   *
   * On success: upserts organization + membership, mints a fresh JWT
   * with the real `org` claim, and returns the new identity payload.
   */
  router.post('/auth/onboarding/organization', async (req: Request, res: Response) => {
    if (!jwtService) {
      return res.status(503).json({ error: 'JWT not configured' });
    }
    if (!organizationRepository) {
      return res.status(503).json({ error: 'Organization repository not configured' });
    }

    // Read the in-flight `_pending` JWT — middleware whitelist lets
    // it through, so we re-verify it inline here.
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

    if (payload.org !== PENDING_ORG_SENTINEL) {
      // Already onboarded — treat as no-op so accidental double-submit
      // doesn't reissue a fresh org. Return the existing identity.
      return res.json({
        user: {
          userId: payload.sub,
          email: payload.email,
          organization: payload.org,
          name: payload.name,
          picture: payload.picture,
        },
        needsOnboarding: false,
      });
    }

    // JWT.sub is the email-local-part (workspace topology compat). The
    // OrganizationRepository is keyed by the stable OAuth sub, so we
    // first resolve the repo record by email — the OAuth callback's
    // `_pending` upsert wrote both index entries (userId + email lookup),
    // so this lookup MUST find a row. If it doesn't, the user's
    // `_pending` JWT outlived the repo record (DB wipe, etc.) — treat
    // as a session fault and force re-OAuth.
    const userRecord = await organizationRepository.getUserByEmail(payload.email);
    if (!userRecord) {
      logger.warn(
        `[Auth] Onboarding without repo record: ${payload.email} (likely stale _pending JWT)`,
        { component: 'Auth' },
      );
      return res.status(401).json({
        error: 'session_state_lost',
        message: 'Session record missing — please sign in again.',
      });
    }
    const stableId = userRecord.id;

    const userInput = typeof req.body?.organizationName === 'string' ? req.body.organizationName : undefined;

    let organizationId: string;
    try {
      organizationId = resolveOrganizationId(payload.email, userInput, stableId);
    } catch (err) {
      if (err instanceof InvalidOrganizationNameError) {
        return res.status(400).json({ error: 'invalid_organization_name', message: err.message });
      }
      throw err;
    }

    const displayName = (userInput && userInput.trim()) || organizationId;

    const organization = await organizationRepository.getOrCreateOrganization({
      id: organizationId,
      name: displayName,
      ownerId: null,
    });

    await organizationRepository.attachMembership({
      userId: stableId,
      organizationId: organization.id,
      role: 'member',
    });

    await organizationRepository.upsertUser({
      id: stableId,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      currentOrganizationId: organization.id,
    });

    // Workspace path uses `payload.sub` (= username) — the JWT.sub
    // semantics carry over across the org change so existing
    // `extractUserContext` consumers see a stable userId.
    const workspacePath = workspaceResolver.getWorkspacePath({
      userId: payload.sub,
      organizationId: organization.id,
    });
    try {
      await fs.promises.access(workspacePath);
    } catch {
      await fs.promises.mkdir(workspacePath, { recursive: true });
    }

    issueJwtCookie(req, res, {
      sub: payload.sub,
      email: payload.email,
      org: organization.id,
      kind: organization.kind ?? deriveKindFromOrgId(organization.id),
      name: payload.name,
      picture: payload.picture,
    });

    res.json({
      user: {
        userId: payload.sub,
        email: payload.email,
        organization: organization.id,
        name: payload.name,
        picture: payload.picture,
      },
      needsOnboarding: false,
    });
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

      if (process.env.ANT_AUTH_DEBUG === '1') {
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
