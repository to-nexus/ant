/**
 * CloudModule — the contract `@ant/cloud` must satisfy.
 *
 * This is the OSS-owned seam interface for the physical cloud extraction. It
 * imports ONLY OSS port interfaces (erased at runtime) and the `ioredis` Redis
 * type — never `@ant/cloud` itself. The cloud overlay package implements this
 * and is loaded at runtime via `cloudPlugin.ts` (the single `import('@ant/cloud')`
 * site). When the package is absent (OSS build), the factory falls back to the
 * Noop adapters and no route is registered.
 */

import type { Redis } from 'ioredis';
import type { CreditLedgerPort } from '../ports/creditLedger';
import type { PaymentProviderPort } from '../ports/paymentProvider';

/** Shared Redis connection handed to cloud adapters (no new socket opened). */
export interface CloudAdapterContext {
  redis: Redis;
}

/** Everything a cloud route bundle needs to mount itself onto the Express app. */
export interface CloudRouteContext {
  app: import('express').Express;
  deps: import('../../periphery/adapters/http/express/types').ServerDependencies;
  config: import('../../periphery/adapters/http/express/types').ServerConfig;
  factory: import('../../infrastructure/adapters/InfrastructureFactory').InfrastructureFactory;
}

/**
 * The overlay is BILLING-ONLY. Identity (OIDC/JWT/AuthService/organization
 * repository/admin) is OSS core — every cloud-mode deployment (self-hosted or
 * managed) runs the same identity code; the overlay adds metering + payment.
 */
export interface CloudModule {
  createCreditLedger(ctx: CloudAdapterContext): CreditLedgerPort;
  createPaymentProvider(ledger: CreditLedgerPort): PaymentProviderPort;
  /**
   * Mounts cloud routers (billing + billing-axis admin actions) onto the app.
   * Synchronous — Express router registration does no async work, which lets
   * `RouteConfigurator.configure()` stay synchronous. `initCloud()` (the async
   * import) is awaited at the composition root BEFORE the adapter is built.
   */
  registerRoutes(ctx: CloudRouteContext): void;
  /** Pre-flight minimum credits gate (was catalog `MIN_START_CREDITS`). */
  minStartCredits: number;
}
