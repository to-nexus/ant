/**
 * OSS / Cloud seam — P0.9 guard #2: OSS / local boot wires the Noop adapters.
 *
 * With `ANT_SERVER_MODE` unset (or `local`), the loader is mode-gated
 * (`loadCloudModule()` never probes `@ant/cloud` in local — free by decision):
 *   - `factory.initCloud()` resolves without probing the overlay,
 *   - `getCloudModule()` stays null (so `isBillingEnabled()` stays false),
 *   - the credit-ledger / payment-provider / organization-repository getters all
 *     return the Noop adapters.
 *
 * This is the dormant-fallback contract that lets the public `ant` repo build +
 * boot WITHOUT the cloud overlay. None of the Noop paths touch Redis, so the
 * test never opens a socket. The cloud-mode mirror (self-hosted profile,
 * mode-keyed org repo, ANT_REQUIRE_BILLING fail-loud) lives in
 * `oss-cloud-mode-boot.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InfrastructureFactory,
  getInfrastructureFactory,
} from '../../src/infrastructure/adapters/InfrastructureFactory';
import { __resetCloudModuleCache } from '../../src/core/cloud/cloudPlugin';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';
import { NoopOrganizationRepository } from '../../src/periphery/adapters/auth/NoopOrganizationRepository';

const savedMode = process.env.ANT_SERVER_MODE;
const savedRedis = process.env.ANT_REDIS_URL;

beforeEach(() => {
  // Pin the Redis URL so the test is independent of the local-mode default in
  // core/config/redisUrl.ts (config resolution only — never connected on the
  // Noop paths).
  process.env.ANT_REDIS_URL = savedRedis ?? 'redis://localhost:16379';
  __resetCloudModuleCache();
  InfrastructureFactory.reset();
});

afterEach(() => {
  if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
  else process.env.ANT_SERVER_MODE = savedMode;
  if (savedRedis === undefined) delete process.env.ANT_REDIS_URL;
  else process.env.ANT_REDIS_URL = savedRedis;
  __resetCloudModuleCache();
  InfrastructureFactory.reset();
});

describe('OSS/local boot — Noop adapters, no cloud overlay', () => {
  for (const mode of [undefined, 'local'] as const) {
    it(`mode=${mode ?? 'unset'}: initCloud no-ops and getters return Noop adapters`, async () => {
      if (mode === undefined) delete process.env.ANT_SERVER_MODE;
      else process.env.ANT_SERVER_MODE = mode;

      const factory = getInfrastructureFactory();
      await factory.initCloud(); // must NOT throw, must NOT probe @ant/cloud

      expect(factory.getCloudModule()).toBeNull();
      expect(factory.getCreditLedger()).toBeInstanceOf(NoopCreditLedger);
      expect(factory.getPaymentProvider()).toBeInstanceOf(NoopPaymentProvider);
      expect(factory.getOrganizationRepository()).toBeInstanceOf(NoopOrganizationRepository);
    });
  }

  it('initCloud is idempotent (second call is a no-op)', async () => {
    delete process.env.ANT_SERVER_MODE;
    const factory = getInfrastructureFactory();
    await factory.initCloud();
    await factory.initCloud();
    expect(factory.getCloudModule()).toBeNull();
  });
});
