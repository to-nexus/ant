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

// Recipient destination picker — a workspace (universal) project has no
// features plane: its single "feature" is the universal container, and its
// directory list is the artifacts root minus the reserved grafts.
describe('GET /api/org/members/:userId/projects{,/:projectId/features,/…/directories} — project kind', () => {
  const caller = { userId: 'me@x.com', orgId: 'individual', kind: 'individual' };

  async function seedProjects() {
    await seedUser('individual', caller.userId);
    const user = path.join(tmpRoot, 'individual', caller.userId);
    await fsp.mkdir(path.join(user, 'cs', 'features', 'main', 'plan'), { recursive: true });
    await fsp.writeFile(path.join(user, 'cs', 'config.json'), JSON.stringify({ repositoryName: 'cs' }));
    const artifacts = path.join(user, 'ws', 'universal', 'artifacts');
    for (const d of ['plan', 'notes', 'sessions', 'pipeline-runs', '_agents', '_pipelines', '.hidden']) {
      await fsp.mkdir(path.join(artifacts, d), { recursive: true });
    }
    await fsp.writeFile(path.join(artifacts, 'readme.md'), '');
    await fsp.writeFile(path.join(user, 'ws', 'config.json'), JSON.stringify({ projectType: 'universal' }));
    await fsp.mkdir(path.join(user, 'lazy'), { recursive: true });
    await fsp.writeFile(path.join(user, 'lazy', 'config.json'), JSON.stringify({ projectType: 'universal' }));
  }

  it('/projects carries projectType per project', async () => {
    await seedProjects();
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects`);
    const { projects } = await res.json();
    expect(projects).toEqual(expect.arrayContaining([
      { projectId: 'cs', projectType: 'canonical' },
      { projectId: 'ws', projectType: 'universal' },
      { projectId: 'lazy', projectType: 'universal' },
    ]));
    await app.close();
  });

  it("/features of a universal project is exactly [{ featureId: 'universal' }] — no features plane read", async () => {
    await seedProjects();
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects/ws/features`);
    expect(await res.json()).toEqual({ features: [{ featureId: 'universal' }] });
    const canonical = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects/cs/features`);
    expect(await canonical.json()).toEqual({ features: [{ featureId: 'main' }] });
    await app.close();
  });

  it('/directories of a universal project lists artifact dirs minus reserved grafts and dotfiles', async () => {
    await seedProjects();
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects/ws/features/universal/directories`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ directories: ['notes', 'plan'] });
    await app.close();
  });

  it('/directories of a lazy (unmaterialized) universal container is an empty list, not a 404', async () => {
    await seedProjects();
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects/lazy/features/universal/directories`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ directories: [] });
    await app.close();
  });

  it("/directories with featureId 'universal' on a CANONICAL project stays a feature lookup (404)", async () => {
    await seedProjects();
    const app = await startApp(caller);
    const res = await fetch(`${app.url}/api/org/members/${encodeURIComponent(caller.userId)}/projects/cs/features/universal/directories`);
    expect(res.status).toBe(404);
    await app.close();
  });
});
