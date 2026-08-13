/**
 * InfrastructureFactory
 * 
 * Factory for creating infrastructure adapters.
 * 
 * All environments (local and cloud) use the same distributed architecture:
 * - StateStore: RedisStateStore (required)
 * - JobQueue: BullMQJobQueue (Redis-based, required)
 * - Preview: RemotePreviewOrchestrator (worker-based, required)
 * - IDE: LocalIDEOrchestrator (Docker) or KubernetesIDEOrchestrator (K8s)
 * 
 * Environment Variables:
 * - ANT_SERVER_MODE: 'local' | 'cloud' (affects authentication only)
 * - ANT_REDIS_URL: Redis connection URL (defaults in local mode, required in cloud — see core/config/redisUrl.ts)
 * - ANT_K8S_NAMESPACE: Kubernetes namespace for IDE pods (optional, uses Docker if not set)
 * 
 * The only difference between local and cloud:
 * - local: Uses local:local for authentication (no real auth)
 * - cloud: Requires explicit authentication (OAuth, etc.)
 * 
 * @see 10-cloud-scalability-design.md Section 6.2
 */

import { StateStorePort } from '../../core/ports/stateStore';
import { JobQueuePort } from '../../core/ports/queue';
import { IDEOrchestratorPort } from '../../core/ports/ideOrchestrator';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { OrganizationRepositoryPort } from '../../core/ports/organizationRepository';
import { CreditLedgerPort } from '../../core/ports/creditLedger';
import { PaymentProviderPort } from '../../core/ports/paymentProvider';

import { RedisStateStore } from '../state/RedisStateStore';
import { BullMQJobQueue } from '../queue/BullMQJobQueue';
import { LocalIDEOrchestrator } from '../ide/LocalIDEOrchestrator';
import { KubernetesIDEOrchestrator } from '../ide/KubernetesIDEOrchestrator';
import { NoopCreditLedger } from '../../periphery/adapters/billing/NoopCreditLedger';
import { NoopPaymentProvider } from '../../periphery/adapters/billing/NoopPaymentProvider';
import { NoopOrganizationRepository } from '../../periphery/adapters/auth/NoopOrganizationRepository';
import { RedisOrganizationRepository } from '../auth/RedisOrganizationRepository';
import { isBillingRequired } from '../../core/config/billingCapability';
import { loadCloudModule } from '../../core/cloud/cloudPlugin';
import type { CloudModule } from '../../core/cloud/cloudModule';
import { resolveRedisUrl } from '../../core/config/redisUrl';
import { PortManager } from '../networking/PortManager';

import { logger } from '../../utils/logger';

// ============================================
// Environment Configuration
// ============================================

export type AuthMode = 'local' | 'cloud';

export interface InfrastructureConfig {
  authMode: AuthMode;
  
  // Required for all environments
  redisUrl: string;
  
  // Optional: IDE runtime selection
  k8sNamespace?: string;  // If set, use Kubernetes; otherwise use Docker
}

// ============================================
// InfrastructureFactory
// ============================================

export class InfrastructureFactory {
  private static instance: InfrastructureFactory;
  
  // Singleton instances
  private stateStore: StateStorePort | null = null;
  private jobQueue: JobQueuePort | null = null;
  private ideOrchestrator: IDEOrchestratorPort | null = null;
  private organizationRepository: OrganizationRepositoryPort | null = null;
  private creditLedger: CreditLedgerPort | null = null;
  private paymentProvider: PaymentProviderPort | null = null;

  // Cloud overlay (@ant/cloud) — loaded once via initCloud(). Null in OSS/local.
  private cloudModule: CloudModule | null = null;
  private cloudInited = false;

  // Dependencies (must be set before getting orchestrators)
  private portManager: PortManager | null = null;
  private portRegistry: PortRegistryPort | null = null;

  private config: InfrastructureConfig;

  private constructor() {
    this.config = this.loadConfig();
    logger.info(`InfrastructureFactory initialized`, { 
      component: 'InfrastructureFactory' 
    }, {
      authMode: this.config.authMode,
      redisUrl: this.config.redisUrl ? '***' : 'NOT SET',
      ideRuntime: this.config.k8sNamespace ? 'kubernetes' : 'docker'
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): InfrastructureFactory {
    if (!InfrastructureFactory.instance) {
      InfrastructureFactory.instance = new InfrastructureFactory();
    }
    return InfrastructureFactory.instance;
  }

  /**
   * Load configuration from environment
   * 
   * ANT_SERVER_MODE only affects authentication (local:local vs real auth)
   * Infrastructure is the same for both modes (Redis, BullMQ, Remote Preview)
   * 
   * Note: Validation is lazy - only validates what's needed at the time of use.
   * - ANT_REDIS_URL: Resolved at factory initialization (local default / cloud fail-fast)
   *
   * Note: Preview moved to ant-preview service (see 10-cloud-architecture.md)
   */
  private loadConfig(): InfrastructureConfig {
    const authMode = (process.env.ANT_SERVER_MODE || 'local') as AuthMode;
    const redisUrl = resolveRedisUrl();

    return {
      authMode,
      redisUrl,
      k8sNamespace: process.env.ANT_K8S_NAMESPACE  // undefined = use Docker
    };
  }
  
  /**
   * Check authentication mode
   * - local: Uses local:local (no real authentication)
   * - cloud: Requires explicit authentication
   */
  isLocalAuthMode(): boolean {
    return this.config.authMode === 'local';
  }

  /**
   * Get configuration
   */
  getConfig(): InfrastructureConfig {
    return { ...this.config };
  }

  /**
   * Warm-load the cloud overlay once, at composition time, BEFORE any router or
   * service touches a (synchronous) adapter getter. Two-phase init mirrors
   * `setDependencies()`: async import here, sync reads later.
   *
   * - Local: loader never probes — no-op, getters return Noop.
   * - Cloud with `@ant/cloud` present (managed): real billing adapters wired.
   * - Cloud WITHOUT the package (self-hosted): billing off, Noop adapters —
   *   a legitimate profile, identity/org run from OSS core.
   * - `ANT_REQUIRE_BILLING=1` (managed deployments): a missing overlay is a
   *   boot failure — never a silent free tier.
   */
  async initCloud(): Promise<void> {
    if (this.cloudInited) return;
    this.cloudInited = true;
    this.cloudModule = await loadCloudModule();
    if (!this.cloudModule && isBillingRequired()) {
      throw new Error(
        'ANT_REQUIRE_BILLING=1 but the @ant/cloud overlay is not installed/loadable. ' +
          'Install the cloud package or unset ANT_REQUIRE_BILLING for a self-hosted (unmetered) deployment.',
      );
    }
  }

  /** The loaded cloud overlay, or null in OSS/local. */
  getCloudModule(): CloudModule | null {
    return this.cloudModule;
  }

  /**
   * SSOT for "should this billing adapter be real?". Returns the overlay when
   * it is loaded, or null when a Noop is correct (local AND self-hosted cloud
   * — both unmetered by design). The fail-loud invariant survives via
   * `ANT_REQUIRE_BILLING`: on a managed deployment a null `cloudModule` means
   * either a skipped `initCloud()` (DI bug) or a broken overlay install —
   * throw rather than report a phantom `tier: 'free'`. Mirrors the Vector-DB
   * "no NoOp imposter inside the normal flow" invariant.
   */
  private cloudFor(adapter: string): CloudModule | null {
    if (this.cloudModule) return this.cloudModule;
    if (isBillingRequired()) {
      throw new Error(
        `[InfrastructureFactory] ${adapter} requested with ANT_REQUIRE_BILLING=1 but no cloud overlay — ` +
          'either initCloud() was skipped at process boot (DI bug) or @ant/cloud failed to load.',
      );
    }
    return null; // local / self-hosted cloud → Noop is correct
  }

  /**
   * Set dependencies (required for IDE orchestrator with Docker)
   */
  setDependencies(portManager: PortManager, portRegistry: PortRegistryPort): void {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
  }

  // ============================================
  // State Store
  // ============================================

  /**
   * Get StateStorePort implementation
   * Always uses RedisStateStore (required for all environments)
   */
  getStateStore(): StateStorePort {
    if (!this.stateStore) {
      this.stateStore = new RedisStateStore({ url: this.config.redisUrl });
      logger.info('Using RedisStateStore', {
        component: 'InfrastructureFactory'
      });
    }
    
    return this.stateStore;
  }

  // ============================================
  // Job Queue
  // ============================================

  /**
   * Get JobQueuePort implementation
   * Always uses BullMQJobQueue (Redis-based, requires separate worker)
   */
  getJobQueue(): JobQueuePort {
    if (!this.jobQueue) {
      this.jobQueue = new BullMQJobQueue(
        { redisUrl: this.config.redisUrl },
        this.getStateStore()
      );
      logger.info('Using BullMQJobQueue', {
        component: 'InfrastructureFactory'
      });
    }

    return this.jobQueue;
  }

  // ============================================
  // Organization Repository (cloud-mode auth)
  // ============================================

  /**
   * Get the cloud-mode OrganizationRepository — auth records (organizations /
   * memberships / users / approval). OSS core, keyed on SERVER MODE (identity
   * axis), NOT on the billing overlay: self-hosted cloud deployments get the
   * real Redis-backed repo. Shares the StateStore's Redis connection so we
   * don't open a new socket.
   *
   * Local mode does not use this — `local:local` is a fixed tenant with no
   * per-user organization state; dormant org/transfer routes get the NPE-safe
   * Noop repo.
   */
  getOrganizationRepository(): OrganizationRepositoryPort {
    if (!this.organizationRepository) {
      if (this.config.authMode !== 'cloud') {
        this.organizationRepository = new NoopOrganizationRepository();
      } else {
        const stateStore = this.getStateStore() as RedisStateStore;
        this.organizationRepository = new RedisOrganizationRepository(
          stateStore.getRedisClient(),
        );
        logger.info('Using RedisOrganizationRepository (cloud mode)', {
          component: 'InfrastructureFactory',
        });
      }
    }
    return this.organizationRepository;
  }

  // ============================================
  // Billing — credit ledger + payment provider
  // ============================================

  /**
   * Credit ledger (per org+user balance + transaction history). Shares the
   * StateStore's Redis connection. No in-memory fallback (Unified Distributed
   * System Principle) — throws if the StateStore is not Redis-backed.
   */
  getCreditLedger(): CreditLedgerPort {
    if (!this.creditLedger) {
      const cloud = this.cloudFor('CreditLedger');
      if (!cloud) {
        // Cloud-capability seam: OSS / local runs with no metering.
        this.creditLedger = new NoopCreditLedger();
      } else {
        const stateStore = this.getStateStore() as RedisStateStore;
        this.creditLedger = cloud.createCreditLedger({
          redis: stateStore.getRedisClient(),
        });
        logger.info('Using cloud CreditLedger', { component: 'InfrastructureFactory' });
      }
    }
    return this.creditLedger;
  }

  /**
   * Payment provider. Mock (no real PG) for the current vertical slice —
   * simulates a card charge and credits the ledger on success. Swap this single
   * adapter for a real PG (Stripe/Toss) to go live.
   */
  getPaymentProvider(): PaymentProviderPort {
    if (!this.paymentProvider) {
      const cloud = this.cloudFor('PaymentProvider');
      if (!cloud) {
        this.paymentProvider = new NoopPaymentProvider();
      } else {
        this.paymentProvider = cloud.createPaymentProvider(this.getCreditLedger());
        logger.info('Using cloud PaymentProvider', { component: 'InfrastructureFactory' });
      }
    }
    return this.paymentProvider;
  }

  // ============================================
  // Preview - Moved to ant-preview service
  // See docs/internals/02-infrastructure.md
  // ============================================

  // ============================================
  // IDE Orchestrator
  // ============================================

  /**
   * Get IDEOrchestratorPort implementation
   * - With ANT_K8S_NAMESPACE: KubernetesIDEOrchestrator (K8s pods)
   * - Without: LocalIDEOrchestrator (local Docker)
   */
  getIDEOrchestrator(): IDEOrchestratorPort {
    if (!this.ideOrchestrator) {
      if (this.config.k8sNamespace) {
        // K8s mode: doesn't need PortManager/PortRegistry
        this.ideOrchestrator = new KubernetesIDEOrchestrator(
          { namespace: this.config.k8sNamespace },
          this.getStateStore()
        );
        logger.info(`Using KubernetesIDEOrchestrator (namespace: ${this.config.k8sNamespace})`, {
          component: 'InfrastructureFactory'
        });
      } else {
        // Docker mode: requires PortManager/PortRegistry
        if (!this.portManager || !this.portRegistry) {
          throw new Error('Dependencies not set for LocalIDEOrchestrator. Call setDependencies() first.');
        }
        this.ideOrchestrator = new LocalIDEOrchestrator(
          this.portManager,
          this.portRegistry
        );
        logger.info('Using LocalIDEOrchestrator (Docker)', {
          component: 'InfrastructureFactory'
        });
      }
    }
    
    return this.ideOrchestrator;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Cleanup all adapters
   * Note: Preview cleanup moved to ant-preview service
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all infrastructure adapters', { component: 'InfrastructureFactory' });
    
    try {
      if (this.ideOrchestrator) {
        await this.ideOrchestrator.cleanup();
      }
    } catch (error) {
      logger.error('Error cleaning up IDEOrchestrator', { component: 'InfrastructureFactory' }, error);
    }
    
    try {
      if (this.jobQueue) {
        await this.jobQueue.close();
      }
    } catch (error) {
      logger.error('Error closing JobQueue', { component: 'InfrastructureFactory' }, error);
    }
    
    try {
      if (this.stateStore) {
        await this.stateStore.close();
      }
    } catch (error) {
      logger.error('Error closing StateStore', { component: 'InfrastructureFactory' }, error);
    }
    
    // Reset instances
    this.stateStore = null;
    this.jobQueue = null;
    this.ideOrchestrator = null;
  }

  /**
   * Reset factory (for testing)
   */
  static reset(): void {
    if (InfrastructureFactory.instance) {
      // Don't await cleanup in reset
      InfrastructureFactory.instance.cleanup().catch(() => {});
      InfrastructureFactory.instance = null as any;
    }
  }
}

// ============================================
// Convenience exports
// ============================================

/**
 * Get the global InfrastructureFactory instance
 */
export function getInfrastructureFactory(): InfrastructureFactory {
  return InfrastructureFactory.getInstance();
}
