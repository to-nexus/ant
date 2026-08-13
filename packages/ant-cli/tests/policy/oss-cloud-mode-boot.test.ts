/**
 * OSS / Cloud seam — self-hosted cloud boot (mode=cloud, NO overlay).
 *
 * Mirror of `oss-build-local-boot.test.ts` for the cloud-mode profile. With
 * `ANT_SERVER_MODE=cloud` and `@ant/cloud` absent (it is never installed in
 * the OSS repo, so the loader's real dynamic import genuinely fails):
 *   - `initCloud()` resolves — a missing overlay is NOT a boot failure unless
 *     `ANT_REQUIRE_BILLING=1` (managed deployments) is set,
 *   - `getCloudModule()` is null and `isBillingEnabled()` stays false,
 *   - the billing getters return the Noop adapters (unmetered by design),
 *   - `getOrganizationRepository()` returns the REAL RedisOrganizationRepository
 *     — identity is MODE-keyed, not overlay-keyed: self-hosted cloud runs real
 *     auth/org from OSS core with billing off.
 *
 * RedisStateStore is mocked (house pattern, see
 * jobworker-shutdown-interruption.test.ts) so constructing the org repo never
 * opens a real Redis socket.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Avoid opening a real Redis connection when getOrganizationRepository()
// reaches through getStateStore() for the shared client.
vi.mock('../../src/infrastructure/state/RedisStateStore', () => ({
  RedisStateStore: class {
    getRedisClient() {
      return {} as never;
    }
  },
}));

import {
  InfrastructureFactory,
  getInfrastructureFactory,
} from '../../src/infrastructure/adapters/InfrastructureFactory';
import { __resetCloudModuleCache } from '../../src/core/cloud/cloudPlugin';
import { isBillingEnabled } from '../../src/core/config/billingCapability';
import { NoopCreditLedger } from '../../src/periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../src/periphery/adapters/billing/NoopPaymentProvider';
import { RedisOrganizationRepository } from '../../src/infrastructure/auth/RedisOrganizationRepository';

const savedMode = process.env.ANT_SERVER_MODE;
const savedRedis = process.env.ANT_REDIS_URL;
const savedRequire = process.env.ANT_REQUIRE_BILLING;

beforeEach(() => {
  process.env.ANT_SERVER_MODE = 'cloud';
  // Cloud mode fail-fasts on a missing Redis URL at factory construction —
  // pin it (config resolution only; the mocked StateStore never connects).
  process.env.ANT_REDIS_URL = savedRedis ?? 'redis://localhost:16379';
  delete process.env.ANT_REQUIRE_BILLING;
  __resetCloudModuleCache();
  InfrastructureFactory.reset();
});

afterEach(() => {
  const restore = (k: string, v: string | undefined) =>
    v === undefined ? delete (process.env as Record<string, unknown>)[k] : (process.env[k] = v);
  restore('ANT_SERVER_MODE', savedMode);
  restore('ANT_REDIS_URL', savedRedis);
  restore('ANT_REQUIRE_BILLING', savedRequire);
  __resetCloudModuleCache();
  InfrastructureFactory.reset();
});

describe('self-hosted cloud boot — mode=cloud, overlay absent, billing not required', () => {
  it('initCloud() resolves; overlay null; billing off', async () => {
    const factory = getInfrastructureFactory();
    await expect(factory.initCloud()).resolves.toBeUndefined();
    expect(factory.getCloudModule()).toBeNull();
    expect(isBillingEnabled()).toBe(false);
  });

  it('billing getters degrade to the Noop adapters (unmetered profile)', async () => {
    const factory = getInfrastructureFactory();
    await factory.initCloud();
    expect(factory.getCreditLedger()).toBeInstanceOf(NoopCreditLedger);
    expect(factory.getPaymentProvider()).toBeInstanceOf(NoopPaymentProvider);
  });

  it('getOrganizationRepository() is the REAL Redis-backed repo (identity is mode-keyed)', async () => {
    const factory = getInfrastructureFactory();
    await factory.initCloud();
    expect(factory.getOrganizationRepository()).toBeInstanceOf(RedisOrganizationRepository);
  });
});

describe('managed cloud boot — ANT_REQUIRE_BILLING=1, overlay absent', () => {
  it('initCloud() rejects (never a silent free tier)', async () => {
    process.env.ANT_REQUIRE_BILLING = '1';
    const factory = getInfrastructureFactory();
    await expect(factory.initCloud()).rejects.toThrow(/@ant\/cloud/);
    expect(factory.getCloudModule()).toBeNull();
  });
});
