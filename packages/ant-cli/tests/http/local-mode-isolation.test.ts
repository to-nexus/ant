/**
 * Local-mode cross-user isolation — regression guard.
 *
 * Locks the three layers that together enforce "local mode has no
 * organization concept, only the caller is a valid recipient":
 *
 *   1. `/api/auth/me` mirrors `extractUserContext(req)` so FE store
 *      identity stays in sync with BE routing identity.
 *   2. `/api/org/members` returns the caller alone — workspace
 *      enumeration is intentionally NOT used in local mode.
 *   3. `POST /api/artifacts/transfer-request` rejects with
 *      `LOCAL_MODE_NO_CROSS_USER`.
 *
 * The cloud branch of each surface stays untested here (other suites
 * cover it); this file is the local-mode contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import * as fsAsync from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { JwtService } from '../../src/infrastructure/auth/JwtService';
import { createAuthRoutes } from '../../src/periphery/adapters/http/routes/auth.routes';
import { createOrgRoutes } from '../../src/periphery/adapters/http/routes/org.routes';
import { createTransferRoutes } from '../../src/periphery/adapters/http/routes/transfer.routes';
import { __resetInferredLocalDefaultForTests } from '../../src/periphery/adapters/http/routes/helpers/userContext';
import type { AuthService } from '../../src/infrastructure/auth/AuthService';
import type { WorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

const stubAuthService = {} as unknown as AuthService;
const stubWorkspaceResolver = {} as unknown as WorkspaceResolver;

// Minimal workspaceResolver shim for org/transfer routes — only the
// `getPhysicalWorkspacesPath()` method is read. The tmpdir is injected
// per-test, so we close over it via a setter.
function makeWorkspaceResolverShim(getPath: () => string) {
  return {
    getPhysicalWorkspacesPath: () => getPath(),
  } as any;
}

interface AppHandle {
  url: string;
  close: () => Promise<void>;
}

async function startApp(workspacesPath: string): Promise<AppHandle> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const resolverShim = makeWorkspaceResolverShim(() => workspacesPath);
  app.use(
    '/api',
    createAuthRoutes({
      authService: stubAuthService,
      workspaceResolver: stubWorkspaceResolver,
      jwtService: undefined,
    }),
  );
  app.use('/api', createOrgRoutes({ workspaceResolver: resolverShim }));
  app.use(
    '/api',
    createTransferRoutes({
      transferService: {
        // Local-mode guard fires before the service is touched; cast to
        // keep TS happy without dragging the real constructor in.
      } as any,
      stateStore: {} as any,
      workspaceResolver: resolverShim,
    }),
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('Local-mode cross-user isolation', () => {
  let app: AppHandle;
  let tmpRoot: string;
  const originalMode = process.env.ANT_SERVER_MODE;
  const originalBase = process.env.ANT_WORKSPACE_BASE_PATH;

  beforeEach(async () => {
    delete process.env.ANT_SERVER_MODE;
    tmpRoot = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'ant-local-iso-'));
    process.env.ANT_WORKSPACE_BASE_PATH = tmpRoot;
    __resetInferredLocalDefaultForTests();
  });

  afterEach(async () => {
    if (originalMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = originalMode;
    if (originalBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = originalBase;
    __resetInferredLocalDefaultForTests();
    if (app) await app.close();
    if (tmpRoot) await fsAsync.rm(tmpRoot, { recursive: true, force: true });
  });

  describe('SSOT alignment — /auth/me reflects extractUserContext', () => {
    it('returns the inferred tenant when the workspace has 1 org × 1 user', async () => {
      await fsAsync.mkdir(path.join(tmpRoot, 'to.nexus', 'probe'), {
        recursive: true,
      });
      app = await startApp(tmpRoot);

      const res = await fetch(`${app.url}/api/auth/me`);
      const body = await res.json();
      expect(body.user).toEqual({
        email: 'probe@to.nexus',
        organization: 'to.nexus',
        userId: 'probe',
        name: 'Local User',
        kind: 'local',
      });
    });

    it('falls back to local:local on an empty workspace', async () => {
      app = await startApp(tmpRoot);
      const res = await fetch(`${app.url}/api/auth/me`);
      const body = await res.json();
      expect(body.user).toMatchObject({
        organization: 'local',
        userId: 'local',
      });
    });
  });

  describe('/api/org/members — local mode returns self only', () => {
    it('returns the caller alone even when sibling user folders exist', async () => {
      // Seed two users under the same org dir — multi-user workspace
      // shape that would expose `bob` as a "member" in cloud mode.
      await fsAsync.mkdir(path.join(tmpRoot, 'to.nexus', 'probe'), {
        recursive: true,
      });
      await fsAsync.mkdir(path.join(tmpRoot, 'to.nexus', 'bob'), {
        recursive: true,
      });
      // Force inference back to probe by removing bob and reseeding so
      // there is exactly 1 user — then add bob AFTER cache is primed via
      // an /auth/me call. Simpler: clear cache between writes.
      app = await startApp(tmpRoot);

      // First call drives `inferLocalDefaultTenant` over a 1-org × 2-user
      // tree, which fails the strict 1-user predicate → falls back to
      // local:local. Members endpoint MUST still return only the caller.
      const res = await fetch(`${app.url}/api/org/members`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toEqual([{ userId: 'local', isSelf: true }]);
    });

    it('returns just the inferred user on a 1-org × 1-user workspace', async () => {
      await fsAsync.mkdir(path.join(tmpRoot, 'to.nexus', 'probe'), {
        recursive: true,
      });
      app = await startApp(tmpRoot);

      const res = await fetch(`${app.url}/api/org/members`);
      const body = await res.json();
      expect(body.members).toEqual([{ userId: 'probe', isSelf: true }]);
    });
  });

  describe('Member sub-routes reject cross-user lookups in local mode', () => {
    it('returns 404 when querying another userId for projects', async () => {
      await fsAsync.mkdir(path.join(tmpRoot, 'to.nexus', 'probe'), {
        recursive: true,
      });
      app = await startApp(tmpRoot);

      const res = await fetch(
        `${app.url}/api/org/members/someone-else/projects`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/artifacts/transfer-request rejects in local mode', () => {
    it('returns 400 + LOCAL_MODE_NO_CROSS_USER code', async () => {
      app = await startApp(tmpRoot);

      const res = await fetch(`${app.url}/api/artifacts/transfer-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { userId: 'other' },
          source: { projectId: 'p', featureId: 'f', path: 'plan/x.md' },
          destination: { projectId: 'p', featureId: 'f', path: 'plan/x.md' },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('LOCAL_MODE_NO_CROSS_USER');
    });
  });
});
