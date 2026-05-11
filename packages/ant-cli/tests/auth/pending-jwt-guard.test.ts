/**
 * `_pending` JWT guard regression test.
 *
 * Verifies that `requireOnboardedJwt` rejects `_pending` JWTs on every
 * protected path EXCEPT the onboarding-flow whitelist. Same testing
 * pattern as `auth-me-route.test.ts` — bind a real Express app to port
 * 0 and call it with fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import express, { Request, Response, NextFunction } from 'express';

import { createRequireOnboardedJwt } from '../../src/periphery/adapters/http/middleware/requireOnboardedJwt';

interface TestApp {
  url: string;
  close: () => Promise<void>;
}

async function startApp(orgId: string | null): Promise<TestApp> {
  const app = express();

  // Stand-in for the upstream `createJwtAuthMiddleware` — it normally
  // sets `req.user` / `req.organization` after verifying the JWT. Here
  // we just bake the value in to isolate the onboarding guard.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (orgId !== null) {
      (req as any).user = { id: 'user-x', email: 'x@y', organizationId: orgId };
      (req as any).organization = { id: orgId, name: orgId };
    }
    next();
  });

  app.use('/api', createRequireOnboardedJwt());

  // Echo handlers — every distinct path we test against.
  app.get('/api/projects', (_req, res) => res.json({ ok: true, route: 'projects' }));
  app.get('/api/auth/me', (_req, res) => res.json({ ok: true, route: 'auth-me' }));
  app.get('/api/organizations', (_req, res) => res.json({ ok: true, route: 'organizations' }));
  app.post('/api/auth/onboarding/organization', (_req, res) =>
    res.json({ ok: true, route: 'onboarding' }),
  );
  app.post('/api/auth/signout', (_req, res) => res.json({ ok: true, route: 'signout' }));

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

describe('requireOnboardedJwt — `_pending` JWT guard', () => {
  let app: TestApp;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('with `_pending` org claim', () => {
    beforeEach(async () => {
      app = await startApp('_pending');
    });

    it('rejects `/api/projects` with 401 ONBOARDING_REQUIRED', async () => {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('ONBOARDING_REQUIRED');
    });

    it('PERMITS the onboarding endpoint itself', async () => {
      const res = await fetch(`${app.url}/api/auth/onboarding/organization`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route).toBe('onboarding');
    });

    it('PERMITS `/api/auth/me`', async () => {
      const res = await fetch(`${app.url}/api/auth/me`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route).toBe('auth-me');
    });

    it('PERMITS `/api/auth/signout`', async () => {
      const res = await fetch(`${app.url}/api/auth/signout`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route).toBe('signout');
    });

    it('PERMITS `/api/organizations` (autocomplete during onboarding)', async () => {
      const res = await fetch(`${app.url}/api/organizations?q=acme`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route).toBe('organizations');
    });
  });

  describe('with a real (non-pending) org claim', () => {
    beforeEach(async () => {
      app = await startApp('acme');
    });

    it('allows `/api/projects` through', async () => {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route).toBe('projects');
    });
  });

  describe('with no user context (e.g. local-mode bypass / public endpoints)', () => {
    beforeEach(async () => {
      app = await startApp(null);
    });

    it('does not reject — middleware is a no-op when org is absent', async () => {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(200);
    });
  });
});
