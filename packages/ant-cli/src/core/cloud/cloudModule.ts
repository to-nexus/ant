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
import type { OrganizationRepositoryPort } from '../ports/organizationRepository';
import type { AuthPort } from '../ports/auth';

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

export interface CloudModule {
  createCreditLedger(ctx: CloudAdapterContext): CreditLedgerPort;
  createPaymentProvider(ledger: CreditLedgerPort): PaymentProviderPort;
  createOrganizationRepository(ctx: CloudAdapterContext): OrganizationRepositoryPort;
  createAuthService(): AuthPort;
  /** GoogleOIDCService | undefined — opaque to OSS. */
  createOidcServiceFromEnv(): unknown;
  /** JwtService | undefined — opaque to OSS. */
  createJwtServiceFromEnv(): unknown;
  /**
   * Mounts cloud routers (billing, cloud auth, org/team) onto the app.
   * Synchronous — Express router registration does no async work, which lets
   * `RouteConfigurator.configure()` stay synchronous. `initCloud()` (the async
   * import) is awaited at the composition root BEFORE the adapter is built.
   */
  registerRoutes(ctx: CloudRouteContext): void;
  /** Pre-flight minimum credits gate (was catalog `MIN_START_CREDITS`). */
  minStartCredits: number;
}
