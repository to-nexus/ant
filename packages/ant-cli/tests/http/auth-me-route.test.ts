/**
 * `/api/auth/me` contract — Phase: 200+null normalization.
 *
 * "Not signed in" is a normal state, not an error. The endpoint must
 * always answer 200 with `{ user: null }` for missing/invalid sessions
 * and `{ user: {...} }` for valid sessions. 401 is reserved for protected
 * routes; using it on the session-probe endpoint forces every visitor
 * (including new users on the marketing site) to take a console error
 * on every page load.
 *
 * Same pattern as chatRoutes.test.ts — no supertest; bind a real Express
 * app to port 0 and call it with fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { JwtService } from '../../src/infrastructure/auth/JwtService';
import { createAuthRoutes } from '../../src/periphery/adapters/http/routes/auth.routes';
import type { AuthService } from '../../src/infrastructure/auth/AuthService';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

const TEST_SECRET = 'test-secret-at-least-32-characters-long-xx';

function makeJwtService(): JwtService {
  return new JwtService({ secret: TEST_SECRET });
}

// AuthService / WorkspaceResolver only matter for OAuth routes — the
// /auth/me handler doesn't touch them. Cast through unknown so the
// minimal stubs satisfy the dependency type without pulling the heavy
// constructors.
const stubAuthService = {} as unknown as AuthService;
const stubWorkspaceResolver = {} as unknown as WorkspaceResolver;

async function startApp(jwtService: JwtService | undefined): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(cookieParser());
  app.use(
    '/api',
    createAuthRoutes({
      authService: stubAuthService,
      workspaceResolver: stubWorkspaceResolver,
      jwtService,
    }),
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('GET /api/auth/me', () => {
  let app: { url: string; close: () => Promise<void> };

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 200 + { user: null } when no session cookie is present', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });

  it('returns 200 + { user: null } when the cookie is malformed', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=not-a-valid-jwt` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });

  it('returns 200 + { user: null } when the token signature is wrong', async () => {
    const goodService = makeJwtService();
    const token = goodService.sign({
      sub: 'user-1',
      email: 'alice@to.nexus',
      org: 'to.nexus',
      name: 'Alice',
    });
    // Verifying with a different secret → invalid signature.
    const tamperedService = new JwtService({
      secret: 'a-different-secret-also-at-least-32-chars',
    });
    app = await startApp(tamperedService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ user: null });
  });

  it('returns 200 + { user: <payload> } when the cookie is a valid token', async () => {
    const jwtService = makeJwtService();
    const token = jwtService.sign({
      sub: 'user-42',
      email: 'alice@to.nexus',
      org: 'to.nexus',
      name: 'Alice',
      picture: 'https://example.com/avatar.png',
    });
    app = await startApp(jwtService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: {
        userId: 'user-42',
        email: 'alice@to.nexus',
        organization: 'to.nexus',
        name: 'Alice',
        picture: 'https://example.com/avatar.png',
      },
    });
  });

  it('returns 503 when JWT is not configured (genuine server fault)', async () => {
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(503);
  });
});
