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

  const NULL_ENVELOPE = {
    user: null,
    activeOrg: null,
    memberships: [],
    needsOnboarding: false,
    suggestedOrganizationName: null,
  };

  it('returns the null envelope when no cookie', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NULL_ENVELOPE);
  });

  it('returns the null envelope when the cookie is malformed', async () => {
    app = await startApp(makeJwtService());
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=not-a-valid-jwt` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NULL_ENVELOPE);
  });

  it('returns the null envelope when the token signature is wrong', async () => {
    const goodService = makeJwtService();
    const token = goodService.sign({ sub: 'a@x.com', email: 'a@x.com', org: 'individual', kind: 'individual' });
    const tamperedService = new JwtService({ secret: 'a-different-secret-also-at-least-32-chars' });
    app = await startApp(tamperedService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(NULL_ENVELOPE);
  });

  it('valid individual token → user.kind + activeOrg + memberships envelope (no repo wired)', async () => {
    const jwtService = makeJwtService();
    const token = jwtService.sign({
      sub: 'alice@gmail.com',
      email: 'alice@gmail.com',
      org: 'individual',
      kind: 'individual',
      name: 'Alice',
      picture: 'https://example.com/avatar.png',
    });
    app = await startApp(jwtService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      userId: 'alice@gmail.com',
      email: 'alice@gmail.com',
      organization: 'individual',
      name: 'Alice',
      picture: 'https://example.com/avatar.png',
      kind: 'individual',
    });
    expect(body.activeOrg).toEqual({ id: 'individual', kind: 'individual', name: 'individual' });
    expect(body.memberships).toEqual([
      { organizationId: 'individual', kind: 'individual', name: 'individual', role: 'member' },
    ]);
    expect(body.needsOnboarding).toBe(false);
  });

  it('kind falls back to deriveKindFromOrgId when the token lacks a kind claim (BC)', async () => {
    const jwtService = makeJwtService();
    // personal-* prefix → individual (legacy consumer org BC).
    const token = jwtService.sign({ sub: 'p@x.com', email: 'p@x.com', org: 'personal-abc' });
    app = await startApp(jwtService);
    const res = await fetch(`${app.url}/api/auth/me`, {
      headers: { Cookie: `${JwtService.cookieName}=${token}` },
    });
    const body = await res.json();
    expect(body.user.kind).toBe('individual');
  });

  it('returns 503 when JWT service is not configured (cloud config fault)', async () => {
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/auth/me — local mode', () => {
  let app: { url: string; close: () => Promise<void> };
  let tmpWorkspaceRoot: string;
  const originalMode = process.env.ANT_SERVER_MODE;
  const originalBasePath = process.env.ANT_WORKSPACE_BASE_PATH;

  beforeEach(async () => {
    delete process.env.ANT_SERVER_MODE;
    // Pin the workspace root so `inferLocalDefaultTenant` sees an
    // isolated, empty tree by default. Individual tests can seed
    // sub-directories under this root to exercise the 1-org × 1-user
    // inference path.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    tmpWorkspaceRoot = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'ant-auth-me-'));
    process.env.ANT_WORKSPACE_BASE_PATH = tmpWorkspaceRoot;
    const { __resetInferredLocalDefaultForTests } = await import(
      '../../src/periphery/adapters/http/routes/helpers/userContext'
    );
    __resetInferredLocalDefaultForTests();
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = originalMode;
    if (originalBasePath === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = originalBasePath;
    const { __resetInferredLocalDefaultForTests } = await import(
      '../../src/periphery/adapters/http/routes/helpers/userContext'
    );
    __resetInferredLocalDefaultForTests();
    if (app) await app.close();
    if (tmpWorkspaceRoot) {
      const fs = await import('node:fs/promises');
      await fs.rm(tmpWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it('falls back to local:local identity when the workspace tree is empty', async () => {
    // No org / user directories exist yet — inferLocalDefaultTenant
    // returns null and the response uses the literal `local` defaults.
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
        kind: 'local',
      },
      activeOrg: { id: 'local', kind: 'local', name: 'local' },
      memberships: [{ organizationId: 'local', kind: 'local', name: 'local', role: 'member' }],
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
  });

  it('reflects the inferred tenant when the workspace has exactly one org × one user', async () => {
    // Seed the workspace tree so inferLocalDefaultTenant produces
    // `to.nexus / probe` — the same identity every other route handler
    // sees via `extractUserContext`. This is the SSOT alignment fix.
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    await fs.mkdir(pathMod.join(tmpWorkspaceRoot, 'to.nexus', 'probe'), {
      recursive: true,
    });

    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      email: 'probe@to.nexus',
      organization: 'to.nexus',
      userId: 'probe',
      name: 'Local User',
      kind: 'local',
    });
    expect(body.needsOnboarding).toBe(false);
  });

  it('returns the same Local envelope when ANT_SERVER_MODE=local explicitly', async () => {
    process.env.ANT_SERVER_MODE = 'local';
    app = await startApp(undefined);
    const res = await fetch(`${app.url}/api/auth/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ organization: 'local', userId: 'local' });
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
