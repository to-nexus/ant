/**
 * Individual-org policy routes:
 *   - GET  /api/org/members/lookup — exact-email public lookup (no existence leak)
 *   - GET/PUT /api/user/config     — account.visibility round-trip
 *
 * Drives the real `createOrgRoutes` against a tmp workspace tree, with a stub
 * middleware that injects `req.user` / `req.organization` (what the JWT
 * middleware would set) so `extractUserContext` resolves an individual caller.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createOrgRoutes } from '../../src/periphery/adapters/http/routes/org.routes';

let tmpRoot: string;
const origMode = process.env.ANT_SERVER_MODE;

function startApp(caller: { userId: string; orgId: string; kind: string }) {
  const app = express();
  app.use(express.json());
  // Stub the JWT middleware: populate req.user / req.organization.
  app.use((req, _res, next) => {
    (req as any).user = { id: caller.userId, email: caller.userId, organizationId: caller.orgId };
    (req as any).organization = { id: caller.orgId, name: caller.orgId, kind: caller.kind };
    next();
  });
  app.use('/api', createOrgRoutes({
    workspaceResolver: { getPhysicalWorkspacesPath: () => tmpRoot },
  }));
  const server = http.createServer(app);
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function seedUser(orgId: string, userId: string, visibility?: 'public' | 'private') {
  const dir = path.join(tmpRoot, orgId, userId);
  await fsp.mkdir(dir, { recursive: true });
  if (visibility) {
    await fsp.mkdir(path.join(dir, '.ant'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, '.ant', 'user-config.json'),
      JSON.stringify({ account: { visibility } }),
    );
  }
}

beforeEach(async () => {
  process.env.ANT_SERVER_MODE = 'cloud';
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ant-org-policy-'));
});
afterEach(async () => {
  if (origMode === undefined) delete process.env.ANT_SERVER_MODE;
  else process.env.ANT_SERVER_MODE = origMode;
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/org/members/lookup (individual)', () => {
  const caller = { userId: 'me@x.com', orgId: 'individual', kind: 'individual' };

  it('returns the member when the target exists and is public (default)', async () => {
    await seedUser('individual', 'bob@y.com'); // no config → default public
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/lookup?email=bob@y.com`);
    expect(await res.json()).toEqual({ member: { userId: 'bob@y.com', isSelf: false } });
    await app.close();
  });

  it('returns null for a private target (indistinguishable from missing)', async () => {
    await seedUser('individual', 'sec@y.com', 'private');
    const app = await startApp(caller);
    const priv = await (await fetch(`${app.url}/api/org/members/lookup?email=sec@y.com`)).json();
    const missing = await (await fetch(`${app.url}/api/org/members/lookup?email=nope@y.com`)).json();
    expect(priv).toEqual({ member: null });
    expect(missing).toEqual({ member: null });
    await app.close();
  });

  it('rejects an invalid email param', async () => {
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/lookup?email=not-an-email`);
    expect(res.status).toBe(400);
    await app.close();
  });

  it('rejects path-traversal in the email param', async () => {
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/lookup?email=${encodeURIComponent('../../etc@x.com')}`);
    expect(res.status).toBe(400);
    await app.close();
  });

  it('is unavailable for team callers (browse list covers discovery)', async () => {
    const app = await startApp({ userId: 'u', orgId: 'acme', kind: 'team' });
    const res = await fetch(`${app.url}/api/org/members/lookup?email=bob@y.com`);
    expect(res.status).toBe(400);
    await app.close();
  });
});

describe('GET/PUT /api/user/config — account.visibility', () => {
  const caller = { userId: 'me@x.com', orgId: 'individual', kind: 'individual' };

  it('round-trips account.visibility and does not clobber github', async () => {
    const app = await startApp(caller);
    // seed an existing github override
    await fetch(`${app.url}/api/user/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ github: { ownerOverride: 'me-personal' } }),
    });
    const put = await fetch(`${app.url}/api/user/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: { visibility: 'private' } }),
    });
    const merged = await put.json();
    expect(merged.account.visibility).toBe('private');
    expect(merged.github.ownerOverride).toBe('me-personal'); // not clobbered
    await app.close();
  });
});
