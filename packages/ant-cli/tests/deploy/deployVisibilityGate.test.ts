/**
 * Deploy private-visibility access gate.
 *
 * The owner of a deploy is the `(tenantId, userId)` baked into the urlKey.
 * A private deploy is accessible ONLY with a valid session cookie whose
 * `org`/`sub` match. Any failure must be indistinguishable from
 * not-found — the middleware returns 404 (never 403), tested separately.
 */

import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  isAuthorizedForPrivateDeploy,
  createDeployProxyMiddleware,
  type DeployProxyJwtService,
} from '../../src/periphery/adapters/http/middleware/deployProxy';
import type { DeployState } from '../../src/core/ports/portRegistry';

const COOKIE = 'ant_session';

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
});
