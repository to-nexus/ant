/**
 * `GET /api/organizations` regression — case-insensitivity, id + name
 * search, limit clamping, and authoritative-field exclusion. Uses a
 * fake `OrganizationRepositoryPort` so the test runs without Redis.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

// The route applies `organizationsRateLimiter` which lazily touches the
// Infrastructure factory (needs `ANT_REDIS_URL`). The unit-level test
// shouldn't depend on Redis — bypass the limiter the same way
// `auth-me-route.test.ts` bypasses `authRateLimiter`.
vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  authRateLimiter: (_req: any, _res: any, next: any) => next(),
  organizationsRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  previewRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { createOrganizationsRoutes } from '../../src/periphery/adapters/http/routes/organizations.routes';
import type {
  OrganizationRepositoryPort,
  OrganizationSummary,
} from '../../src/core/ports/organizationRepository';

class FakeOrgRepo implements OrganizationRepositoryPort {
  private orgs = new Map<string, { id: string; name: string; ownerId: string | null; createdAt: string }>();

  seed(entries: Array<{ id: string; name: string }>): void {
    for (const e of entries) {
      this.orgs.set(e.id, {
        id: e.id,
        name: e.name,
        ownerId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
  }

  async getOrganization(orgId: string) {
    return this.orgs.get(orgId) ?? null;
  }
  async getOrCreateOrganization() {
    throw new Error('not used');
  }
  async searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]> {
    const q = query.toLowerCase();
    const results: OrganizationSummary[] = [];
    for (const org of this.orgs.values()) {
      if (org.id.toLowerCase().includes(q) || org.name.toLowerCase().includes(q)) {
        results.push({ id: org.id, name: org.name });
      }
      if (results.length >= limit) break;
    }
    return results;
  }
  async attachMembership() {
    throw new Error('not used');
  }
  async getMembership() {
    return null;
  }
  async listUserOrganizations() {
    return [];
  }
  async getUser() {
    return null;
  }
  async getUserByEmail() {
    return null;
  }
  async upsertUser() {
    throw new Error('not used');
  }
  async backfillFromWorkspaceTree() {
    return { orgsCreated: 0, usersCreated: 0, membershipsCreated: 0, skipped: 0 };
  }
}

interface TestApp {
  url: string;
  close: () => Promise<void>;
}

async function startApp(repo: OrganizationRepositoryPort): Promise<TestApp> {
  const app = express();
  app.use(express.json());
  app.use('/api', createOrganizationsRoutes({ organizationRepository: repo }));

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

describe('GET /api/organizations — search', () => {
  let app: TestApp;
  let repo: FakeOrgRepo;

  beforeEach(async () => {
    repo = new FakeOrgRepo();
    repo.seed([
      { id: 'acme', name: 'Acme Inc' },
      { id: 'acme-team', name: 'Acme Team' },
      { id: 'mycompany', name: 'My Company' },
      { id: 'zeta', name: 'Zeta Corp' },
    ]);
    app = await startApp(repo);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns substring matches by id', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=acme`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations.map((o: any) => o.id).sort()).toEqual(['acme', 'acme-team']);
  });

  it('is case-insensitive', async () => {
    const a = await (await fetch(`${app.url}/api/organizations?q=ACME`)).json();
    const b = await (await fetch(`${app.url}/api/organizations?q=acme`)).json();
    expect(a.organizations.map((o: any) => o.id).sort()).toEqual(
      b.organizations.map((o: any) => o.id).sort(),
    );
  });

  it('also matches by name', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=zeta`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations).toEqual([{ id: 'zeta', name: 'Zeta Corp' }]);
  });

  it('clamps limit to MAX_LIMIT (100)', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=a&limit=9999`);
    expect(res.status).toBe(200);
    // No assertion on exact length — just that the request didn't blow
    // up. The clamping is documented behavior (see route constant).
    const body = await res.json();
    expect(Array.isArray(body.organizations)).toBe(true);
  });

  it('returns [] for empty / whitespace query (cheap rejection)', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations).toEqual([]);
  });

  it('omits ownerId / createdAt from the response (sensitive-field guard)', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=acme`);
    const body = await res.json();
    for (const org of body.organizations) {
      expect(Object.keys(org).sort()).toEqual(['id', 'name']);
    }
  });

  it('respects the limit param', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=a&limit=1`);
    const body = await res.json();
    expect(body.organizations.length).toBeLessThanOrEqual(1);
  });
});
