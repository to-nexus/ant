/**
 * Billing seam — overlay-keyed capability + dormant no-op fallback.
 *
 * Locks: `isBillingEnabled()` is NOT a mode proxy — it is true iff the
 * `@ant/cloud` overlay has actually been LOADED (`peekCloudModule() !== null`).
 * No overlay ⇒ billing off in EVERY mode (local, self-hosted cloud). The
 * loader itself is mode-gated: local never probes; cloud probes and quietly
 * resolves null when the package is absent. `isBillingRequired()`
 * (`ANT_REQUIRE_BILLING=1`) is the managed-cloud fail-loud knob — enforced by
 * `InfrastructureFactory.initCloud()`. The `Noop*` adapters are the dormant
 * fallback and are exercised here directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isBillingEnabled,
  isBillingRequired,
} from '../../src/core/config/billingCapability';
import {
  loadCloudModule,
  peekCloudModule,
  __resetCloudModuleCache,
} from '../../src/core/cloud/cloudPlugin';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import type { CreditLedgerPort } from '../../src/core/ports/creditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';

describe('isBillingEnabled — overlay-loaded, not mode', () => {
  beforeEach(() => {
    __resetCloudModuleCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    __resetCloudModuleCache();
    vi.unstubAllEnvs();
  });

  it('is false before any load attempt, in every mode', () => {
    for (const mode of [undefined, 'local', 'cloud']) {
      __resetCloudModuleCache();
      if (mode === undefined) vi.stubEnv('ANT_SERVER_MODE', '');
      else vi.stubEnv('ANT_SERVER_MODE', mode);
      expect(isBillingEnabled()).toBe(false);
    }
  });

  it('local mode: loadCloudModule never probes → stays false', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'local');
    expect(await loadCloudModule()).toBeNull();
    expect(isBillingEnabled()).toBe(false);
  });

  it('cloud mode WITHOUT the overlay (self-hosted): load resolves null quietly → false', async () => {
    // @ant/cloud is physically absent from the OSS repo, so the real dynamic
    // import fails and the loader degrades to null — the self-hosted profile.
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    expect(await loadCloudModule()).toBeNull();
    expect(isBillingEnabled()).toBe(false);
    expect(peekCloudModule()).toBeNull();
  });

  it('retired ANT_BILLING_ENABLED env has no effect', () => {
    for (const v of ['1', 'true', '0', 'false']) {
      vi.stubEnv('ANT_BILLING_ENABLED', v);
      vi.stubEnv('ANT_SERVER_MODE', 'cloud');
      expect(isBillingEnabled()).toBe(false);
    }
  });
});

describe('isBillingRequired — managed-cloud fail-loud knob', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is true only for the exact value "1"', () => {
    vi.stubEnv('ANT_REQUIRE_BILLING', '1');
    expect(isBillingRequired()).toBe(true);
    for (const v of ['', '0', 'true', 'yes']) {
      vi.stubEnv('ANT_REQUIRE_BILLING', v);
      expect(isBillingRequired()).toBe(false);
    }
  });

  it('is independent of isBillingEnabled (requirement ≠ capability)', () => {
    __resetCloudModuleCache();
    vi.stubEnv('ANT_REQUIRE_BILLING', '1');
    expect(isBillingRequired()).toBe(true);
    expect(isBillingEnabled()).toBe(false); // required but not loaded — the boot-failure combination
  });
});

describe('NoopCreditLedger (dormant fallback)', () => {
  it('reports a free/zero balance and never charges', async () => {
    // Typed as the PORT: the no-op bodies declare zero parameters (they ignore
    // every argument), so calling them through the concrete class type rejects
    // the arguments the port promises. The contract is what this asserts.
    const ledger: CreditLedgerPort = new NoopCreditLedger();
    const snap = await ledger.getBalance('o', 'u');
    expect(snap.tier).toBe('free');
    expect(snap.credits).toBe(0);
    // settle / topUp / changeTier are no-ops; balance stays free/0.
    // jobType + billableTaskCount are the PlatformFeeFacts the cloud ledger
    // prices the per-job fee from — required on SettleArgs.
    await ledger.settle({
      jobId: 'j',
      orgId: 'o',
      userId: 'u',
      usdCost: 5,
      jobType: 'code',
      billableTaskCount: 1,
    });
    await ledger.topUp('o', 'u', 1000, 'k');
    const after = await ledger.changeTier('o', 'u', 'pro', { idempotencyKey: 'k' });
    expect(after.credits).toBe(0);
    expect((await ledger.listTransactions('o', 'u', 50)).length).toBe(0);
  });
});

describe('NoopPaymentProvider (dormant fallback)', () => {
  it('never approves a charge', async () => {
    const p = new NoopPaymentProvider();
    expect((await p.purchaseCredits({} as any)).ok).toBe(false);
    expect((await p.startSubscription()).ok).toBe(false);
  });
});
