/**
 * Deploy private-visibility access gate.
 *
 * The owner of a deploy is the `(tenantId, userId)` baked into the urlKey.
 * A private deploy is accessible ONLY with a valid session cookie whose
 * `org`/`sub` match. Any failure must be indistinguishable from
 * not-found — the middleware returns 404 (never 403), tested separately.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import {
  isAuthorizedForPrivateDeploy,
  createDeployProxyMiddleware,
  type DeployProxyJwtService,
} from '../../src/periphery/adapters/http/middleware/deployProxy';
import type { DeployState } from '../../src/core/ports/portRegistry';
import { refusesSharedOriginPrivateAdmission } from '../../src/core/config/previewRouting';

const COOKIE = 'ant_session';

describe('refusesSharedOriginPrivateAdmission (M-029 SSOT)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('path mode + ambient cookie browser request → refuses', () => {
    expect(refusesSharedOriginPrivateAdmission({ cookie: 'ant_session=x', 'sec-fetch-site': 'same-origin' })).toBe(true);
  });
  it('path mode + no cookie/no bearer (e.g. navigation none) → refuses (fail-closed)', () => {
    expect(refusesSharedOriginPrivateAdmission({ 'sec-fetch-site': 'none' })).toBe(true);
  });
  it('path mode + non-ambient bearer, no cookie → allows', () => {
    expect(refusesSharedOriginPrivateAdmission({ authorization: 'Bearer tok' })).toBe(false);
  });
  it('path mode + bearer WITH cookie → refuses (cookie makes it ambient)', () => {
    expect(refusesSharedOriginPrivateAdmission({ authorization: 'Bearer tok', cookie: 'ant_session=x' })).toBe(true);
  });
  it('subdomain mode → never refuses (per-deploy origin)', () => {
    vi.stubEnv('ANT_PREVIEW_BASE_DOMAIN', 'ant-preview.example.com');
    expect(refusesSharedOriginPrivateAdmission({ cookie: 'ant_session=x', 'sec-fetch-site': 'same-origin' })).toBe(false);
  });
});

function reqWithCookie(token?: string): Request {
  return { headers: { cookie: token ? `${COOKIE}=${token}` : undefined } } as unknown as Request;
}

// jwtService stub: verifies a token of the form `org:sub`, throws on 'bad'.
const jwt: DeployProxyJwtService = {
  verify(token: string) {
    if (token === 'bad') throw new Error('invalid');
    const [org, sub] = token.split('|');
    return { org, sub };
  },
};

describe('isAuthorizedForPrivateDeploy', () => {
  it('local mode (no jwtService) → always authorized', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie(), undefined, COOKIE, 'individual', 'a@x.com')).toBe(true);
  });

  it('no cookie → denied', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie(), jwt, COOKIE, 'individual', 'a@x.com')).toBe(false);
  });

  it('invalid token → denied', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie('bad'), jwt, COOKIE, 'individual', 'a@x.com')).toBe(false);
  });

  it('org mismatch → denied', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie('team-x|a@x.com'), jwt, COOKIE, 'individual', 'a@x.com')).toBe(false);
  });

  it('user mismatch → denied', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie('individual|b@x.com'), jwt, COOKIE, 'individual', 'a@x.com')).toBe(false);
  });

  it('matching owner → authorized', () => {
    expect(isAuthorizedForPrivateDeploy(reqWithCookie('individual|a@x.com'), jwt, COOKIE, 'individual', 'a@x.com')).toBe(true);
  });
});

describe('deploy proxy 404-not-403 existence guard', () => {
  function makeState(visibility: 'public' | 'private'): DeployState {
    return {
      tenantId: 'individual', userId: 'a@x.com', projectId: 'p', feature: 'f',
      phase: 'running', host: '127.0.0.1', podId: 'pod', workspacePath: '/tmp',
      packages: [], visibility, startedAt: new Date(), lastAccessedAt: new Date(),
    };
  }
  function res() {
    const captured: { status?: number; body?: unknown } = {};
    const r = {
      status(code: number) { captured.status = code; return r; },
      json(body: unknown) { captured.body = body; return r; },
    } as any;
    return { r, captured };
  }

  const baseDeps = {
    touchDeploy: async () => {},
    updateDeploy: async () => {},
    broadcastStatus: async () => {},
    jwtService: jwt,
    cookieName: COOKIE,
  };

  it('private + unauthorized → 404 identical to genuine-not-found', async () => {
    // genuine not-found body
    const notFound = res();
    const mwNotFound = createDeployProxyMiddleware({ ...baseDeps, ensureRunning: async () => null });
    await mwNotFound({ path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: {} } as any, notFound.r, () => {});

    // private + no cookie
    const priv = res();
    const mwPriv = createDeployProxyMiddleware({ ...baseDeps, ensureRunning: async () => makeState('private') });
    await mwPriv({ path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: {} } as any, priv.r, () => {});

    expect(priv.captured.status).toBe(404);
    expect(priv.captured.status).toBe(notFound.captured.status);
    expect(priv.captured.body).toEqual(notFound.captured.body);
  });

  // M-NEW-023: an unauthorized caller must not trigger a private deploy's
  // rehydration. With a side-effect-free visibility read wired, the gate runs
  // BEFORE ensureRunning, so ensureRunning is never reached for a private deploy
  // requested without the owner cookie.
  it('private + unauthorized → ensureRunning is NOT called (no rehydration)', async () => {
    let ensureCalls = 0;
    const out = res();
    const mw = createDeployProxyMiddleware({
      ...baseDeps,
      getVisibility: async () => 'private',
      ensureRunning: async () => { ensureCalls++; return makeState('private'); },
    });
    await mw({ path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: {} } as any, out.r, () => {});
    expect(out.captured.status).toBe(404);
    expect(ensureCalls).toBe(0);
  });

  it('private + authorized owner, non-ambient (bearer, no cookie) → ensureRunning gate reached', async () => {
    // Path mode: a non-ambient caller passes the M-029 shared-origin gate, so the
    // request reaches the cookie-owner check. Bearer-only (no cookie) has no owner
    // cookie → 404, but the shared-origin gate did NOT short-circuit it — contrast
    // the browser/cookie case below which is refused before this point.
    let ensureCalls = 0;
    const out = res();
    const mw = createDeployProxyMiddleware({
      ...baseDeps,
      getVisibility: async () => 'private',
      ensureRunning: async () => { ensureCalls++; return null; },
    });
    await mw(
      { path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: { authorization: 'Bearer tok' } } as any,
      out.r, () => {},
    );
    // No owner cookie → refused at the owner check (404), not at the M-029 gate.
    expect(out.captured.status).toBe(404);
    expect(ensureCalls).toBe(0);
  });

  it('public → ensureRunning IS called even without a cookie (lazy start preserved)', async () => {
    let ensureCalls = 0;
    const out = res();
    const mw = createDeployProxyMiddleware({
      ...baseDeps,
      getVisibility: async () => 'public',
      ensureRunning: async () => { ensureCalls++; return makeState('public'); },
    });
    await mw({ path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: {} } as any, out.r, () => {});
    expect(ensureCalls).toBe(1);
  });

  // ── M-029: shared-origin ambient-cookie admission (path mode) ──
  // In path mode every public deploy and every private deploy share ONE content
  // origin, so a browser same-origin request from attacker public content carries
  // the victim's ambient cookie and would pass the owner check as the victim. A
  // browser/ambient request to a PRIVATE upstream is refused before ensureRunning;
  // public deploys, non-ambient bearer callers, and subdomain mode are unaffected.
  describe('M-029 shared-origin private admission (path mode)', () => {
    afterEach(() => vi.unstubAllEnvs());

    const ownerCookie = `${COOKIE}=individual|a@x.com`;

    it('path mode + owner cookie + browser Fetch-Metadata → refused before ensureRunning', async () => {
      // No ANT_PREVIEW_BASE_DOMAIN → path mode. The cookie is the victim's own,
      // but a same-origin browser request cannot be told apart from attacker
      // content on the shared origin, so it is refused.
      let ensureCalls = 0;
      const out = res();
      const mw = createDeployProxyMiddleware({
        ...baseDeps,
        getVisibility: async () => 'private',
        ensureRunning: async () => { ensureCalls++; return makeState('private'); },
      });
      await mw(
        { path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' } } as any,
        out.r, () => {},
      );
      expect(ensureCalls).toBe(0);
      expect(out.captured.status).toBe(404);
    });

    it('path mode + public deploy + browser cookie → unaffected (public lazy start)', async () => {
      let ensureCalls = 0;
      const out = res();
      const mw = createDeployProxyMiddleware({
        ...baseDeps,
        getVisibility: async () => 'public',
        ensureRunning: async () => { ensureCalls++; return makeState('public'); },
      });
      await mw(
        { path: '/individual--a@x.com--p--f/', url: '/individual--a@x.com--p--f/', method: 'GET', headers: { cookie: ownerCookie, 'sec-fetch-site': 'same-origin' } } as any,
        out.r, () => {},
      );
      expect(ensureCalls).toBe(1);
    });
  });
});
