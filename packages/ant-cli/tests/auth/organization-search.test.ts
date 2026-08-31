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
  // Explicit Promise<never>: an async body that only throws still infers
  // Promise<void>, which does not satisfy the port's return type.
  async getOrCreateOrganization(): Promise<never> {
    throw new Error('not used');
  }
  /** Last (query, limit) the route passed — makes clamping observable. */
  lastCall: { query: string; limit: number } | null = null;

  async searchOrganizations(query: string, limit: number): Promise<OrganizationSummary[]> {
    this.lastCall = { query, limit };
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
  // Explicit Promise<never>: an async body that only throws still infers
  // Promise<void>, which does not satisfy the port's return type.
  async attachMembership(): Promise<never> {
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
  // Explicit Promise<never>: an async body that only throws still infers
  // Promise<void>, which does not satisfy the port's return type.
  async upsertUser(): Promise<never> {
    throw new Error('not used');
  }

  // Approval / admin surface — added to the port after this fake was written.
  // Kept as explicit throwers rather than dropping `implements`, so the next
  // port addition fails HERE instead of silently leaving the fake behind.
  async listMembershipsByUser(): Promise<never> {
    throw new Error('not used');
  }
  async getUserApproval(): Promise<never> {
    throw new Error('not used');
  }
  async deleteUserIdentity(): Promise<never> {
    throw new Error('not used');
  }
  async recordUserPurge(): Promise<never> {
    throw new Error('not used');
  }
  async getUserPurge(): Promise<never> {
    throw new Error('not used');
  }
  async clearUserPurge(): Promise<never> {
    throw new Error('not used');
  }
  async setUserApproval(): Promise<never> {
    throw new Error('not used');
  }
  async setTestAccountLevel(): Promise<never> {
    throw new Error('not used');
  }
  async syncSuperAdmins(): Promise<never> {
    throw new Error('not used');
  }
  async listUsers(): Promise<never> {
    throw new Error('not used');
  }
  async getAdminConfig(): Promise<never> {
    throw new Error('not used');
  }
  async setAdminConfig(): Promise<never> {
    throw new Error('not used');
  }
  async backfillFromWorkspaceTree() {
    return { orgsCreated: 0, usersCreated: 0, membershipsCreated: 0, skipped: 0 };
  }

  // Team lifecycle / invites / domains (Phase 1) — same convention: explicit
  // throwers so a port change surfaces here instead of orphaning the fake.
  async createOrganization(): Promise<never> {
    throw new Error('not used');
  }
  async updateOrganizationName(): Promise<never> {
    throw new Error('not used');
  }
  async softDeleteOrganization(): Promise<never> {
    throw new Error('not used');
  }
  async listOrganizations(): Promise<never> {
    throw new Error('not used');
  }
  async listOrgMemberships(): Promise<never> {
    throw new Error('not used');
  }
  async removeMembership(): Promise<never> {
    throw new Error('not used');
  }
  async setMembershipRole(): Promise<never> {
    throw new Error('not used');
  }
  async transferOwnership(): Promise<never> {
    throw new Error('not used');
  }
  async createInvite(): Promise<never> {
    throw new Error('not used');
  }
  async getInvite(): Promise<never> {
    throw new Error('not used');
  }
  async getInviteByToken(): Promise<never> {
    throw new Error('not used');
  }
  async listOrgInvites(): Promise<never> {
    throw new Error('not used');
  }
  async listInvitesByEmail(): Promise<never> {
    throw new Error('not used');
  }
  async updateInvite(): Promise<never> {
    throw new Error('not used');
  }
  async createDomainClaim(): Promise<never> {
    throw new Error('not used');
  }
  async getDomainClaim(): Promise<never> {
    throw new Error('not used');
  }
  async listOrgDomains(): Promise<never> {
    throw new Error('not used');
  }
  async updateDomainClaim(): Promise<never> {
    throw new Error('not used');
  }
  async deleteDomainClaim(): Promise<never> {
    throw new Error('not used');
  }

  // Discoverability / join requests / removal rows — same convention.
  async setOrganizationDiscoverable(): Promise<never> {
    throw new Error('not used');
  }
  async patchDomainJoinPolicy(): Promise<never> {
    throw new Error('not used');
  }
  async createJoinRequest(): Promise<never> {
    throw new Error('not used');
  }
  async getJoinRequest(): Promise<never> {
    throw new Error('not used');
  }
  async listJoinRequestsByOrg(): Promise<never> {
    throw new Error('not used');
  }
  async listJoinRequestsByUser(): Promise<never> {
    throw new Error('not used');
  }
  async setJoinRequestStatus(): Promise<never> {
    throw new Error('not used');
  }
  async recordMemberRemoval(): Promise<never> {
    throw new Error('not used');
  }
  async getMemberRemoval(): Promise<never> {
    throw new Error('not used');
  }
  async listRemovedMembers(): Promise<never> {
    throw new Error('not used');
  }
  async clearMemberRemoval(): Promise<never> {
    throw new Error('not used');
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

  it('clamps an oversized limit before it reaches the repo', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=ac&limit=9999`);
    expect(res.status).toBe(200);
    expect(repo.lastCall?.limit).toBe(25);
  });

  it('returns [] for empty / whitespace query (cheap rejection)', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations).toEqual([]);
  });

  it('never reaches the repo for a single-character query', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=a`);
    expect(res.status).toBe(200);
    expect((await res.json()).organizations).toEqual([]);
    expect(repo.lastCall).toBeNull();
  });

  it('omits ownerId / createdAt from the response (sensitive-field guard)', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=acme`);
    const body = await res.json();
    for (const org of body.organizations) {
      expect(Object.keys(org).sort()).toEqual(['id', 'name']);
    }
  });

  it('respects the limit param', async () => {
    const res = await fetch(`${app.url}/api/organizations?q=ac&limit=1`);
    const body = await res.json();
    expect(repo.lastCall?.limit).toBe(1);
    expect(body.organizations.length).toBe(1);
  });
});
