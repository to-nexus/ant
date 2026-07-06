/**
 * Approval seam — cloud-only gate + dormant no-op fallback (mirrors
 * `billing-capability-seam.test.ts`).
 *
 * Locks: on OSS/local the `NoopOrganizationRepository` reports every account as
 * `approved` and exposes no admin surface, and `checkApproval` is a no-op
 * (returns null) when billing is disabled — so a local tenant is NEVER gated.
 * The cloud path returns a block object for a non-approved status.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { NoopOrganizationRepository } from '../../src/periphery/adapters/auth/NoopOrganizationRepository';
import { approvalErrorCode } from '../../src/periphery/adapters/http/routes/helpers/approvalGate';

describe('NoopOrganizationRepository — approval defaults (local = always approved)', () => {
  const repo = new NoopOrganizationRepository();

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

describe('checkApproval — capability gate', () => {
  const savedMode = process.env.ANT_SERVER_MODE;
  afterEach(() => {
    if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = savedMode;
    vi.resetModules();
  });

  it('is a no-op (null) when billing is disabled (local/unset)', async () => {
    delete process.env.ANT_SERVER_MODE;
    const { checkApproval } = await import(
      '../../src/periphery/adapters/http/routes/helpers/approvalGate'
    );
    expect(await checkApproval({ userId: 'u', organizationId: 'o' })).toBeNull();
  });

  it('returns a block object for a non-approved account in cloud mode', async () => {
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
    vi.doUnmock('../../src/infrastructure/adapters/InfrastructureFactory');
  });
});
