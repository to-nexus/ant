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
