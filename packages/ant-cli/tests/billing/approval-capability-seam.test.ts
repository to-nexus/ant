/**
 * Approval seam — identity-axis gate + dormant no-op fallback (mirrors
 * `billing-capability-seam.test.ts`).
 *
 * Locks: approval is an IDENTITY concern, not billing. `checkApproval` has NO
 * billing short-circuit — it ALWAYS consults the organization-repository port.
 * Local mode's `NoopOrganizationRepository` reports every account as
 * `approved` (gate returns null), so a local tenant is never blocked through
 * the same single code path. Any cloud-mode deployment (self-hosted or
 * managed, overlay or not) gets the real repo's judgment: a non-approved
 * status returns a block object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoopOrganizationRepository } from '../../src/periphery/adapters/auth/NoopOrganizationRepository';
import type { OrganizationRepositoryPort } from '../../src/core/ports/organizationRepository';
import { approvalErrorCode } from '../../src/periphery/adapters/http/routes/helpers/approvalGate';

describe('NoopOrganizationRepository — approval defaults (local = always approved)', () => {
  // Typed as the PORT, not the concrete class: the no-op bodies legitimately
  // declare zero parameters (they ignore every argument), so calling them
  // through the class type rejects the arguments the port promises. What this
  // suite verifies is the port contract's local-mode behavior.
  const repo: OrganizationRepositoryPort = new NoopOrganizationRepository();

  it('reports every account as approved', async () => {
    expect(await repo.getUserApproval('anyone@example.com')).toBe('approved');
  });

  it('default policy is auto-approve and there is no admin user surface', async () => {
    expect((await repo.getAdminConfig()).defaultApprovalMode).toBe('auto-approve');
    expect(await repo.listUsers()).toEqual([]);
  });

  it('setters are benign no-ops', async () => {
    await expect(repo.setUserApproval('u', 'denied', 'admin')).resolves.toBeUndefined();
    await expect(repo.setTestAccountLevel('u', 2, 'admin')).resolves.toBeUndefined();
    await expect(repo.syncSuperAdmins(['a@b.c'])).resolves.toBeUndefined();
    // Even after a "denied" write, the Noop still reports approved (no state).
    expect(await repo.getUserApproval('u')).toBe('approved');
  });
});

describe('approvalErrorCode', () => {
  it('maps denied → ACCOUNT_DENIED, else ACCOUNT_PENDING_APPROVAL', () => {
    expect(approvalErrorCode('denied')).toBe('ACCOUNT_DENIED');
    expect(approvalErrorCode('pending')).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(approvalErrorCode('approved')).toBe('ACCOUNT_PENDING_APPROVAL');
  });
});

describe('checkApproval — always consults the org-repository port (no billing short-circuit)', () => {
  const savedMode = process.env.ANT_SERVER_MODE;
  beforeEach(() => {
    // The gate + factory are statically imported at the top of this file, so
    // the registry must be cleared for vi.doMock to bind on the dynamic import.
    vi.resetModules();
  });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = savedMode;
    vi.doUnmock('../../src/infrastructure/adapters/InfrastructureFactory');
    vi.resetModules();
  });

  it('local/unset: the Noop repo answers approved → gate returns null (same code path)', async () => {
    delete process.env.ANT_SERVER_MODE;
    const getUserApproval = vi.fn(async () => 'approved' as const);
    vi.doMock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
      getInfrastructureFactory: () => ({
        getOrganizationRepository: () => ({ getUserApproval }),
      }),
    }));
    const { checkApproval } = await import(
      '../../src/periphery/adapters/http/routes/helpers/approvalGate'
    );
    expect(await checkApproval({ userId: 'u', organizationId: 'o' })).toBeNull();
    // The port WAS consulted — there is no capability short-circuit anymore.
    expect(getUserApproval).toHaveBeenCalledWith('u');
  });

  it('local/unset against the real factory: Noop repo → null (never gated)', async () => {
    delete process.env.ANT_SERVER_MODE;
    const { checkApproval } = await import(
      '../../src/periphery/adapters/http/routes/helpers/approvalGate'
    );
    expect(await checkApproval({ userId: 'u', organizationId: 'o' })).toBeNull();
  });

  it('returns a block object for a non-approved account (cloud mode, overlay irrelevant)', async () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    vi.doMock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
      getInfrastructureFactory: () => ({
        getOrganizationRepository: () => ({ getUserApproval: async () => 'pending' }),
      }),
    }));
    const { checkApproval } = await import(
      '../../src/periphery/adapters/http/routes/helpers/approvalGate'
    );
    expect(await checkApproval({ userId: 'u', organizationId: 'o' })).toEqual({ status: 'pending' });
  });

  it('fails open on a repo read error (infra blip must not lock everyone out)', async () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    vi.doMock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
      getInfrastructureFactory: () => ({
        getOrganizationRepository: () => ({
          getUserApproval: async () => {
            throw new Error('redis down');
          },
        }),
      }),
    }));
    const { checkApproval } = await import(
      '../../src/periphery/adapters/http/routes/helpers/approvalGate'
    );
    expect(await checkApproval({ userId: 'u', organizationId: 'o' })).toBeNull();
  });
});

/**
 * The surface guard. Approval used to be six hand-placed handler calls; it is
 * now one middleware mounted on every server that authenticates a cookie or
 * bearer. These rows pin the guard's own decision table — that it reads the
 * verdict through `checkApproval` (one owner, one fail-open posture), and that
 * its only escapes are "no identity to judge" and the super-admin surface.
 */
describe('requireApprovedAccount — whole-surface account gate', () => {
  const savedMode = process.env.ANT_SERVER_MODE;

  beforeEach(() => {
    vi.resetModules();
    process.env.ANT_SERVER_MODE = 'cloud';
  });
  afterEach(async () => {
    if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = savedMode;
    vi.doUnmock('../../src/infrastructure/adapters/InfrastructureFactory');
    vi.resetModules();
  });

  /**
   * Bind a real Express app on port 0 and drive it with fetch — the same shape
   * as `tests/auth/pending-jwt-guard.test.ts`, since this is the same kind of
   * middleware. `user` stands in for what `createJwtAuthMiddleware` populates.
   */
  async function startApp(
    approval: string | Error,
    user: { id: string } | null = { id: 'u@example.com' },
  ) {
    const getUserApproval = vi.fn(async () => {
      if (approval instanceof Error) throw approval;
      return approval;
    });
    vi.doMock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
      getInfrastructureFactory: () => ({
        getOrganizationRepository: () => ({ getUserApproval }),
      }),
    }));
    const express = (await import('express')).default;
    const http = await import('node:http');
    const { createRequireApprovedAccount, ADMIN_SURFACE_PREFIX } = await import(
      '../../src/periphery/adapters/http/middleware/requireApprovedAccount'
    );

    const app = express();
    app.use((req: any, _res: any, next: any) => {
      if (user) {
        req.user = { ...user, organizationId: 'individual' };
        req.organization = { id: 'individual', name: 'individual' };
      }
      next();
    });
    app.use('/api', createRequireApprovedAccount({ exemptPrefixes: [ADMIN_SURFACE_PREFIX] }));
    app.get('/api/projects', (_req: any, res: any) => res.json({ route: 'projects' }));
    app.get('/api/admin/users', (_req: any, res: any) => res.json({ route: 'admin' }));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('failed to bind test server');
    return {
      url: `http://127.0.0.1:${(address as any).port}`,
      getUserApproval,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it.each([
    ['pending', 'ACCOUNT_PENDING_APPROVAL'],
    ['denied', 'ACCOUNT_DENIED'],
  ])('refuses an ordinary route for a %s account (403 %s)', async (status, code) => {
    const app = await startApp(status);
    try {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe(code);
    } finally {
      await app.close();
    }
  });

  it('allows an approved account through', async () => {
    const app = await startApp('approved');
    try {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(200);
      expect((await res.json()).route).toBe('projects');
    } finally {
      await app.close();
    }
  });

  it('never judges a request with no identity — the public-path exemption is DERIVED, not re-listed', async () => {
    const app = await startApp('pending', null);
    try {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(200);
      // The port must not even be consulted: there is nothing to look up.
      expect(app.getUserApproval).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('exempts a caller-declared stronger-gated surface, so a bad stamp cannot brick the operator', async () => {
    const app = await startApp('denied');
    try {
      const res = await fetch(`${app.url}/api/admin/users`);
      expect(res.status).toBe(200);
      expect((await res.json()).route).toBe('admin');
    } finally {
      await app.close();
    }
  });

  // ant-preview also serves an `/admin/instances`, and that one has NO
  // super-admin gate — a global exemption would hand it to a pending account.
  it('exempts nothing by default: the escape is per-mount, never global', async () => {
    vi.doMock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
      getInfrastructureFactory: () => ({
        getOrganizationRepository: () => ({ getUserApproval: async () => 'pending' }),
      }),
    }));
    const { createRequireApprovedAccount } = await import(
      '../../src/periphery/adapters/http/middleware/requireApprovedAccount'
    );
    const req: any = { user: { id: 'u@example.com' }, path: '/admin/instances' };
    const next = vi.fn();
    const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await createRequireApprovedAccount()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('fails OPEN on a repo error — an infra blip must not lock out every approved user', async () => {
    const app = await startApp(new Error('redis down'));
    try {
      const res = await fetch(`${app.url}/api/projects`);
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
