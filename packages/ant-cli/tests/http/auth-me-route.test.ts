/**
 * `/api/auth/me` contract — phase 2 unified shape.
 *
 * Always answers 200 with the same envelope:
 *   { user: User | null, needsOnboarding: boolean, suggestedOrganizationName: string | null }
 *
 * - Local mode (`ANT_SERVER_MODE !== 'cloud'`): returns a fixed Local
 *   identity so the FE LocalUserBadge has a consistent payload.
 * - Cloud mode: reads the JWT cookie. `needsOnboarding=true` only when
 *   the payload's org is the `_pending` sentinel (Phase 3 will write it).
 * - 503 is reserved for cloud-mode-with-no-JWT-service (genuine config
 *   fault) — never for "not signed in" (which is `{ user: null, ... }`).
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

describe('GET /api/auth/me — cloud mode', () => {
  let app: { url: string; close: () => Promise<void> };
  const originalMode = process.env.ANT_SERVER_MODE;

  beforeEach(() => {
    process.env.ANT_SERVER_MODE = 'cloud';
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = originalMode;
    if (app) await app.close();
  });

  it('returns 200 + { user: null, needsOnboarding: false, suggestedOrganizationName: null } when no cookie', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: null,
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('returns 200 + user:null envelope when the cookie is malformed', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=not-a-valid-jwt` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: null,
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('returns 200 + user:null envelope when the token signature is wrong', async () => {
    const goodService = makeJwtService();
    const token = goodService.sign({
      sub: 'user-1',
      email: 'alice@to.nexus',
      org: 'to.nexus',
      name: 'Alice',
    });
    const tamperedService = new JwtService({
      secret: 'a-different-secret-also-at-least-32-chars',
    });
    app = await startApp(tamperedService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: null,
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('returns 200 + user payload + needsOnboarding:false when the cookie is a valid token (settled org)', async () => {
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
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('returns needsOnboarding:true + suggestedOrganizationName for business email on _pending JWT', async () => {
    // Phase 3 contract — OAuth callback emits `org: '_pending'` for new
    // users so the FE can route them to OrganizationOnboardingScreen.
    // Business email → second-level domain becomes the prefill.
    const jwtService = makeJwtService();
    const token = jwtService.sign({
      sub: 'user-new',
      email: 'newbie@example.com',
      org: '_pending',
      name: 'Newbie',
    });
    app = await startApp(jwtService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsOnboarding).toBe(true);
    expect(body.user).toMatchObject({ userId: 'user-new', organization: '_pending' });
    expect(body.suggestedOrganizationName).toBe('example');
  });

  it('returns needsOnboarding:true + null suggestion for consumer email on _pending JWT', async () => {
    const jwtService = makeJwtService();
    const token = jwtService.sign({
      sub: 'user-consumer',
      email: 'foo@gmail.com',
      org: '_pending',
      name: 'Foo',
    });
    app = await startApp(jwtService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsOnboarding).toBe(true);
    expect(body.suggestedOrganizationName).toBeNull();
  });

  it('returns 503 when JWT service is not configured (cloud config fault)', async () => {
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/auth/me — local mode', () => {
  let app: { url: string; close: () => Promise<void> };
  const originalMode = process.env.ANT_SERVER_MODE;

  beforeEach(() => {
    delete process.env.ANT_SERVER_MODE;
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = originalMode;
    if (app) await app.close();
  });

  it('returns the fixed Local identity envelope when ANT_SERVER_MODE is unset', async () => {
    // No JWT service is provided — local mode never inspects JWT.
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: {
        email: 'local@local',
        organization: 'local',
        userId: 'local',
        name: 'Local User',
      },
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('returns the same Local envelope when ANT_SERVER_MODE=local explicitly', async () => {
    process.env.ANT_SERVER_MODE = 'local';
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: 'local@local', organization: 'local' });
    expect(body.needsOnboarding).toBe(false);
  });

  it('ignores any cookie in local mode (no JWT verification path)', async () => {
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=tampered-token-content` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ organization: 'local' });
  });
});
