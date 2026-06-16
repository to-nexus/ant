/**
 * @ant/cloud — CloudModule implementation (P1 in-place scaffold).
 *
 * At this phase the cloud code has NOT physically moved yet (P2 does that), so
 * this overlay simply RE-EXPOSES the OSS adapters/routes that still live under
 * `packages/ant-cli/src/**` via relative imports. The OSS `cloudPlugin.ts` loads
 * this module's default export at runtime in cloud mode, restoring the billing
 * surface that Phase 0 cut.
 *
 * Imports are deliberately relative (`../../ant-cli/src/...`): in the monorepo
 * the overlay sits at `packages/ant-cloud` next to `packages/ant-cli`. P2 will
 * physically move the source here and rewrite these to local paths.
 */

import type {
  CloudModule,
  CloudAdapterContext,
  CloudRouteContext,
} from '../../ant-cli/src/core/cloud/cloudModule';
import type { CreditLedgerPort } from '../../ant-cli/src/core/ports/creditLedger';
import type { PaymentProviderPort } from '../../ant-cli/src/core/ports/paymentProvider';
import type { OrganizationRepositoryPort } from '../../ant-cli/src/core/ports/organizationRepository';
import type { AuthPort } from '../../ant-cli/src/core/ports/auth';

import { RedisCreditLedger } from './infrastructure/billing/RedisCreditLedger';
import { MockPaymentProvider } from './infrastructure/billing/MockPaymentProvider';
import { RedisOrganizationRepository } from './infrastructure/auth/RedisOrganizationRepository';
import { AuthService } from './infrastructure/auth/AuthService';
import { GoogleOIDCService } from './infrastructure/auth/GoogleOIDCService';
// JwtService stays OSS (neutral HS256 primitive shared by OSS preview / WS / middleware).
import { createJwtServiceFromEnv } from '../../ant-cli/src/infrastructure/auth/JwtService';
import { createBillingRoutes } from './routes/billing.routes';
import { createAuthRoutes } from './routes/auth.routes';
import { MIN_START_CREDITS } from './infrastructure/billing/catalog';

/**
 * Build a GoogleOIDCService from env, or `undefined` when credentials/redirect
 * are not fully resolvable. Mirrors the wiring in `ServiceInitializer` (P2 will
 * collapse the two into this single owner). The redirect_uri must land on the
 * BE host; same-origin cloud deployments fall back to `FRONTEND_URL`.
 */
function buildOidcServiceFromEnv(): GoogleOIDCService | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    (frontendUrl ? `${frontendUrl}/api/auth/google/callback` : undefined);
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return new GoogleOIDCService({ clientId, clientSecret, redirectUri });
}

const cloudModuleImpl: CloudModule = {
  createCreditLedger(ctx: CloudAdapterContext): CreditLedgerPort {
    return new RedisCreditLedger(ctx.redis);
  },

  createPaymentProvider(ledger: CreditLedgerPort): PaymentProviderPort {
    return new MockPaymentProvider(ledger);
  },

  createOrganizationRepository(ctx: CloudAdapterContext): OrganizationRepositoryPort {
    return new RedisOrganizationRepository(ctx.redis);
  },

  createAuthService(): AuthPort {
    return new AuthService();
  },

  createOidcServiceFromEnv(): unknown {
    return buildOidcServiceFromEnv();
  },

  createJwtServiceFromEnv(): unknown {
    return createJwtServiceFromEnv();
  },

  registerRoutes(ctx: CloudRouteContext): void {
    // Billing routes — balance / usage / top-up. The factory getters return the
    // real Redis-backed adapters (created via this module's create* methods)
    // because `initCloud()` has already wired the overlay before this runs.
    const billingRoutes = createBillingRoutes({
      creditLedger: ctx.factory.getCreditLedger(),
      paymentProvider: ctx.factory.getPaymentProvider(),
      // Org repo drives the USD-visibility role gate (cloud only).
      organizationRepository:
        ctx.config.mode === 'cloud' ? ctx.factory.getOrganizationRepository() : undefined,
    });
    ctx.app.use('/api', billingRoutes);

    // Cloud auth routes — OAuth / JWT / callback / onboarding / switch-org +
    // the cloud `/auth/me`. Mounted by the overlay (OSS registers no auth
    // routes — local mode has no authService). RouteConfigurator runs this
    // overlay BEFORE its own setup so cloud `/auth/me` wins. `jwtService` is
    // the OSS-created neutral HS256 service threaded through deps; the OIDC
    // service is built here from env (single owner — ServiceInitializer no
    // longer constructs it).
    const authRoutes = createAuthRoutes({
      authService: new AuthService(),
      workspaceResolver: ctx.deps.workspaceResolver,
      oidcService: buildOidcServiceFromEnv(),
      jwtService: ctx.deps.jwtService,
      stateStore: ctx.factory.getStateStore(),
      organizationRepository: ctx.factory.getOrganizationRepository(),
    });
    ctx.app.use('/api', authRoutes);
  },

  minStartCredits: MIN_START_CREDITS,
};

export default cloudModuleImpl;
